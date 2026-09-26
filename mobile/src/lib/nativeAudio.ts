import { createAudioPlayer } from 'expo-audio';

import { isExpoGo } from './runtime';

// nitro-sound isn't in Expo Go (importing it throws there), so it is required
// only in native builds; Expo Go plays through expo-audio instead.
type NitroSound = typeof import('react-native-nitro-sound').default;
const Sound: NitroSound | null = isExpoGo
  ? null
  : require('react-native-nitro-sound').default;

// The app's one nitro-sound file player. Unlike the orb's WebView player it
// needs no Activity/UI, so it serves both the screen-off headless turn (via
// nativePlayback) and the Translator's spoken translations.
//
// nitro-sound reports playback progress (currentPosition / duration in ms) via
// a single listener; we resolve when position reaches duration. A watchdog
// (duration + slack) guards against a missed final tick so a turn can't hang.

let resolveActive: (() => void) | null = null; // ends the in-flight play()

export const nativeAudio = {
  /** Play an audio file to completion. Resolves when playback ends. Starting a
   *  new play() settles any in-flight one first (replay taps, cleared queues). */
  async play(filePath: string): Promise<void> {
    resolveActive?.();
    const path = filePath.replace(/^file:\/\//, '');
    if (!Sound) return playWithExpoAudio(path);
    // Snappier completion detection than the ~0.5 s default.
    Sound.setSubscriptionDuration(0.1);
    Sound.removePlayBackListener();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;

      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        resolveActive = null;
        if (watchdog) clearTimeout(watchdog);
        Sound.removePlayBackListener();
        Sound.stopPlayer().catch(() => {});
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      resolveActive = () => finish();

      Sound.addPlayBackListener((e) => {
        if (e.duration > 0) {
          if (!watchdog) {
            // Fallback in case the terminal tick never arrives.
            watchdog = setTimeout(() => finish(), e.duration + 1500);
          }
          if (e.currentPosition >= e.duration) finish();
        }
      });

      Sound.startPlayer(path).catch((err) => finish(err));
    });
  },

  /** Stop current playback immediately AND resolve the pending play() so an
   *  interrupt (orb tap / app opened) never leaves the caller awaiting.
   *  finish() stops the player and clears the listener. */
  stop(): void {
    resolveActive?.();
  },
};

/** Expo Go path: same contract as nativeAudio.play, on an expo-audio player. */
function playWithExpoAudio(path: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const player = createAudioPlayer({ uri: `file://${path}` });
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolveActive = null;
      if (watchdog) clearTimeout(watchdog);
      sub.remove();
      try {
        player.remove();
      } catch {}
      resolve();
    };
    resolveActive = finish;

    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.duration > 0 && !watchdog) {
        // Fallback in case didJustFinish never arrives.
        watchdog = setTimeout(finish, status.duration * 1000 + 1500);
      }
      if (status.didJustFinish) finish();
    });
    player.play();
  });
}
