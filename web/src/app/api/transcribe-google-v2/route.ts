// POST /api/transcribe-google-v2
// Body: { audioBase64: string, sampleRate?: number }
// Returns: { text: string }
//
// Authoritative Georgian transcription via Google Cloud Speech v2 with the
// Chirp 2 multilingual model. Auth uses the service-account JSON at
// `web/google-service-account.json` (gitignored).
//
// Chirp 2 is Google's flagship for non-English STT — substantially better
// WER for Georgian than the v1 `latest_long` model we were using.

// IMPORTANT: import from the v2 namespace explicitly — the default
// `SpeechClient` export is v1, which uses `audio: { content }` instead of
// the v2 top-level `content` field.
import { v2 } from "@google-cloud/speech";
import path from "node:path";
import fs from "node:fs";
import openai from "@/lib/openai";
import { guard } from "@/lib/apiGuard";

type V2SpeechClient = InstanceType<typeof v2.SpeechClient>;

/**
 * Peak-normalize PCM16 audio so the loudest sample sits at -3 dBFS (just
 * below clipping). Mobile mic gain varies wildly across phones and rooms —
 * normalizing makes Chirp 2 see consistently-leveled input, which measurably
 * improves accuracy on quiet recordings without distorting loud ones.
 *
 * No-op if the audio is already at or above target peak (don't reduce
 * a clean recording).
 */
function normalizePcm(pcm: Buffer): Buffer {
  if (pcm.length < 4) return pcm;
  const samples = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length),
  );

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return pcm;

  // Target = -3 dBFS = 32768 * 10^(-3/20) ≈ 23197
  const TARGET_PEAK = 23197;
  if (peak >= TARGET_PEAK) return pcm;

  const gain = TARGET_PEAK / peak;
  const normalized = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const scaled = Math.round(samples[i] * gain);
    normalized[i] = Math.max(-32768, Math.min(32767, scaled));
  }
  return Buffer.from(
    normalized.buffer,
    normalized.byteOffset,
    normalized.byteLength,
  );
}

/**
 * Trim leading and trailing silence from raw PCM16 mono audio. Mobile
 * captures continuously from streaming-start to user-stop, often producing
 * 30-90 seconds of audio with only ~2 seconds of actual speech. Chirp 2's
 * sync recognize caps at 60s. After trimming we typically get 2-5 seconds.
 */
function trimSilence(pcm: Buffer, sampleRate: number): Buffer {
  if (pcm.length < 4) return pcm;
  // Read PCM16 little-endian as Int16Array
  const aligned = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length),
  );

  const windowSize = Math.max(1, Math.floor(sampleRate * 0.03)); // 30ms
  const padWindows = 5; // 150ms of padding either side
  const threshold = 600; // average |amplitude| above this == speech

  const isLoud = (start: number) => {
    let sum = 0;
    const end = Math.min(aligned.length, start + windowSize);
    for (let i = start; i < end; i++) sum += Math.abs(aligned[i]);
    return sum / (end - start) > threshold;
  };

  // Find first speech window
  let firstSpeech = -1;
  for (let i = 0; i + windowSize <= aligned.length; i += windowSize) {
    if (isLoud(i)) {
      firstSpeech = i;
      break;
    }
  }
  if (firstSpeech === -1) return pcm; // no speech detected — pass through

  // Find last speech window
  let lastSpeech = firstSpeech;
  for (let i = aligned.length - windowSize; i >= 0; i -= windowSize) {
    if (isLoud(i)) {
      lastSpeech = i;
      break;
    }
  }

  const startIdx = Math.max(0, firstSpeech - windowSize * padWindows);
  const endIdx = Math.min(
    aligned.length,
    lastSpeech + windowSize * (padWindows + 1),
  );
  const trimmed = aligned.slice(startIdx, endIdx);
  return Buffer.from(trimmed.buffer, trimmed.byteOffset, trimmed.byteLength);
}

// Skip the LLM proof-reader when Chirp 2 is at least this confident — such
// transcripts are reliably correct, so the ~400ms correction pass isn't worth
// it. A confidence of 0 means "unknown" and falls below the bar, so those still
// get proofread (the safe default).
const PROOFREAD_CONFIDENCE_MAX = 0.85;

const SA_PATH = path.resolve(process.cwd(), "google-service-account.json");

// Chirp 2 is regional — not available in `global`. us-central1 has the
// broadest Chirp 2 coverage (incl. ka-GE). The SpeechClient also needs
// a region-specific endpoint, otherwise it goes to global by default.
const REGION = "us-central1";
const REGIONAL_ENDPOINT = `${REGION}-speech.googleapis.com`;

let cachedClient: V2SpeechClient | null = null;
let cachedProjectId: string | null = null;

