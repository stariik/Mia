import { apiUrl, authHeaders } from './client';

const TRANSLATE_TIMEOUT_MS = 20_000;

/**
 * Translate `text` from one language to another via /api/translate (gpt-4o).
 * Source and target are ISO codes (ka/ru/en). Returns the translation only.
 */
export async function translateText(
  text: string,
  from: string,
  to: string,
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TRANSLATE_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl('/api/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text, from, to }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: string }).error ?? '';
      } catch {}
      throw new Error(`Translate ${res.status}: ${detail}`);
    }
    return ((await res.json()) as { text?: string }).text ?? '';
  } catch (err) {
    if (timedOut) throw new Error('Translation timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
