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
