// Plain (non-hook) raw-PCM microphone capture via Picovoice's voice-processor.
//
// Captures PCM16 mono @ 16 kHz. This is the single source of truth for capture
// so BOTH the foreground recorder hook (usePcmRecorder) and the screen-off
// headless turn (headlessTurn) share identical capture logic. It deliberately
// holds no UI concerns — callers get raw frames via `onFrame` and decide what
// to do (drive the orb level, run VAD, etc.).
//
// The voice-processor is a process-wide singleton, so only one consumer may
// record at a time — which is fine, the mic is single anyway and the foreground
// and headless paths never run together.

// Loaded via require so a missing native module fails cleanly with a real
// error instead of crashing at import time (dev builds before linking).
let VoiceProcessorImpl:
  | {
      instance: {
        addFrameListener: (cb: (frame: number[]) => void) => void;
        clearFrameListeners: () => void;
        start: (frameLength: number, sampleRate: number) => Promise<void>;
        stop: () => Promise<void>;
      };
    }
  | null = null;
try {
  const mod = require('@picovoice/react-native-voice-processor');
  VoiceProcessorImpl = mod.VoiceProcessor ?? null;
} catch (err) {
  console.error('[pcmCapture] voice-processor module unavailable:', err);
}

export const PCM_SAMPLE_RATE = 16000;
const FRAME_LENGTH = 512; // ~32 ms at 16 kHz
// Memory-safety cap (~20 s) for a stuck recording. Stopping is silence-detection
// or a tap, so this only bounds RAM — generous so long speech isn't truncated.
const MAX_BUFFERED_SAMPLES = 20 * PCM_SAMPLE_RATE;
const B64_CHUNK = 8192; // bytes per fromCharCode.apply — under JS arg limits

/**
 * Audio level from a PCM16 frame using a dBFS curve (logarithmic, matches human
 * hearing). Same formula nitro-sound's metering used so the orb and the VAD
 * feel identical across recorders.
 */
export function rmsLevel(samples: number[]): number {
  let sum = 0;
  const len = samples.length;
  for (let i = 0; i < len; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / len);
  if (rms < 1e-6) return 0;
  const db = 20 * Math.log10(rms);
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

function mergeChunks(chunks: Int16Array[]): Int16Array {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

/**
 * Trim leading/trailing silence from PCM16 mono so we upload only speech.
 * Mirrors the server's trimSilence (web .../transcribe-google-v2): the recorder
 * buffers from start-tap to stop-tap, so a capture is often mostly silence.
 * Trimming here shrinks the base64 upload from up to ~20 s down to a few seconds
 * of actual speech — the bulk of STT round-trip time on a mobile network.
 *
 * The threshold comes from the clip's own ambient level, not a fixed number: a
 * fixed one clipped the first word of any utterance that started softly and got
 * louder, because the leading edge landed on the loud part and the padding
 * couldn't reach back to the onset. That word is usually the intent word.
 *
 * Biased toward keeping audio — trimming exists for upload size, so it can only
 * ever hurt accuracy. Generous leading pad, conservative threshold floor, whole
 * clip returned when nothing clearly reads as speech.
 */
export function trimSilence(
  samples: Int16Array,
  sampleRate: number,
): Int16Array {
  if (samples.length < 4) return samples;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.03)); // 30 ms
  const leadPadWindows = 10; // 300 ms before speech — soft onsets live here
  const tailPadWindows = 8; // 240 ms after

  // Per-window mean |amplitude|.
  const energies: number[] = [];
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    let sum = 0;
    for (let j = i; j < i + windowSize; j++) sum += Math.abs(samples[j]);
    energies.push(sum / windowSize);
  }
  if (energies.length === 0) return samples;

  // 20th percentile ≈ this room's noise floor. Speech clears 3x that, bounded
  // so a noisy clip can't push the bar above real speech and a silent one can't
  // drop it onto hiss.
  const sorted = [...energies].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.min(1200, Math.max(250, noiseFloor * 3));

  let firstIdx = -1;
  for (let w = 0; w < energies.length; w++) {
    if (energies[w] > threshold) {
      firstIdx = w;
      break;
    }
  }
  if (firstIdx === -1) return samples; // nothing clearly speech — let the server decide

  let lastIdx = firstIdx;
  for (let w = energies.length - 1; w >= firstIdx; w--) {
    if (energies[w] > threshold) {
      lastIdx = w;
      break;
    }
  }

  const startIdx = Math.max(0, (firstIdx - leadPadWindows) * windowSize);
  const endIdx = Math.min(
    samples.length,
    (lastIdx + 1 + tailPadWindows) * windowSize,
  );
  return samples.slice(startIdx, endIdx);
}

function encodePcm(samples: Int16Array): string | null {
  if (samples.length === 0) return null;
  const btoa = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (!btoa) return null;
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  );
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + B64_CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

export type PcmStopResult = {
  /** Raw PCM16 @ 16 kHz mono, base64, for the server-side STT pass. */
  audioBase64: string | null;
  sampleRate: number;
};

let state: 'idle' | 'recording' = 'idle';
let chunks: Int16Array[] = [];
let total = 0;

export const pcmCapture = {
  /** True when the voice-processor native module is linked. */
  available: VoiceProcessorImpl != null,

  isRecording(): boolean {
    return state === 'recording';
  },

  /**
   * Start capturing. `onFrame` is called for every ~32 ms frame (PCM16 numbers)
   * so callers can drive a level meter or VAD. Throws if unavailable or if the
   * native start fails. Does NOT request microphone permission — callers ensure
   * it (the foreground hook prompts; the headless turn relies on the grant the
   * wake word already required, since there's no Activity to prompt from).
   */
  async start(onFrame?: (frame: number[]) => void): Promise<void> {
    if (state === 'recording') return;
    if (!VoiceProcessorImpl) {
      throw new Error('PCM capture unavailable (voice-processor not linked)');
    }
    state = 'recording';
    chunks = [];
    total = 0;

    // Clear stale listeners FIRST — the processor is a singleton, so a leftover
    // listener would buffer every frame twice (slow/duplicated audio).
    VoiceProcessorImpl.instance.clearFrameListeners();
    VoiceProcessorImpl.instance.addFrameListener((frame: number[]) => {
      if (state === 'recording' && total < MAX_BUFFERED_SAMPLES) {
        chunks.push(new Int16Array(frame));
        total += frame.length;
      }
      onFrame?.(frame);
    });

    try {
      await VoiceProcessorImpl.instance.start(FRAME_LENGTH, PCM_SAMPLE_RATE);
    } catch (err) {
      reset();
      throw err;
    }
  },

  /** Stop and return the buffered audio as base64 PCM16. */
  async stop(): Promise<PcmStopResult> {
    state = 'idle';
    try {
      await VoiceProcessorImpl?.instance.stop().catch(() => {});
      VoiceProcessorImpl?.instance.clearFrameListeners();
    } catch {}
    const audioBase64 = encodePcm(
      trimSilence(mergeChunks(chunks), PCM_SAMPLE_RATE),
    );
    chunks = [];
    total = 0;
    return { audioBase64, sampleRate: PCM_SAMPLE_RATE };
  },

  /** Hard reset without returning audio (e.g. unmount mid-recording). */
  reset,
};

function reset(): void {
  state = 'idle';
  chunks = [];
  total = 0;
  try {
    VoiceProcessorImpl?.instance.clearFrameListeners();
    VoiceProcessorImpl?.instance.stop().catch(() => {});
  } catch {}
}
