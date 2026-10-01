import { ORB_CONFIG } from '../src/orb/config';
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

let seed = 1;
/** White noise at a given RMS in dBFS (deterministic). */
function noise(dbfs: number, len = 512): Int16Array {
  const rms = Math.pow(10, dbfs / 20);
  const scale = (rms / Math.sqrt(1 / 3)) * 32767;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    out[i] = Math.round((seed / 4294967296 - 0.5) * 2 * scale);
  }
  return out;
}

/** Start a capture session in a quiet room (~1 s of ambience). */
function room(dbfs = -60) {
  for (let i = 0; i < 30; i++) analyzeMicFrame(noise(dbfs));
}

function analyze(samples: ArrayLike<number>) {
  analyzeMicFrame(samples);
  const f = takeMicFrame();
  return { ...f };
}

beforeEach(() => {
  resetMicAnalysis();
  seed = 1;
});

describe('micAnalysis', () => {
  it('reads silence as zero', () => {
    const f = analyze(new Int16Array(512));
    expect(f.level).toBe(0);
    expect(f.low).toBe(0);
    expect(f.mid).toBe(0);
    expect(f.high).toBe(0);
  });

  it('puts a 150 Hz tone in the low band', () => {
    room();
    const f = analyze(tone(150));
    expect(f.low).toBeGreaterThan(0.5);
    expect(f.low).toBeGreaterThan(f.mid + 0.3);
    expect(f.low).toBeGreaterThan(f.high + 0.3);
  });

  it('puts a 1 kHz tone in the mid band', () => {
    room();
    const f = analyze(tone(1000));
    expect(f.mid).toBeGreaterThan(0.5);
    expect(f.mid).toBeGreaterThan(f.low + 0.3);
    expect(f.mid).toBeGreaterThan(f.high + 0.3);
  });

  it('puts a 4 kHz tone in the high band', () => {
    room();
    const f = analyze(tone(4000));
    expect(f.high).toBeGreaterThan(0.5);
    expect(f.high).toBeGreaterThan(f.low + 0.3);
    expect(f.high).toBeGreaterThan(f.mid + 0.3);
  });

  it('scales with loudness', () => {
    room();
    const quiet = analyze(tone(1000, 0.01));
    resetMicAnalysis();
    room();
    const loud = analyze(tone(1000, 0.5));
    expect(loud.level).toBeGreaterThan(quiet.level);
    expect(loud.mid).toBeGreaterThan(quiet.mid);
  });

  it('latches an onset when sound bursts out of silence, until consumed', () => {
    room();
    expect(takeMicFrame().onset).toBe(0);
    analyze(tone(300, 0.4));
    expect(takeMicFrame().onset).toBeGreaterThan(0);
    analyze(tone(300, 0.4, 512, 512)); // steady: no new onset, latch holds
    expect(takeMicFrame().onset).toBeGreaterThan(0);
    consumeMicOnset();
    expect(takeMicFrame().onset).toBe(0);
  });

  it('accepts frames of any length and plain number arrays', () => {
    room();
    const short = Array.from(tone(1000, 0.3, 300));
    const long = tone(1000, 0.3, 2048);
    expect(analyze(short).mid).toBeGreaterThan(0.3);
    expect(analyze(long).mid).toBeGreaterThan(0.3);
  });

  it('reads an ordinary room as silence from the first frame, and speech above it', () => {
    const { voiceOn, voiceOff } = ORB_CONFIG.audio;
    // ~3 s of -48 dBFS ambience: never mistaken for the user talking.
    for (let i = 0; i < 94; i++) {
      expect(analyze(noise(-48)).level).toBeLessThan(voiceOff);
    }
    // Speech-like bursts at -28 dBFS clear the voice gate.
    const burst = noise(-28);
    for (let i = 0; i < burst.length; i++) burst[i] += tone(220, 0.04)[i];
    expect(analyze(burst).level).toBeGreaterThan(voiceOn);
  });

  it('re-learns the room when a new capture session starts', () => {
    room(-48);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 5000; // a later session, after a pause
      expect(analyze(noise(-40)).level).toBeLessThan(ORB_CONFIG.audio.voiceOff);
    } finally {
      Date.now = realNow;
    }
  });

  it('bumps seq on every frame', () => {
    const a = takeMicFrame().seq;
    analyzeMicFrame(tone(500));
    analyzeMicFrame(tone(500));
    expect(takeMicFrame().seq).toBe(a + 2);
  });
});