function getClient(): { client: V2SpeechClient; projectId: string } {
  if (cachedClient && cachedProjectId) {
    return { client: cachedClient, projectId: cachedProjectId };
  }
  if (!fs.existsSync(SA_PATH)) {
    throw new Error(
      `google-service-account.json not found at ${SA_PATH}. ` +
        `Download it from GCP IAM → Service Accounts → Keys.`,
    );
  }
  const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8")) as {
    project_id?: string;
  };
  if (!sa.project_id) {
    throw new Error("service account JSON missing project_id");
  }
  cachedProjectId = sa.project_id;
  cachedClient = new v2.SpeechClient({
    keyFilename: SA_PATH,
    apiEndpoint: REGIONAL_ENDPOINT,
  });
  return { client: cachedClient, projectId: cachedProjectId };
}

// Phrase context for biasing recognition toward our domain vocabulary.
// v2's "adaptation" feature works differently from v1's speechContexts —
// we pass a PhraseSet inline. Same 250-word list as the v1 endpoint.
const PHRASE_BOOST: string[] = [
  // Greetings & politeness
  "გამარჯობა", "სალამი", "გაგიმარჯოს", "მადლობა", "დიდი მადლობა",
  "არაფრის", "ბოდიში", "გთხოვ", "კი", "არა", "კარგი", "ნორმალურად",
  // Common verbs
  "მითხარი", "მომიყევი", "აჩვენე", "დამიყენე", "გამომაღვიძე", "შემახსენე",
  "გააჩერე", "ჩამირთე", "გადააქციე", "შეაჩერე", "გადადი", "გაგრძელე",
  "მინდა", "შემიძლია", "ვიცი", "ვფიქრობ", "ვარ", "ხარ", "არის",
  "ვაკეთებ", "ვხედავ", "ვისმენ", "ვამბობ", "ვცდილობ",
  // Cities
  "თბილისი", "ბათუმი", "ქუთაისი", "რუსთავი", "გორი", "ფოთი", "ზუგდიდი",
  "ახალციხე", "თელავი", "მცხეთა", "ბორჯომი", "გუდაური", "ბაკურიანი",
  "ოზურგეთი", "ცხინვალი", "სოხუმი",
  // Weather
  "ამინდი", "გრადუსი", "გრადუსია", "ცელსიუსი", "წვიმა", "თოვლი", "ქარი",
  "ცივა", "ცხელა", "თბილა", "მზიანი", "ღრუბლიანი", "ნისლი",
  // Time
  "საათი", "საათია", "წუთი", "წამი", "ნახევარი", "მეოთხედი",
  "დილა", "საღამო", "ღამე", "შუადღე", "დღეს", "ხვალ", "ზეგ", "გუშინ",
  "კვირა", "თვე", "წელი",
  // Days
  "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი",
  "შაბათი", "კვირას",
  // Numerals 1-30
  "ერთი", "ორი", "სამი", "ოთხი", "ხუთი", "ექვსი", "შვიდი", "რვა",
  "ცხრა", "ათი", "თერთმეტი", "თორმეტი", "ცამეტი", "თოთხმეტი",
  "თხუთმეტი", "თექვსმეტი", "ჩვიდმეტი", "თვრამეტი", "ცხრამეტი", "ოცი",
  "ოცდაერთი", "ოცდახუთი", "ოცდაათი", "ორმოცი", "ორმოცდაათი", "სამოცი",
  "ასი", "ათასი",
  // App intents
  "ტაიმერი", "მაღვიძარა", "შეტყობინება", "მუსიკა", "სიმღერა",
  "შემდეგი", "წინა", "პაუზა", "გაგრძელება", "თავიდან",
  // Sample utterances
  "რა ამინდია თბილისში", "რომელი საათია", "დამიყენე ტაიმერი ხუთ წუთზე",
  "გამომაღვიძე ხვალ შვიდ საათზე", "ჩამირთე მუსიკა", "შემდეგი სიმღერა",
  "გააჩერე მუსიკა", "მითხარი ხუმრობა", "მომიყევი რამე",
  // Assistant
  "Mia", "მია",
];

/**
 * LLM-based proofreader. Chirp 2 occasionally returns a phonetically-similar
 * wrong word (homophone). GPT-4o-mini with a strict prompt corrects those
 * cases while leaving correct transcripts untouched. ~400ms added latency.
 *
 * Falls back to the raw Chirp text if the LLM call fails or returns nothing.
 */
