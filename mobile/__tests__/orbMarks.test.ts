import {
  HALF_DAY,
  arcPath,
  dialAngle,
  pointAt,
  timerProgress,
  urgency,
} from '@/lib/orbMarks';

// The marks are driven from the wall clock every frame; these pin the maths
// that makes that motion continuous (no stepping) and correctly placed.

describe('orb marks geometry', () => {
  it('timer progress is continuous in time', () => {
    const start = 1_000_000;
    const end = start + 60_000;
    expect(timerProgress(start, start, end)).toBe(0);
    expect(timerProgress(start + 30_000, start, end)).toBeCloseTo(0.5);
    // A single 16 ms frame moves it by a sliver, not a whole second's step.
    const a = timerProgress(start + 30_000, start, end);
    const b = timerProgress(start + 30_016, start, end);
    expect(b - a).toBeCloseTo(16 / 60_000, 8);
    expect(timerProgress(end + 5_000, start, end)).toBe(1);
    expect(timerProgress(start - 5_000, start, end)).toBe(0);
  });

  it('a malformed timer counts as finished, never NaN', () => {
    expect(timerProgress(5, 10, 10)).toBe(1);
  });

  it('maps wall-clock time onto a 12-hour dial', () => {
    const utcMidnight = Date.UTC(2026, 0, 1);
    expect(dialAngle(utcMidnight, 0)).toBeCloseTo(0);
    expect(dialAngle(utcMidnight + 3 * 3_600_000, 0)).toBeCloseTo(Math.PI / 2);
    expect(dialAngle(utcMidnight + 15 * 3_600_000, 0)).toBeCloseTo(Math.PI / 2);
    // Tbilisi is UTC+4: 08:00 UTC is noon local, top of the dial.
    expect(dialAngle(utcMidnight + 8 * 3_600_000, 4 * 3_600_000)).toBeCloseTo(0);
    expect(HALF_DAY).toBe(12 * 3_600_000);
  });

  it('urgency builds smoothly only in the final window', () => {
    expect(urgency(20_000, 10_000)).toBe(0);
    expect(urgency(10_000, 10_000)).toBe(0);
    expect(urgency(5_000, 10_000)).toBeCloseTo(0.5);
    expect(urgency(0, 10_000)).toBe(1);
    expect(urgency(-1, 10_000)).toBe(1);
    expect(urgency(9_000, 10_000)).toBeLessThan(0.05); // eases in
  });

  it('angles run clockwise from 12 o\'clock', () => {
    const top = pointAt(100, 100, 50, 0);
    const right = pointAt(100, 100, 50, Math.PI / 2);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
  });

  it('draws arcs, and nothing for an empty one', () => {
    expect(arcPath(100, 100, 50, 0, 0)).toBe('M0 0');
    expect(arcPath(100, 100, 50, 0, Math.PI / 2)).toBe('M100.00 50.00A50.00 50.00 0 0 1 150.00 100.00');
    expect(arcPath(100, 100, 50, 0, Math.PI * 1.5)).toContain(' 0 1 1 ');
    // A full circle stays a drawable arc (start ≠ end).
    expect(arcPath(100, 100, 50, 0, Math.PI * 2)).not.toBe('M0 0');
  });
});
