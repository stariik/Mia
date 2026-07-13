import ReactNativeBlobUtil from 'react-native-blob-util';

import type { TtsPlayback } from './assistantTurn';
import { nativeAudio } from './nativeAudio';

// Screen-off playback backend: plays synthesized audio files via nitro-sound,
// no WebView / Activity required. Used by the headless wake turn.
export const nativePlayback: TtsPlayback = {
  play: async (filePath) => {
    try {
      await nativeAudio.play(filePath);
    } finally {
      // One-shot TTS cache file — same cleanup as orbPlayback.
      ReactNativeBlobUtil.fs
        .unlink(filePath.replace(/^file:\/\//, ''))
        .catch(() => {});
    }
  },
  stop: () => nativeAudio.stop(),
};
