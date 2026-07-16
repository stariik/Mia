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
export async function synthesizeWithElevenLabs(
  text: string,
  opts?: { complete?: boolean },
): Promise<string> {
  // Anything that downloads to a file and hands it to a plain player wants
  // ?complete=1 — the streaming endpoint omits the MP3 duration frame, so a
  // player has to estimate length from the bitrate, guesses short, and clips the
  // final syllable. Only the WebView's MediaSource path can take the streamed
  // shape safely, and that one doesn't come through here at all.
  const url = apiUrl('/api/synthesize-elevenlabs') + (opts?.complete ? '?complete=1' : '');
  const task = ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: 'mp3',
  }).fetch(
    'POST',
    url,
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
