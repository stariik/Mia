import { makeFilePlayback, mimeForPath } from './filePlayback';
import ReactNativeBlobUtil from 'react-native-blob-util';

import type { TtsPlayback } from './assistantTurn';
import { orbAudio } from './orbAudio';

// Foreground playback backend for the in-app orb.
//
// Preferred path: the WebView fetches the audio itself and plays it through
// MediaSource as it arrives, so sound starts on the first byte (~1.4s) rather
// than after the complete file (~2.7s). It also skips the file→base64→bridge
// hop entirely.
//
// Fallback: if the WebView can't stream (no MediaSource, no token, fetch blew
// up), synthesize to a file in RN and hand it over as base64 — the path this
// used to take, kept because it is the difference between "slower" and "mute".
const fileFallback = makeFilePlayback(async (path, onStart) => {
  const base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
  onStart?.();
  await orbAudio.play(base64, mimeForPath(path));
}, () => orbAudio.stop());

export const orbPlayback: TtsPlayback = {
  async speak(text, onStart) {
    if (orbAudio.canStream()) {
      try {
        await orbAudio.speak(text, onStart);
        return;
      } catch (e) {
        // Don't fall back on an interrupt — stop() rejects in-flight sentences
        // on purpose, and re-synthesizing them would talk over the next turn.
        // Nor on a dead/wedged WebView: the fallback plays through the same
        // WebView, so it would just stall again.
        const msg = String(e);
        if (
          msg.includes('interrupt') ||
          msg.includes('stalled') ||
          msg.includes('webview terminated')
        ) {
          throw e;
        }
        console.warn('[TTS] stream failed, falling back to file:', e);
      }
    }
    return fileFallback.speak(text, onStart);
  },
  stop() {
    orbAudio.stop();
  },
};