async function correctTranscript(text: string): Promise<string> {
  if (!text || text.length < 2) return text;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "შენ ხარ ქართული ხმოვანი ტრანსკრიფციის გამსწორებელი. " +
            "ავტომატური სისტემა ცდილობს ქართულის ამოცნობას და ხანდახან მცდარად ისმენს ფონეტიკურად მსგავს სიტყვას. " +
            "შენი ერთადერთი დავალება — გაასწორო აშკარა ფონეტიკური შეცდომები. " +
            "წესები: 1) გამოიტანე მხოლოდ გასწორებული ტექსტი, ბრჭყალების ან კომენტარების გარეშე. " +
            "2) არ გადააფრაზო, არ დაამატო სიტყვები, არ შეცვალო აზრი. " +
            "3) თუ ტექსტი უკვე გასაგებია — დააბრუნე უცვლელად. " +
            "4) ნუ შეცვლი წინადადების სტრუქტურას. " +
            "5) მხოლოდ ცალკეული სიტყვების გასწორება, თუ ფონეტიკურად ცხადია რა ითქვა.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 250,
    });
    const corrected = completion.choices[0]?.message?.content?.trim();
    return corrected && corrected.length > 0 ? corrected : text;
  } catch (err) {
    console.warn("[Chirp] LLM correction failed:", err);
    return text;
  }
}

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  let body: {
    audioBase64?: string;
    sampleRate?: number;
    languageCodes?: string[];
  };
  try {
    body = (await request.json()) as {
      audioBase64?: string;
      sampleRate?: number;
      languageCodes?: string[];
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.audioBase64) {
    return Response.json(
      { error: "audioBase64 is required" },
      { status: 400 },
    );
  }
  const sampleRateHertz = body.sampleRate ?? 16000;

  // Default is Georgian-only. In two-way interpreter mode the client sends
  // e.g. ["ka-GE", "ru-RU"] so Chirp 2 auto-detects which language was spoken.
  // When listening for more than just Georgian we skip the Georgian phrase
  // adaptation and the Georgian LLM proof-reader below — both would corrupt a
  // foreign-language transcript.
  const languageCodes =
    Array.isArray(body.languageCodes) && body.languageCodes.length > 0
      ? body.languageCodes
      : ["ka-GE"];

  let client: V2SpeechClient;
  let projectId: string;
  try {
    ({ client, projectId } = getClient());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "client init failed" },
      { status: 500 },
    );
  }

  // Decode + clean the audio once; reused across recognizers.
  const audioContent = normalizePcm(
    trimSilence(Buffer.from(body.audioBase64, "base64"), sampleRateHertz),
  );

  // Recognize with a SINGLE language code. Chirp 2 rejects multiple codes in
  // one request (INVALID_ARGUMENT), and its "auto" mode can't handle Georgian,
  // so two-way interpreter mode runs one recognition per language in parallel
  // and keeps the highest-confidence result (confidence cleanly separates the
  // spoken language from the forced wrong one — e.g. RU audio scores ~0.99 on
  // ru-RU vs ~0.55 on ka-GE).
  async function recognizeOne(code: string) {
    const isKa = code === "ka-GE";
    try {
      const [response] = await client.recognize(
        {
          recognizer: `projects/${projectId}/locations/${REGION}/recognizers/_`,
          config: {
            // Raw PCM has no container header — auto-detect fails. We send
            // LINEAR16 mono at whatever rate the client told us.
            explicitDecodingConfig: {
              encoding: "LINEAR16",
              sampleRateHertz,
              audioChannelCount: 1,
            },
            model: "chirp_2",
            languageCodes: [code],
            features: { enableAutomaticPunctuation: true },
            // Georgian domain phrase boost — only for the Georgian recognizer;
            // these phrases would bias a foreign transcript.
            ...(isKa && {
              adaptation: {
                phraseSets: [
                  {
                    inlinePhraseSet: {
                      phrases: PHRASE_BOOST.map((value) => ({
                        value,
                        boost: 10,
                      })),
                    },
                  },
                ],
              },
            }),
          },
          content: audioContent,
        },
        // Bound the gRPC call so a hung STT can't hold the request open.
        { timeout: 20_000 },
      );
      const t =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .join(" ")
          .trim() ?? "";
      const confs =
        response.results
          ?.map((r) => r.alternatives?.[0]?.confidence ?? 0)
          .filter((c) => c > 0) ?? [];
      const confidence =
        confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
      return { code, text: t, confidence };
    } catch (err) {
      // One bad language shouldn't sink the other — log and score it 0.
      console.warn(`[Chirp] recognize failed for ${code}:`, err);
      return { code, text: "", confidence: 0 };
    }
  }

  try {
    const candidates = await Promise.all(languageCodes.map(recognizeOne));
    // Highest confidence wins; on a tie prefer non-empty text, else the first.
    const winner = candidates.reduce((best, c) => {
      if (c.confidence !== best.confidence) {
        return c.confidence > best.confidence ? c : best;
      }
      return !best.text && c.text ? c : best;
    }, candidates[0]);

    const rawText = winner.text;
    const winnerIsKa = winner.code === "ka-GE";

    // LLM post-correction only for a Georgian winner (the proof-reader is
    // Georgian-specific and would mangle a Russian/English transcript) AND only
    // when Chirp 2 wasn't already confident — high-confidence transcripts skip
    // the pass for a free latency win.
    const needsProofread =
      winnerIsKa && winner.confidence < PROOFREAD_CONFIDENCE_MAX;
    const text =
      rawText && needsProofread ? await correctTranscript(rawText) : rawText;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Chirp] codes=[${languageCodes.join(",")}] winner=${winner.code} ` +
          `conf=${winner.confidence.toFixed(2)} "${rawText}"` +
          (text !== rawText ? ` → corrected "${text}"` : ""),
      );
    }

    return Response.json({
      text,
      raw: rawText,
      confidence: winner.confidence,
      detectedLanguage: winner.code,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Google v2 STT request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
