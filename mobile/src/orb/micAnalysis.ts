// Mic spectrum for the orb: turns each ~32 ms PCM16 frame into loudness, three
// frequency bands and syllable onsets.
//
// Runs on the JS thread inside the capture callback, so it is allocation-free:
// every buffer is created once at module load. A 512-point FFT is well under a
// millisecond per frame.
//
// Output is normalized against an adaptive noise floor, so a quiet room reads
// as ~0 and normal speech spans most of 0..1 regardless of mic gain. The VAD
// keeps using `audioLevel` (lib/audioLevel.ts); this feed is only for visuals.

const N = 512;
const SAMPLE_RATE = 16000;
const HZ_PER_BIN = SAMPLE_RATE / N;

// Band edges in bins: low 80–300 Hz, mid 300–2000 Hz, high 2000–7000 Hz.
const BANDS = [
  [Math.round(80 / HZ_PER_BIN), Math.round(300 / HZ_PER_BIN)],
  [Math.round(300 / HZ_PER_BIN), Math.round(2000 / HZ_PER_BIN)],
  [Math.round(2000 / HZ_PER_BIN), Math.round(7000 / HZ_PER_BIN)],
] as const;

// A full-scale sine through a Hann window puts ~(N/4)² × 1.5 of power into its
// peak bin and neighbours; dividing by that makes a full-scale tone ≈ 0 dB.
const POWER_REF = (N / 4) * (N / 4) * 1.5;
// dB above the floor before anything shows, and the span that maps to 0..1.
const KNEE_DB = 6;
const RANGE_DB = 30;
// Floors start at a quiet-room guess, fall fast and rise slowly (~8 s).
const FLOOR_INIT = [-62, -65, -65, -65];
const FLOOR_FALL = 0.3;
const FLOOR_RISE = 0.004;
const ONSET_THRESHOLD = 0.11;

/* eslint-disable no-bitwise -- bit reversal and power-of-two strides are the FFT */
const re = new Float32Array(N);
const im = new Float32Array(N);
const hann = new Float32Array(N);
const cosT = new Float32Array(N / 2);
const sinT = new Float32Array(N / 2);
const rev = new Uint16Array(N);

for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N);
  sinT[i] = -Math.sin((2 * Math.PI * i) / N);
}
for (let i = 0, bits = Math.log2(N); i < N; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  rev[i] = r;
}

/** In-place iterative radix-2 FFT over `re`/`im`. */
function fft() {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      const t = re[i];
      re[i] = re[j];
      re[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step];
        const s = sinT[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/* eslint-enable no-bitwise */

const floors = Float32Array.from(FLOOR_INIT);
const prev = new Float32Array(3);

/** The latest analysis. `onset` latches the strongest onset until taken. */
export type MicFrame = {
  seq: number;
  level: number;
  low: number;
  mid: number;
  high: number;
  onset: number;
};

const frame: MicFrame = { seq: 0, level: 0, low: 0, mid: 0, high: 0, onset: 0 };

function normalize(db: number, ch: number): number {
  const f = floors[ch];
  floors[ch] = f + (db - f) * (db < f ? FLOOR_FALL : FLOOR_RISE);
  const v = (db - floors[ch] - KNEE_DB) / RANGE_DB;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Analyze one PCM16 frame (any length; the newest 512 samples are used).
 * Call it from the capture callback, next to the `audioLevel` write.
 */
export function analyzeMicFrame(samples: ArrayLike<number>): void {
  const n = samples.length;
  if (n === 0) return;
  const take = n < N ? n : N;
  const pad = N - take;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const v = i < pad ? 0 : samples[n - take + (i - pad)] / 32768;
    sumSq += v * v;
    re[i] = v * hann[i];
    im[i] = 0;
  }
  fft();

  const rms = Math.sqrt(sumSq / take);
  frame.level = normalize(20 * Math.log10(rms + 1e-9), 0);

  let flux = 0;
  for (let b = 0; b < 3; b++) {
    const lo = BANDS[b][0];
    const hi = BANDS[b][1];
    let p = 0;
    for (let k = lo; k < hi; k++) p += re[k] * re[k] + im[k] * im[k];
    const v = normalize(10 * Math.log10(p / POWER_REF + 1e-12), b + 1);
    const d = v - prev[b];
    if (d > 0) flux += d;
    prev[b] = v;
    if (b === 0) frame.low = v;
    else if (b === 1) frame.mid = v;
    else frame.high = v;
  }
  if (flux > ONSET_THRESHOLD && flux > frame.onset) frame.onset = flux > 1 ? 1 : flux;
  frame.seq++;
}

/** The latest analysis. The returned object is shared and reused — copy
 *  fields out, don't hold on to it. Call consumeMicOnset() once forwarded. */
export function takeMicFrame(): MicFrame {
  return frame;
}

/** Clear the latched onset after the consumer has forwarded it. */
export function consumeMicOnset(): void {
  frame.onset = 0;
}

/** Test hook: back to the initial state. */
export function resetMicAnalysis(): void {
  floors.set(FLOOR_INIT);
  prev.fill(0);
  frame.seq = 0;
  frame.level = frame.low = frame.mid = frame.high = frame.onset = 0;
}
