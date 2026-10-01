// POST /api/translate
// Body: { text: string, from: string, to: string }  (ISO codes, e.g. ka/ru/en)
// Returns: { text: string }  — the translation only.
//
// Dedicated, direction-known translation for the Translator screen. The UI
// knows which language was spoken, so this is one Google Cloud Translation
// call: ~200 ms (live mode translates every sentence) and, unlike an LLM, it
// can never answer the content instead of translating it.
import fs from "fs";
import path from "path";
import { TranslationServiceClient } from "@google-cloud/translate";
import { guard } from "@/lib/apiGuard";
import { LANGUAGES } from "@/lib/languages";

const SA_PATH = path.resolve(process.cwd(), "google-service-account.json");
let translator: { client: TranslationServiceClient; parent: string } | undefined;

// Built on first use, not at import: `next build` evaluates every route.
function getTranslator() {
  if (translator) return translator;
  const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8")) as { project_id?: string };
  if (!sa.project_id) throw new Error("service account JSON missing project_id");
  translator = {
    client: new TranslationServiceClient({ keyFilename: SA_PATH }),
    parent: `projects/${sa.project_id}/locations/global`,
  };
  return translator;
}

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
    const { client, parent } = getTranslator();
    const [response] = await client.translateText({
      parent,
      contents: [text],
      sourceLanguageCode: from,
      targetLanguageCode: to,
      mimeType: "text/plain",
    });
    const out = response.translations?.[0]?.translatedText?.trim() ?? "";
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
