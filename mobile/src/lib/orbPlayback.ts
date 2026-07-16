import ReactNativeBlobUtil from 'react-native-blob-util';

import { synthesizeWithElevenLabs } from '@/api/synthesize';
import type { TtsPlayback } from './assistantTurn';
import { mimeForPath } from './assistantTurn';
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

// Serializes the fallback path. The streaming path is ordered inside the
// WebView's own queue, so it doesn't need this.
let fallbackChain: Promise<void> = Promise.resolve();

async function playViaFile(text: string, onStart?: () => void): Promise<void> {
  // ?complete=1: a plain <audio> needs the duration frame that ElevenLabs'
  // streaming endpoint omits, or it guesses short and clips the last syllable.
  const filePath = await synthesizeWithElevenLabs(text, { complete: true });
  const cleanPath = filePath.replace(/^file:\/\//, '');
  try {
    const base64 = await ReactNativeBlobUtil.fs.readFile(cleanPath, 'base64');
    onStart?.();
    await orbAudio.play(base64, mimeForPath(cleanPath));
  } finally {
    // Each spoken sentence is a one-shot cache file — delete it or the TTS
    // cache grows without bound (leftovers from crashes are swept on launch).
    ReactNativeBlobUtil.fs.unlink(cleanPath).catch(() => {});
  }
}

export const orbPlayback: TtsPlayback = {
  async speak(text, onStart) {
    if (orbAudio.canStream()) {
      try {
        await orbAudio.speak(text, onStart);
        return;
      } catch (e) {
        // Don't fall back on an interrupt — stop() rejects in-flight sentences
        // on purpose, and re-synthesizing them would talk over the next turn.
        if (String(e).includes('interrupt')) throw e;
        console.warn('[TTS] stream failed, falling back to file:', e);
      }
    }
    const p = fallbackChain.then(() => playViaFile(text, onStart));
    fallbackChain = p.catch(() => {});
    return p;
  },
  stop() {
    orbAudio.stop();
  },
};
