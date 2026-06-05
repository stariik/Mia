import { useCallback, useEffect, useMemo, useRef } from 'react';
import { withTiming } from 'react-native-reanimated';

import { audioLevel } from '@/lib/audioLevel';
import { ensureMicrophonePermission } from './usePermissions';

// Picovoice voice-processor — captures PCM16 mono at 16kHz. Loaded via
// require so a missing native module fails cleanly (pipeline falls back to
// the file-based recorder).
let VoiceProcessorImpl:
  | {
      instance: {
        addFrameListener: (cb: (frame: number[]) => void) => void;
        // NOTE: the library's removeFrameListeners(listeners[]) takes an array;
        // calling it with no args throws (undefined.includes). clearFrameListeners()
        // is the correct "remove all" call.
        clearFrameListeners: () => void;
        start: (frameLength: number, sampleRate: number) => Promise<void>;
        stop: () => Promise<void>;
      };
    }
  | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@picovoice/react-native-voice-processor');
  VoiceProcessorImpl = mod.VoiceProcessor ?? null;
} catch (err) {
  console.warn('[PcmRecorder] voice-processor module unavailable:', err);
}

const FRAME_LENGTH = 512; // ~32ms at 16 kHz
// Picovoice's VoiceProcessor delivers PCM at exactly the rate requested here
// (it resamples internally on iOS; 16 kHz is universally supported on Android),
// so this value is authoritative and is threaded straight through to Chirp 2 —
// no device-rate guesswork. Single source of truth for the capture rate.
const SAMPLE_RATE = 16000;
// Memory safety cap (~20s) for a stuck recording. It does NOT auto-send —
// stopping is silence-detection or tap — so this only bounds RAM and won't
// truncate a normal sentence. Generous so legitimately long speech isn't cut.
const MAX_BUFFERED_SAMPLES = 20 * SAMPLE_RATE;
// Bytes per fromCharCode.apply call — safely under JS-engine argument limits.
const B64_CHUNK = 8192;

let firstFrameLogged = false;

/**
 * Audio level from PCM16 frame using dBFS curve (logarithmic, matches human
 * hearing). Same formula nitro-sound's metering callback used so the orb
 * feels identical across recorders.
 */
function rmsLevel(samples: number[]): number {
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

function encodePcm(chunks: Int16Array[]): string | null {
  if (chunks.length === 0) return null;
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  const btoa = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (!btoa) return null;
  const bytes = new Uint8Array(merged.buffer);
  // Build the binary string in chunks. Per-byte concatenation over a multi-MB
  // buffer stalls the JS thread for tens of ms right when the user stops
  // talking; chunked fromCharCode.apply is roughly an order of magnitude faster.
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + B64_CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

type StopResult = {
  /** Raw PCM16 @ 16kHz mono, base64, for the server-side STT pass. */
  audioBase64: string | null;
  sampleRate: number;
};

/**
 * Raw-PCM microphone recorder (the preferred capture path).
 *
 * Captures PCM16 mono @ 16kHz frames locally via Picovoice's voice-processor,
 * updates the shared `audioLevel` for the orb, and returns the full buffer as
 * base64 on stop() for a single server-side Chirp 2 transcription pass.
 *
 * There is no live-partial / streaming path: an earlier design streamed frames
 * over a WebSocket to OpenAI Realtime for live partials, but the per-frame
 * upsample + binary send lagged the orb, and Chirp 2's authoritative quality
 * made the partials redundant. Recording locally and transcribing on stop is
 * simpler and keeps the orb smooth — the trade-off is that text appears after
 * you stop speaking, not as you speak.
 */
export function usePcmRecorder() {
  const stateRef = useRef<'idle' | 'recording'>('idle');
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const totalSamplesRef = useRef(0);

  const cleanup = useCallback(() => {
    stateRef.current = 'idle';
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;
    try {
      VoiceProcessorImpl?.instance.clearFrameListeners();
      VoiceProcessorImpl?.instance.stop().catch(() => {});
    } catch {}
    audioLevel.value = withTiming(0, { duration: 220 });
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (stateRef.current === 'recording') return;
    if (!VoiceProcessorImpl) {
      throw new Error('PCM recorder unavailable (voice-processor not linked)');
    }
    const ok = await ensureMicrophonePermission();
    if (!ok) throw new Error('Microphone permission denied');

    stateRef.current = 'recording';
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;

    // Clear any stale listeners FIRST. Otherwise each start() stacks another
    // listener on the (singleton) processor and every frame is buffered N
    // times → audio plays back slow/duplicated and the cap fills early.
    VoiceProcessorImpl.instance.clearFrameListeners();
    VoiceProcessorImpl.instance.addFrameListener((frame: number[]) => {
      if (__DEV__ && !firstFrameLogged) {
        firstFrameLogged = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[PcmRecorder] first frame size=${frame.length} (expected ${FRAME_LENGTH})`,
        );
      }
      // Direct write — NOT withTiming. Starting a Reanimated animation on every
      // ~32ms frame floods the UI thread and stutters the whole app while
      // recording (and starves the VAD's poll timer). The orb eases visually
      // on its own; the VAD wants the raw, responsive value anyway.
      audioLevel.value = rmsLevel(frame);
      if (
        stateRef.current === 'recording' &&
        totalSamplesRef.current < MAX_BUFFERED_SAMPLES
      ) {
        pcmChunksRef.current.push(new Int16Array(frame));
        totalSamplesRef.current += frame.length;
      }
    });

    try {
      await VoiceProcessorImpl.instance.start(FRAME_LENGTH, SAMPLE_RATE);
    } catch (err) {
      cleanup();
      throw err;
    }
  }, [cleanup]);

  const stop = useCallback(async (): Promise<StopResult> => {
    if (stateRef.current !== 'recording') {
      const audioBase64 = encodePcm(pcmChunksRef.current);
      cleanup();
      return { audioBase64, sampleRate: SAMPLE_RATE };
    }
    stateRef.current = 'idle';
    try {
      await VoiceProcessorImpl?.instance.stop().catch(() => {});
      VoiceProcessorImpl?.instance.clearFrameListeners();
    } catch {}
    audioLevel.value = withTiming(0, { duration: 220 });

    const audioBase64 = encodePcm(pcmChunksRef.current);
    pcmChunksRef.current = [];
    totalSamplesRef.current = 0;
    return { audioBase64, sampleRate: SAMPLE_RATE };
  }, [cleanup]);

  // Release the native processor if the screen unmounts mid-recording.
  useEffect(() => cleanup, [cleanup]);

  return useMemo(() => ({ start, stop }), [start, stop]);
}
