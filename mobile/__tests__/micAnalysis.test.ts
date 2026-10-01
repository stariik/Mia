import {
  analyzeMicFrame,
  consumeMicOnset,
  resetMicAnalysis,
  takeMicFrame,
} from '../src/orb/micAnalysis';

const SR = 16000;

function tone(hz: number, amp = 0.3, len = 512, phase = 0): Int16Array {
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Math.round(amp * 32767 * Math.sin((2 * Math.PI * hz * (i + phase)) / SR));
  }
  return out;
}

function analyze(samples: ArrayLike<number>) {
  analyzeMicFrame(samples);
  const f = takeMicFrame();
  return { ...f };
}

beforeEach(() => resetMicAnalysis());

describe('micAnalysis', () => {
  it('reads silence as zero', () => {
    const f = analyze(new Int16Array(512));
    expect(f.level).toBe(0);
    expect(f.low).toBe(0);
    expect(f.mid).toBe(0);
    expect(f.high).toBe(0);
  });

  it('puts a 150 Hz tone in the low band', () => {
    const f = analyze(tone(150));
    expect(f.low).toBeGreaterThan(0.5);
    expect(f.low).toBeGreaterThan(f.mid + 0.3);
    expect(f.low).toBeGreaterThan(f.high + 0.3);
  });

  it('puts a 1 kHz tone in the mid band', () => {
    const f = analyze(tone(1000));
    expect(f.mid).toBeGreaterThan(0.5);
    expect(f.mid).toBeGreaterThan(f.low + 0.3);
    expect(f.mid).toBeGreaterThan(f.high + 0.3);
  });

  it('puts a 4 kHz tone in the high band', () => {
    const f = analyze(tone(4000));
    expect(f.high).toBeGreaterThan(0.5);
    expect(f.high).toBeGreaterThan(f.low + 0.3);
    expect(f.high).toBeGreaterThan(f.mid + 0.3);
  });

  it('scales with loudness', () => {
    const quiet = analyze(tone(1000, 0.01));
    resetMicAnalysis();
    const loud = analyze(tone(1000, 0.5));
    expect(loud.level).toBeGreaterThan(quiet.level);
    expect(loud.mid).toBeGreaterThan(quiet.mid);
  });

  it('latches an onset when sound bursts out of silence, until consumed', () => {
    for (let i = 0; i < 5; i++) analyze(new Int16Array(512));
    expect(takeMicFrame().onset).toBe(0);
    analyze(tone(300, 0.4));
    expect(takeMicFrame().onset).toBeGreaterThan(0);
    analyze(tone(300, 0.4, 512, 512)); // steady: no new onset, latch holds
    expect(takeMicFrame().onset).toBeGreaterThan(0);
    consumeMicOnset();
    expect(takeMicFrame().onset).toBe(0);
  });

  it('accepts frames of any length and plain number arrays', () => {
    const short = Array.from(tone(1000, 0.3, 300));
    const long = tone(1000, 0.3, 2048);
    expect(analyze(short).mid).toBeGreaterThan(0.3);
    expect(analyze(long).mid).toBeGreaterThan(0.3);
  });

  it('bumps seq on every frame', () => {
    const a = takeMicFrame().seq;
    analyzeMicFrame(tone(500));
    analyzeMicFrame(tone(500));
    expect(takeMicFrame().seq).toBe(a + 2);
  });
});
