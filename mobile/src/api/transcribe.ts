import ReactNativeBlobUtil from 'react-native-blob-util';
import RNEventSource from 'react-native-sse';

import { apiUrl, authHeaders } from './client';

// Abort the SSE if no event arrives within this window (server accepted the
// connection but never produced data) — mirrors the chat stream watchdog.
const STREAM_TRANSCRIBE_WATCHDOG_MS = 20_000;

export type StreamTranscribeParams = {
  filePath: string;
  onPartial: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (msg: string) => void;
};

/**
 * Streams a transcription from /api/transcribe-stream as SSE.
 * Reads the audio file as base64, posts JSON, and receives `{delta}` chunks
 * followed by a final `{text}` event. The resolved promise contains the
 * complete transcript.
 */
export function streamTranscribe({
  filePath,
  onPartial,
  onFinal,
  onError,
}: StreamTranscribeParams): { promise: Promise<string>; abort: () => void } {
  let closed = false;
  let source: RNEventSource | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (watchdog) clearTimeout(watchdog);
    source?.removeAllEventListeners();
    source?.close();
  };

  const promise = new Promise<string>(async (resolve, reject) => {
    let accumulated = '';
    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (closed) return;
        close();
        const msg = 'Transcription stream stalled';
        onError?.(msg);
        reject(new Error(msg));
      }, STREAM_TRANSCRIBE_WATCHDOG_MS);
    };
    try {
      const cleanPath = filePath.replace(/^file:\/\//, '');
      const audioBase64 = await ReactNativeBlobUtil.fs.readFile(
        cleanPath,
        'base64',
      );
      console.warn(
        '[Transcribe] read audio bytes(base64):',
        audioBase64.length,
        'url:',
        apiUrl('/api/transcribe-stream'),
      );

      source = new RNEventSource(apiUrl('/api/transcribe-stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ audioBase64, mime: 'audio/mp4' }),
        pollingInterval: 0,
      });
      resetWatchdog();

      source.addEventListener('message', (event) => {
        resetWatchdog();
        const raw = event.data?.trim();
        if (!raw) return;
        if (raw === '[DONE]') {
          close();
          resolve(accumulated.trim());
          return;
        }
        try {
          const parsed = JSON.parse(raw) as {
            delta?: string;
            text?: string;
            error?: string;
          };
          if (parsed.delta) {
            accumulated += parsed.delta;
            onPartial(accumulated);
          } else if (parsed.text != null) {
            accumulated = parsed.text;
            onFinal?.(accumulated);
          } else if (parsed.error) {
            onError?.(parsed.error);
            close();
            reject(new Error(parsed.error));
          }
        } catch {
          // Ignore malformed frames — server is the source of truth.
        }
      });

      source.addEventListener('error', (event) => {
        console.warn('[Transcribe] SSE error event:', JSON.stringify(event));
        const msg =
          (event as { message?: string })?.message ?? 'Transcription stream failed';
        onError?.(msg);
        close();
        reject(new Error(msg));
      });
    } catch (e) {
      console.warn('[Transcribe] setup threw:', e);
      const msg = e instanceof Error ? e.message : 'Failed to read audio file';
      onError?.(msg);
      reject(new Error(msg));
    }
  });

  return { promise, abort: close };
}
