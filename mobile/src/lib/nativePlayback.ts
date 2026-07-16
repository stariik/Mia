import ReactNativeBlobUtil from 'react-native-blob-util';

import { synthesizeWithElevenLabs } from '@/api/synthesize';
import type { TtsPlayback } from './assistantTurn';
import { nativeAudio } from './nativeAudio';

// Screen-off playback backend: plays synthesized audio files via nitro-sound,
// no WebView / Activity required. Used by the headless wake turn.
//
// No streaming here — nitro-sound plays a finished file, and RN's fetch can't
// stream a response body anyway. Only the in-app orb's WebView can start on the
// first byte (see orbPlayback).

// Callers enqueue sentences without waiting, so serialize playback here. The
// synth call is deliberately started BEFORE joining the chain: that keeps the
// next sentence synthesizing while the previous one is still speaking, which is
// what stops a gap opening mid-reply.
let chain: Promise<void> = Promise.resolve();

async function playFile(filePath: string, onStart?: () => void) {
  try {
    onStart?.();
    await nativeAudio.play(filePath);
  } finally {
    // One-shot TTS cache file — same cleanup as orbPlayback.
    ReactNativeBlobUtil.fs
      .unlink(filePath.replace(/^file:\/\//, ''))
      .catch(() => {});
  }
}

export const nativePlayback: TtsPlayback = {
  speak(text, onStart) {
    // ?complete=1: MediaPlayer gets a finished MP3 with its duration frame.
    const synth = synthesizeWithElevenLabs(text, { complete: true });
    const p = chain.then(async () => {
      const filePath = await synth;
      await playFile(filePath, onStart);
    });
    chain = p.catch(() => {});
    return p;
  },
  stop: () => nativeAudio.stop(),
};
