import ReactNativeBlobUtil from 'react-native-blob-util';

import type { TtsPlayback } from './assistantTurn';
import { orbAudio } from './orbAudio';

// Foreground playback backend: hands the synthesized audio to the orb's WebView
// player (HTML5 Audio + Web Audio) so it can drive the orb visualization from a
// real AnalyserNode. Requires the UI/Activity — for screen-off turns the native
// backend is used instead.
export const orbPlayback: TtsPlayback = {
  async play(filePath, mime) {
    const cleanPath = filePath.replace(/^file:\/\//, '');
    const base64 = await ReactNativeBlobUtil.fs.readFile(cleanPath, 'base64');
    await orbAudio.play(base64, mime);
  },
  stop() {
    orbAudio.stop();
  },
};
