import { isLang, type Lang } from '@/lib/translateLanguages';

// The assistant's start_translation tool only QUEUES translator mode; the
// foreground turn opens it after Mia has finished her short reply (see
// runAssistantTurn), exactly like open_directions. Starting right away would
// open the interpreter's mic over her own voice.

export type TranslatorRequest = { from?: Lang; to?: Lang };

let queued: TranslatorRequest | null = null;

export function queueTranslator(args: { from?: unknown; to?: unknown }) {
  queued = {
    ...(isLang(args.from) && { from: args.from }),
    ...(isLang(args.to) && { to: args.to }),
  };
}

export function clearQueuedTranslator() {
  queued = null;
}

export function takeQueuedTranslator(): TranslatorRequest | null {
  const q = queued;
  queued = null;
  return q;
}

// ── Hand-off from the app-closed "Hey Mia" session ─────────────────────────
// That session has no screen to show the translator on. When it asks for
// translator mode it parks the request here and brings the app forward; the
// home screen picks it up as soon as it is visible. Both run in the same JS
// runtime (the headless task reuses the app's). Stale requests are dropped so
// a later, unrelated app open doesn't start interpreting.

const HANDOFF_TTL_MS = 30_000;
let handoff: { req: TranslatorRequest; at: number } | null = null;

export function parkTranslatorForForeground(req: TranslatorRequest) {
  handoff = { req, at: Date.now() };
}

export function takeTranslatorFromBackground(): TranslatorRequest | null {
  const h = handoff;
  handoff = null;
  if (!h || Date.now() - h.at > HANDOFF_TTL_MS) return null;
  return h.req;
}
