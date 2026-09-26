// Plain (non-hook) raw-PCM microphone capture via Picovoice's voice-processor,
// or via expo-audio's AudioStream inside Expo Go (which lacks Picovoice).
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

import { AudioModule } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';

import { isExpoGo } from './runtime';

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
if (!isExpoGo) {
  try {
    const mod = require('@picovoice/react-native-voice-processor');
    VoiceProcessorImpl = mod.VoiceProcessor ?? null;
  } catch (err) {
    console.error('[pcmCapture] voice-processor module unavailable:', err);
  }
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
export function rmsLevel(samples: ArrayLike<number>): number {
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
 * of actual speech — the bulk of STT round-trip time on a mobile network. The
 * server still re-trims defensively (file/headless paths), so this is purely an
 * upload-size optimization; the generous 150 ms padding guards against clipping.
 */
function trimSilence(samples: Int16Array, sampleRate: number): Int16Array {
  if (samples.length < 4) return samples;
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.03)); // 30 ms
  const padWindows = 5; // 150 ms padding either side
  const threshold = 600; // mean |amplitude| above this == speech

  const isLoud = (start: number) => {
    let sum = 0;
    const end = Math.min(samples.length, start + windowSize);
    for (let i = start; i < end; i++) sum += Math.abs(samples[i]);
    return sum / (end - start) > threshold;
  };

  let firstSpeech = -1;
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    if (isLoud(i)) {
      firstSpeech = i;
      break;
    }
  }
  if (firstSpeech === -1) return samples; // no speech found — let the server decide

  let lastSpeech = firstSpeech;
  for (let i = samples.length - windowSize; i >= 0; i -= windowSize) {
    if (isLoud(i)) {
      lastSpeech = i;
      break;
    }
  }

  const startIdx = Math.max(0, firstSpeech - windowSize * padWindows);
  const endIdx = Math.min(
    samples.length,
    lastSpeech + windowSize * (padWindows + 1),
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

// Expo Go capture (expo-audio AudioStream). Null while not recording.
type ExpoStream = InstanceType<typeof AudioModule.AudioStream>;
let expoStream: ExpoStream | null = null;
let expoSub: EventSubscription | null = null;

/** First channel of an interleaved Int16 buffer, resampled to 16 kHz by
 *  averaging each output sample's source window (a crude low-pass that is
 *  plenty for speech-to-text). */
function toMono16k(
  data: ArrayBuffer,
  rate: number,
  channels: number,
): Int16Array {
  const raw = new Int16Array(data);
  const frames = Math.floor(raw.length / channels);
  const ratio = rate / PCM_SAMPLE_RATE;
  if (ratio <= 1 && channels === 1) return raw;
  const out = new Int16Array(Math.floor(frames / Math.max(ratio, 1)));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += raw[j * channels];
    out[i] = sum / (to - from);
  }
  return out;
}

async function startExpoStream(
  onFrame?: (frame: ArrayLike<number>) => void,
): Promise<void> {
  const stream = new AudioModule.AudioStream({
    sampleRate: PCM_SAMPLE_RATE,
    channels: 1,
    encoding: 'int16',
  });
  expoStream = stream;
  expoSub = stream.addListener('audioStreamBuffer', (buf) => {
    const frame = toMono16k(buf.data, buf.sampleRate, buf.channels);
    if (state === 'recording' && total < MAX_BUFFERED_SAMPLES) {
      chunks.push(frame);
      total += frame.length;
    }
    onFrame?.(frame);
  });
  await stream.start();
}

function stopExpoStream(): void {
  expoSub?.remove();
  expoSub = null;
  try {
    expoStream?.stop();
    expoStream?.release();
  } catch {}
  expoStream = null;
}

export const pcmCapture = {
  /** True when a capture backend exists (Picovoice, or Expo Go's stream). */
  available: VoiceProcessorImpl != null || isExpoGo,

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
  async start(onFrame?: (frame: ArrayLike<number>) => void): Promise<void> {
    if (state === 'recording') return;
    if (!VoiceProcessorImpl && isExpoGo) {
      state = 'recording';
      chunks = [];
      total = 0;
      try {
        await startExpoStream(onFrame);
      } catch (err) {
        reset();
        throw err;
      }
      return;
    }
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
    if (expoStream) {
      stopExpoStream();
    } else {
      try {
        await VoiceProcessorImpl?.instance.stop().catch(() => {});
        VoiceProcessorImpl?.instance.clearFrameListeners();
      } catch {}
    }
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
  if (expoStream) {
    stopExpoStream();
    return;
  }
  try {
    VoiceProcessorImpl?.instance.clearFrameListeners();
    VoiceProcessorImpl?.instance.stop().catch(() => {});
  } catch {}
}
