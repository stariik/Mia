import ReactNativeBlobUtil from 'react-native-blob-util';

import { apiUrl, authHeaders } from './client';

/**
 * ElevenLabs Flash v2.5 multilingual (Georgian). The only TTS provider.
 * Camb (polled for seconds) and OpenAI (mispronounces Georgian) were removed.
 *
 * Returns the absolute local file path of the downloaded audio.
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
