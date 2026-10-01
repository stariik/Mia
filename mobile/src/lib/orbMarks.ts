// Geometry for the timer/alarm marks around the orb. Pure worklet functions:
// the marks evaluate them on the UI thread every frame from the wall clock,
// so motion is continuous and React never re-renders to move them.
//
// Angles are radians clockwise from 12 o'clock.

const TAU = Math.PI * 2;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** Fraction of a timer that has elapsed, 0..1. */
export function timerProgress(
  now: number,
  startedAt: number,
  endsAt: number,
): number {
  'worklet';
  const total = endsAt - startedAt;
  if (!(total > 0)) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / total));
}

/** A local wall-clock time as an hour-hand angle on a 12-hour dial. */
export function dialAngle(ts: number, tzOffsetMs: number): number {
  'worklet';
  const local = ts + tzOffsetMs;
  const into = ((local % HALF_DAY_MS) + HALF_DAY_MS) % HALF_DAY_MS;
  return (into / HALF_DAY_MS) * TAU;
}

/**
 * 0 → 1 as a deadline approaches through its last `windowMs` — a gentle
 * smoothstep, for the "almost time" build.
 */
export function urgency(remainingMs: number, windowMs: number): number {
  'worklet';
  if (remainingMs <= 0) return 1;
  if (remainingMs >= windowMs) return 0;
  const x = 1 - remainingMs / windowMs;
  return x * x * (3 - 2 * x);
}

export function pointAt(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): { x: number; y: number } {
  'worklet';
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

/** SVG path of a clockwise arc from angle a0 sweeping `sweep` radians. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  sweep: number,
): string {
  'worklet';
  if (!(sweep > 0.0005)) return 'M0 0';
  const s = Math.min(sweep, TAU - 0.0005);
  const p0 = pointAt(cx, cy, r, a0);
  const p1 = pointAt(cx, cy, r, a0 + s);
  const large = s > Math.PI ? 1 : 0;
  return (
    `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}` +
    `A${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  );
}

/** Milliseconds east of UTC right now (getTimezoneOffset is west-positive). */
export function localOffsetMs(): number {
  return -new Date().getTimezoneOffset() * 60_000;
}

export const HALF_DAY = HALF_DAY_MS;
