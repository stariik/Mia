import type { TtsPlayback } from './assistantTurn';
import { nativeAudio } from './nativeAudio';

// Screen-off playback backend: plays synthesized audio files via nitro-sound,
// no WebView / Activity required. Used by the headless wake turn.
export const nativePlayback: TtsPlayback = {
  play: (filePath) => nativeAudio.play(filePath),
  stop: () => nativeAudio.stop(),
};
