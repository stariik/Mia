// POST /api/translate
// Body: { text: string, from: string, to: string }  (ISO codes, e.g. ka/ru/en)
// Returns: { text: string }  — the translation only.
//
// Dedicated, direction-known translation for the Translator screen. Unlike the
// assistant's chat route, the source and target are explicit (the UI knows
// which language was spoken), so this is a single Gemini call with a tight
// prompt. It uses the full flash model deliberately — small models
// mistranslate Georgian and fall back to canned replies.
import { gemini, CHAT_MODEL, LOW_THINKING } from "@/lib/gemini";
import { guard } from "@/lib/apiGuard";
import { LANGUAGES } from "@/lib/languages";

export async function POST(request: Request) {
  const g = guard(request);
  if ("error" in g) return g.error;
  let body: { text?: string; from?: string; to?: string };
  try {
    body = (await request.json()) as { text?: string; from?: string; to?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const from = body.from && LANGUAGES[body.from] ? body.from : null;
  const to = body.to && LANGUAGES[body.to] ? body.to : null;

  if (!text) return Response.json({ text: "" });
  if (!from || !to) {
    return Response.json(
      { error: "unsupported language", supported: Object.keys(LANGUAGES) },
      { status: 400 },
    );
  }
  if (from === to) return Response.json({ text });

  try {
    const response = await gemini().models.generateContent({
      model: CHAT_MODEL,
      contents: text,
      config: {
        temperature: 0.2,
        maxOutputTokens: 600,
        thinkingConfig: LOW_THINKING,
        systemInstruction:
          `You are a professional ${LANGUAGES[from].en}→${LANGUAGES[to].en} interpreter. ` +
            `Translate the user's message from ${LANGUAGES[from].en} into ${LANGUAGES[to].en}. ` +
            "Output ONLY the translation — no quotes, no transliteration, no notes, no explanation, " +
            "and never answer or react to the content. Keep it natural and fluent for speech.",
      },
    });
    const out = response.text?.trim() ?? "";
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Translate] ${from}→${to}  "${text}"  →  "${out}"`);
    }
    return Response.json({ text: out });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "translate failed" },
      { status: 500 },
    );
  }
}
