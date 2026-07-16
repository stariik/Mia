import ReactNativeBlobUtil from 'react-native-blob-util';

import { apiUrl, authHeaders } from './client';

/**
 * ElevenLabs (eleven_v3 — the only model that really speaks Georgian; the
 * server picks it, see synthesize-elevenlabs/route.ts). The only TTS provider:
 * Camb polled for seconds and OpenAI mispronounces Georgian.
 *
 * Returns the absolute local file path of the downloaded audio. Note this
 * awaits the COMPLETE file before returning, so synth latency (~2-3s) is paid
 * up front — that is the cost to beat if playback ever starts on first byte.
 */
export async function synthesizeWithElevenLabs(text: string): Promise<string> {
  const task = ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: 'mp3',
  }).fetch(
    'POST',
    apiUrl('/api/synthesize-elevenlabs'),
    { 'Content-Type': 'application/json', ...authHeaders() },
    JSON.stringify({ text }),
  );
  const res = await task;
  const info = res.info();
  if (info.status < 200 || info.status >= 300) {
    throw new Error(`TTS failed (${info.status})`);
  }
  return res.path();
}
