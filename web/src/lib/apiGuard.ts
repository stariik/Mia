import { verifyToken } from "@/lib/auth/jwt";

// Gate the paid API routes (chat / STT / TTS): require a valid token, rate-limit
// per user, and cap total daily requests so a leaked URL or a runaway client
// can't drain the OpenAI / ElevenLabs / Google bill.
//
// ponytail: in-memory counters — they reset on restart and are per-instance.
// CEILING: move to Upstash/Redis once you run more than one server instance.

const WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 40; // per user — one voice turn is ~5 requests (chat + STT + per-sentence TTS)
const MAX_PER_DAY_GLOBAL = Number(process.env.DAILY_REQUEST_CAP || 5000);

const hits = new Map<string, number[]>(); // userId -> request timestamps
let dayKey = "";
let dayCount = 0;

export type Guarded = { userId: string } | { error: Response };

/** Verify auth + rate limit + daily budget. Returns the userId, or a Response
 *  the route should return immediately (401 / 429). */
export function guard(request: Request): Guarded {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Per-user sliding 1-minute window.
  const now = Date.now();
  const recent = (hits.get(payload.sub) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_MINUTE) {
    return {
      error: Response.json({ error: "rate limit exceeded" }, { status: 429 }),
    };
  }
  recent.push(now);
  hits.set(payload.sub, recent);

  // Global daily budget cap (resets at UTC midnight).
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (dayCount >= MAX_PER_DAY_GLOBAL) {
    return {
      error: Response.json({ error: "daily limit reached" }, { status: 429 }),
    };
  }
  dayCount++;

  return { userId: payload.sub };
}
