import { makeFilePlayback } from './filePlayback';
import { nativeAudio } from './nativeAudio';

// Screen-off playback backend: plays synthesized audio files via nitro-sound,
// no WebView / Activity required. Used by the headless wake turn.
//
// No streaming here — nitro-sound plays a finished file, and RN's fetch can't
// stream a response body anyway. Only the in-app orb's WebView can start on the
// first byte (see orbPlayback).
export const nativePlayback = makeFilePlayback((path, onStart) => {
  onStart?.();
  return nativeAudio.play(path);
}, nativeAudio.stop);
