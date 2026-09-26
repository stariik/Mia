/**
 * Streaming boost for quiet microphones. iOS AudioStream runs the session in
 * `.measurement` mode (no AGC), so speech arrives ~25 dB below what ASR expects.
 * Same target as the legacy route's normalizePcm (-20 dBFS RMS), but streaming:
 * gain follows the loudest 100 ms packet so far, so it only ever falls once
 * speech starts and never pumps the noise floor up between words.
 * Boost only; a per-packet peak guard prevents clipping.
 */
const TARGET_RMS = 3277; // -20 dBFS
const MAX_GAIN = 16; // +24 dB: legacy's +18 dB is not enough for -45 dBFS iPhone input

export function gainPacket(state: { loudest: number }, pcm: Buffer): Buffer {
  const n = pcm.length / 2;
  let squares = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2);
    squares += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  state.loudest = Math.max(state.loudest, Math.sqrt(squares / n));
  const gain = Math.min(
    MAX_GAIN,
    TARGET_RMS / state.loudest,
    (32767 * 0.9) / peak,
  );
  if (!(gain > 1)) return pcm;
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < n; i++)
    out.writeInt16LE(Math.round(pcm.readInt16LE(i * 2) * gain), i * 2);
  return out;
}
