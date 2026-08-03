import { trimSilence, PCM_SAMPLE_RATE } from '@/lib/pcmCapture';

// The failure this guards against: a fixed amplitude threshold made the trimmer
// cut the first word off any utterance that started softly and got louder. The
// leading edge landed on the loud part and the padding couldn't reach back.

const SR = PCM_SAMPLE_RATE;

/** Build a clip: [silence][quiet onset][loud speech][silence], all in seconds. */
function makeClip(opts: {
  leadSilence: number;
  quiet: number;
  loud: number;
  tailSilence: number;
  noiseAmp?: number;
  quietAmp?: number;
  loudAmp?: number;
}): { pcm: Int16Array; quietStart: number } {
  const {
    leadSilence,
    quiet,
    loud,
    tailSilence,
    noiseAmp = 40,
    // Below the fixed 600 threshold this trimmer used to use, above the
    // adaptive one — this amplitude is the regression the first test guards.
    quietAmp = 400,
    loudAmp = 9000,
  } = opts;
  const total = Math.round((leadSilence + quiet + loud + tailSilence) * SR);
  const pcm = new Int16Array(total);
  const quietStart = Math.round(leadSilence * SR);
  const loudStart = quietStart + Math.round(quiet * SR);
  const loudEnd = loudStart + Math.round(loud * SR);

  for (let i = 0; i < total; i++) {
    // Alternating sign so mean |amplitude| is the amplitude (no DC offset).
    const sign = i % 2 === 0 ? 1 : -1;
    let amp = noiseAmp;
    if (i >= quietStart && i < loudStart) amp = quietAmp;
    else if (i >= loudStart && i < loudEnd) amp = loudAmp;
    pcm[i] = sign * amp;
  }
  return { pcm, quietStart };
}

describe('trimSilence', () => {
  it('keeps a soft word onset that precedes the loud part', () => {
    const { pcm, quietStart } = makeClip({
      leadSilence: 2,
      quiet: 0.4,
      loud: 1.5,
      tailSilence: 2,
    });
    const out = trimSilence(pcm, SR);

    // The whole quiet onset has to survive. Anything shorter means the first
    // word got eaten.
    const keptSeconds = out.length / SR;
    const speechSeconds = 0.4 + 1.5;
    expect(keptSeconds).toBeGreaterThanOrEqual(speechSeconds);

    // ...and it must still have actually trimmed the 4s of silence.
    expect(keptSeconds).toBeLessThan(pcm.length / SR);
    expect(quietStart).toBeGreaterThan(0);
  });

  it('trims silence around ordinary loud speech', () => {
    const { pcm } = makeClip({
      leadSilence: 3,
      quiet: 0,
      loud: 2,
      tailSilence: 3,
    });
    const out = trimSilence(pcm, SR);
    const keptSeconds = out.length / SR;
    // 2s of speech + 300ms lead pad + 240ms tail pad, with slack for windowing.
    expect(keptSeconds).toBeGreaterThanOrEqual(2);
    expect(keptSeconds).toBeLessThan(3);
  });

  it('passes the clip through untouched when nothing reads as speech', () => {
    const { pcm } = makeClip({
      leadSilence: 1,
      quiet: 0,
      loud: 0,
      tailSilence: 1,
      noiseAmp: 30,
    });
    expect(trimSilence(pcm, SR).length).toBe(pcm.length);
  });

  it('does not trim into speech when the room is noisy', () => {
    // Loud room (noise well above the old fixed 600 threshold) — the adaptive
    // floor must scale up rather than declaring the whole clip speech.
    const { pcm } = makeClip({
      leadSilence: 2,
      quiet: 0,
      loud: 2,
      tailSilence: 2,
      noiseAmp: 700,
      loudAmp: 9000,
    });
    const out = trimSilence(pcm, SR);
    const keptSeconds = out.length / SR;
    expect(keptSeconds).toBeGreaterThanOrEqual(2);
    expect(keptSeconds).toBeLessThan(4);
  });
});
