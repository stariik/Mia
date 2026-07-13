import { apiUrl, authHeaders } from './client';

// Abort the request if the server hasn't responded in this window, so the UI
// never gets stuck on "Transcribing…" forever when the network/server hangs.
const TRANSCRIBE_TIMEOUT_MS = 20_000;

/**
 * Send PCM16 mono audio (base64) to the server's Google STT v2 (Chirp 2)
 * endpoint. Chirp 2 is Google's multilingual model and handles Georgian
 * substantially better than OpenAI's gpt-4o-transcribe.
 *
 * Throws on error/timeout or returns empty string if Chirp 2 produced no text.
 */
export async function transcribeGooglePcm(
  audioBase64: string,
  sampleRate: number,
  // Optional BCP-47 codes for bilingual listening (interpreter mode). Omit for
  // Georgian-only transcription.
  languageCodes?: string[],
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TRANSCRIBE_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl('/api/transcribe-google-v2'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        audioBase64,
        sampleRate,
        ...(languageCodes && languageCodes.length > 0 ? { languageCodes } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: string };
        detail = body.error ?? '';
      } catch {}
      throw new Error(`Chirp 2 (${res.status}): ${detail}`);
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? '';
  } catch (err) {
    if (timedOut) {
      throw new Error('Transcription timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
