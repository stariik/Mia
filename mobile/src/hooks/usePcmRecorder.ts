import { useCallback, useEffect, useMemo } from 'react';
import { withTiming } from 'react-native-reanimated';

import { audioLevel } from '@/lib/audioLevel';
import { analyzeMicFrame } from '@/orb/micAnalysis';
import {
  pcmCapture,
  rmsLevel,
  type PcmStopResult,
} from '@/lib/pcmCapture';

import { ensureMicrophonePermission } from './usePermissions';

/**
 * Raw-PCM microphone recorder hook (the preferred foreground capture path).
 *
 * Thin wrapper over the shared {@link pcmCapture} module: it adds the two
 * foreground-only concerns — prompting for the mic permission and driving the
 * orb's `audioLevel` from each frame. The actual capture/encode logic lives in
 * `pcmCapture` so the screen-off headless turn shares it exactly.
 *
 * There is no live-partial path: frames are buffered locally and the whole
 * buffer is transcribed (Chirp 2) on stop — text appears after you stop
 * speaking, not as you speak, which keeps the orb smooth.
 */
export function usePcmRecorder() {
  const start = useCallback(async (): Promise<void> => {
    const ok = await ensureMicrophonePermission();
    if (!ok) throw new Error('Microphone permission denied');
    // Direct write — NOT withTiming. Starting a Reanimated animation on every
    // ~32 ms frame floods the UI thread and starves the VAD poll. The orb eases
    // visually on its own; the VAD wants the raw, responsive value.
    await pcmCapture.start((frame) => {
      audioLevel.value = rmsLevel(frame);
      analyzeMicFrame(frame); // the orb's bands + syllable onsets
    });
  }, []);

  const stop = useCallback(async (): Promise<PcmStopResult> => {
    const result = await pcmCapture.stop();
    audioLevel.value = withTiming(0, { duration: 220 });
    return result;
  }, []);

  // Release the native processor if the screen unmounts mid-recording.
  useEffect(
    () => () => {
      pcmCapture.reset();
      audioLevel.value = withTiming(0, { duration: 220 });
    },
    [],
  );

  return useMemo(() => ({ start, stop }), [start, stop]);
}
