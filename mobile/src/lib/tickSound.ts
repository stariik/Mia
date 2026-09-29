import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// The soft click a scroll wheel makes as each row passes the centre. A small
// pool of players lets fast flicks overlap clicks instead of cutting each
// other off; a minimum gap stops a hard flick turning into a buzz.

const POOL_SIZE = 4;
const MIN_GAP_MS = 35;

let pool: AudioPlayer[] | null = null;
let next = 0;
let lastAt = 0;

function getPool(): AudioPlayer[] {
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const p = createAudioPlayer(require('../../assets/sounds/tick.wav'));
      p.volume = 0.6;
      return p;
    });
  }
  return pool;
}

export const tickSound = {
  /** Create the players ahead of time so the first click isn't late. */
  preload() {
    try {
      getPool();
    } catch {}
  },
  play() {
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    try {
      const players = getPool();
      const p = players[next];
      next = (next + 1) % players.length;
      p.seekTo(0).catch(() => {});
      p.play();
    } catch {}
  },
};
