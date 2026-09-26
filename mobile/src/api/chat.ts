import RNEventSource from 'react-native-sse';

import type { ClientToolCall } from '@/lib/tools/types';

import { apiUrl, authHeaders } from './client';

type ChatHistoryEntry = { role: 'user' | 'assistant'; content: string };

export type UserContext = {
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  // Active timers/alarms so the server can let the model cancel one by id.
  timers?: { id: string; label?: string; remainingSeconds: number }[];
  alarms?: { id: string; label?: string; hour: number; minute: number }[];
};

export type StreamChatParams = {
  message: string;
  history: ChatHistoryEntry[];
  userContext?: UserContext;
  onContent: (chunk: string) => void;
  onToolCalls?: (calls: ClientToolCall[]) => void;
  onError?: (message: string) => void;
  /** Milliseconds of silence between events before we abort. Default 15 s. */
  watchdogMs?: number;
};

type StreamedEvent =
  | { content: string }
  | { toolCalls: ClientToolCall[] }
  | { error: string };

/**
 * Streams Gemini responses from /api/chat as server-sent events.
 * Returns a promise that resolves when the stream closes or rejects on error.
 * Server side: web/src/app/api/chat/route.ts.
 */
export function streamChat({
  message,
  history,
  userContext,
  onContent,
  onToolCalls,
  onError,
  watchdogMs = 15_000,
}: StreamChatParams): { promise: Promise<void>; abort: () => void } {
  let closed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  // Hoisted so abort() can settle the promise as a clean cancellation —
  // otherwise an awaiter (the voice pipeline) hangs forever after abort.
  let settle: (() => void) | null = null;

  const source = new RNEventSource(apiUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message, history, userContext }),
    pollingInterval: 0,
  });

  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    const close = () => {
      if (closed) return;
      closed = true;
      if (watchdog) clearTimeout(watchdog);
      source.removeAllEventListeners();
      source.close();
    };

    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (!closed) {
          close();
          const err = new Error('Stream stalled');
          onError?.(err.message);
          reject(err);
        }
      }, watchdogMs);
    };

    resetWatchdog();

    source.addEventListener('message', (event) => {
      resetWatchdog();
      const raw = event.data?.trim();
      if (!raw || raw === '[DONE]') {
        close();
        resolve();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as StreamedEvent;
        if ('content' in parsed && parsed.content) onContent(parsed.content);
        else if ('toolCalls' in parsed && parsed.toolCalls?.length) {
          onToolCalls?.(parsed.toolCalls);
        } else if ('error' in parsed && parsed.error) {
          onError?.(parsed.error);
        }
      } catch {
        // Ignore malformed frames — server is the source of truth.
      }
    });

    source.addEventListener('error', (event) => {
      close();
      const err = new Error(
        (event as { message?: string })?.message ?? 'Chat stream failed',
      );
      onError?.(err.message);
      reject(err);
    });
  });

  return {
    promise,
    abort: () => {
      if (closed) return;
      closed = true;
      if (watchdog) clearTimeout(watchdog);
      source.removeAllEventListeners();
      source.close();
      settle?.(); // resolve (not reject): a deliberate cancel, not an error
    },
  };
}
