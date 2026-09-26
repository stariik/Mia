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
import { FinishReason } from "@google/genai";
import { gemini, FAST_MODEL, LOW_THINKING } from "@/lib/gemini";
import { guard } from "@/lib/apiGuard";

type V2SpeechClient = InstanceType<typeof v2.SpeechClient>;

/**
 * RMS-normalize PCM16 audio to -20 dBFS (the level ASR pipelines expect).
 * Mobile mic gain varies wildly across phones and rooms — normalizing makes
 * Chirp 2 see consistently-leveled input, which measurably improves accuracy
 * on quiet recordings.
 *
 * This used to peak-normalize, which is fragile: a single click, pop or door
 * slam sets the peak, so genuinely quiet speech got no gain at all — exactly
 * the recording this is here to rescue. RMS reflects the bulk of the signal,
 * so a transient can't hijack it; a peak guard then keeps the result from
 * clipping.
 *
 * Boost only, never attenuate (attenuating can't undo clipping in an
 * already-too-loud take), and capped at +18 dB so near-silence isn't
 * amplified into a wall of hiss.
 */
function normalizePcm(pcm: Buffer): Buffer {
  if (pcm.length < 4) return pcm;
  const samples = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length),
  );

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return pcm;

  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms === 0) return pcm;

  // Target = -20 dBFS RMS = 32768 * 10^(-20/20) ≈ 3277
  const TARGET_RMS = 3277;
  const MAX_GAIN = 8; // +18 dB
  let gain = Math.min(MAX_GAIN, TARGET_RMS / rms);
  // Peak guard: leave 10% headroom so normalization never introduces clipping.
  gain = Math.min(gain, (32767 * 0.9) / peak);
  if (gain <= 1) return pcm; // already loud enough — don't touch it

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
 * Trim leading and trailing silence from raw PCM16 mono audio. The native wake
 * capture sends its whole buffer, and Chirp 2's sync recognize caps at 60s, so
 * this bounds what we send. (The foreground app already trims client-side to
 * shrink the upload; a second pass over trimmed audio is near-idempotent.)
 *
 * The threshold is derived from the clip's own ambient level rather than a
 * fixed number. A fixed threshold clipped the first word of any utterance that
 * started softly and got louder — the leading edge landed on the loud part and
 * the padding couldn't reach back to the onset. The first word is usually the
 * intent word, so that was expensive.
 *
 * Deliberately biased toward keeping audio: a generous leading pad, a
 * conservative threshold floor, and the whole clip returned when nothing
 * clearly reads as speech. Trimming exists for upload size and the 60s cap —
 * it can only ever hurt accuracy, so it errs toward doing less.
 */
