import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// Built on first use, not at import: `next build` evaluates every route while
// collecting page data, and the Docker build deliberately ships no secrets.
let client: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  // 30s per-request timeout so a hung upstream can't pin a request open.
  return (client ??= new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 30_000 },
  }));
}

// Assistant and translator. 3.6 over 3.8 for cost: same tool calls and Georgian
// quality in the tools:probe comparison, and faster. One regression seen: asked
// "ხვალ?" after current weather, 3.6 invents a forecast (get_weather has none).
export const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// Transcript proofreading runs on every utterance, so it gets the fast model.
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";

// Thinking tokens count against maxOutputTokens, and the default level eats
// the small voice-reply budgets before any text is written. LOW works on 3.6
// and 3.8 (3.8 rejects MINIMAL).
export const LOW_THINKING = { thinkingLevel: ThinkingLevel.LOW };
