import { NativeModules, Platform } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { haptics } from './haptics';

// The soft click (and haptic tick) a scroll wheel makes as each row passes
// the centre.
//
// On Android this goes to the native WheelTick module: a SoundPool sample plus
// the system CLOCK_TICK haptic, cheap enough to fire on every row without
// touching the scroll. Elsewhere — or on a build that predates the module —
// it falls back to a small pool of expo-audio players, with a wider gap so a
// hard flick doesn't turn into a buzz.

type WheelTickModule = { preload(): void; tick(volume: number): void };
const native: WheelTickModule | undefined =
  Platform.OS === 'android' ? NativeModules.WheelTick : undefined;

// TEMPORARY diagnostic: silences every click and vibration, to test whether
// the per-row click is what makes the wheel stutter. Set back to true.
const TICKS_ENABLED = false;

const VOLUME = 0.6;
const MIN_GAP_MS = native ? 30 : 45;
const POOL_SIZE = 4;

let pool: AudioPlayer[] | null = null;
let next = 0;
let lastAt = 0;

function getPool(): AudioPlayer[] {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const p = createAudioPlayer(require('../../assets/sounds/tick.wav'));
      p.volume = VOLUME;
      return p;
    });
  }
  return pool;
}

export const tickSound = {
  /** Load the sound ahead of time so the first click isn't late. */
  preload() {
    try {
      if (native) native.preload();
      else getPool();
    } catch {}
  },
  play() {
    if (!TICKS_ENABLED) return;
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    try {
      if (native) {
        native.tick(VOLUME);
        return;
      }
      const players = getPool();
      const p = players[next];
      next = (next + 1) % players.length;
      p.seekTo(0).catch(() => {});
      p.play();
      // Vibration on iOS is a long buzz, too heavy for a per-row tick.
      if (Platform.OS === 'android') haptics.selection();
    } catch {}
  },
};