function trimSilence(pcm: Buffer, sampleRate: number): Buffer {
  if (pcm.length < 4) return pcm;
  // Read PCM16 little-endian as Int16Array
  const aligned = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length),
  );

  const windowSize = Math.max(1, Math.floor(sampleRate * 0.03)); // 30ms
  const leadPadWindows = 10; // 300ms before speech — soft onsets live here
  const tailPadWindows = 8; // 240ms after

  // Per-window mean |amplitude|.
  const energies: number[] = [];
  for (let i = 0; i + windowSize <= aligned.length; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) sum += Math.abs(aligned[j]);
    energies.push(sum / windowSize);
  }
  if (energies.length === 0) return pcm;

  // 20th percentile ≈ this room's noise floor. Speech has to clear 3x that,
  // bounded so a noisy clip can't push the bar above real speech and a silent
  // one can't drop it onto hiss.
  const sorted = [...energies].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.min(1200, Math.max(250, noiseFloor * 3));

  let firstIdx = -1;
  for (let w = 0; w < energies.length; w++) {
    if (energies[w] > threshold) {
      firstIdx = w;
      break;
    }
  }
  if (firstIdx === -1) return pcm; // nothing clearly speech — send it all

  let lastIdx = firstIdx;
  for (let w = energies.length - 1; w >= firstIdx; w--) {
    if (energies[w] > threshold) {
      lastIdx = w;
      break;
    }
  }

  const startIdx = Math.max(0, (firstIdx - leadPadWindows) * windowSize);
  const endIdx = Math.min(
    aligned.length,
    (lastIdx + 1 + tailPadWindows) * windowSize,
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

// Boost strength for the phrase set below. Google's range is 0-20, and high
// values cause over-triggering — the recognizer substituting a boosted phrase
// for what was actually said. `STT_PHRASE_BOOST=0` disables adaptation
// entirely, which is worth A/B-ing: Chirp models have historically ignored
// model adaptation (accepting the field and silently dropping it), in which
// case this whole block is dead weight and the accuracy lever is elsewhere.
// Compare the `raw` values in the log line below with it on vs off.
const BOOST = Number(process.env.STT_PHRASE_BOOST ?? 10);

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
 * wrong word (homophone). A fast Gemini model with a strict prompt corrects those
 * cases while leaving correct transcripts untouched. ~400ms added latency.
 *
 * Falls back to the raw Chirp text if the LLM call fails or returns nothing.
 */
async function correctTranscript(text: string): Promise<string> {
  if (!text || text.length < 2) return text;
  try {
    const response = await gemini().models.generateContent({
      model: FAST_MODEL,
      contents: text,
      config: {
        temperature: 0.1,
        // Georgian is token-heavy: a 47-word utterance already costs ~150.
        maxOutputTokens: 500,
        thinkingConfig: LOW_THINKING,
        systemInstruction:
          "შენ ხარ ქართული ხმოვანი ტრანსკრიფციის გამსწორებელი. " +
            "ავტომატური სისტემა ცდილობს ქართულის ამოცნობას და ხანდახან მცდარად ისმენს ფონეტიკურად მსგავს სიტყვას. " +
            "შენი ერთადერთი დავალება — გაასწორო აშკარა ფონეტიკური შეცდომები. " +
            "წესები: 1) გამოიტანე მხოლოდ გასწორებული ტექსტი, ბრჭყალების ან კომენტარების გარეშე. " +
            "2) არ გადააფრაზო, არ დაამატო სიტყვები, არ შეცვალო აზრი. " +
            "3) თუ ტექსტი უკვე გასაგებია — დააბრუნე უცვლელად. " +
            "4) ნუ შეცვლი წინადადების სტრუქტურას. " +
            "5) მხოლოდ ცალკეული სიტყვების გასწორება, თუ ფონეტიკურად ცხადია რა ითქვა.",
      },
    });
    // A cut-off correction would silently replace a whole transcript.
    if (response.candidates?.[0]?.finishReason !== FinishReason.STOP) return text;
    const corrected = response.text?.trim();
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
  const t0 = Date.now();
  const decoded = Buffer.from(body.audioBase64, "base64");
  const audioContent = normalizePcm(trimSilence(decoded, sampleRateHertz));
  const secs = (b: Buffer) => (b.length / 2 / sampleRateHertz).toFixed(1);

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
            ...(isKa &&
              BOOST > 0 && {
                adaptation: {
                  phraseSets: [
                    {
                      inlinePhraseSet: {
                        phrases: PHRASE_BOOST.map((value) => ({
                          value,
                          boost: BOOST,
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

    const tRecognized = Date.now();
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

    // Always logged, not dev-only: this line is how STT accuracy gets tuned.
    // `raw` vs corrected shows whether the proofreader is earning its ~400ms,
    // `conf` shows whether the PROOFREAD_CONFIDENCE_MAX gate ever fires (Chirp 2
    // returns 0 for "unknown", which is below the bar and always proofreads),
    // and the audio seconds show whether trimSilence is eating speech.
    console.log(
      `[Chirp] boost=${BOOST} codes=[${languageCodes.join(",")}] ` +
        `winner=${winner.code} conf=${winner.confidence.toFixed(2)} ` +
        `audio=${secs(decoded)}s→${secs(audioContent)}s ` +
        `recognize=${tRecognized - t0}ms proofread=${Date.now() - tRecognized}ms ` +
        `raw="${rawText}"` +
        (text !== rawText ? ` → corrected "${text}"` : ""),
    );

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
