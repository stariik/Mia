import { useCallback, useEffect, useMemo, useRef } from 'react';
import Sound, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { withTiming } from 'react-native-reanimated';

import { audioLevel } from '@/lib/audioLevel';
import { ensureMicrophonePermission } from './usePermissions';

// Map dBFS to 0..1. Anything below -60 dB is treated as silence; 0 dB is max.
const dbToLevel = (db: number) => {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
};

export function useAudioRecorder() {
  const pathRef = useRef<string | null>(null);

  // Release the mic if the screen unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (pathRef.current) {
        Sound.stopRecorder().catch(() => {});
        Sound.removeRecordBackListener();
        pathRef.current = null;
        audioLevel.value = 0;
      }
    };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const ok = await ensureMicrophonePermission();
    if (!ok) throw new Error('Microphone permission denied');
    const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
    const path = `${dir}/rec-${Date.now()}.m4a`;
    pathRef.current = path;
    // 20 Hz metering — fast enough for visual reactivity without thrashing.
    Sound.setSubscriptionDuration(0.05);
    await Sound.startRecorder(
      path,
      {
        AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
        AudioSourceAndroid: AudioSourceAndroidType.MIC,
        OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
      },
      true, // meteringEnabled
    );
    Sound.addRecordBackListener((meta) => {
      const m = meta.currentMetering;
      if (typeof m !== 'number') return;
      // withTiming smooths the step between metering ticks so the orb glides
      // instead of stepping. 80 ms is a touch shorter than one tick (50 ms).
      audioLevel.value = withTiming(dbToLevel(m), { duration: 80 });
    });
  }, []);

  const stop = useCallback(async (): Promise<string | null> => {
    try {
      await Sound.stopRecorder();
    } catch {
      // Recorder already stopped — not fatal.
    }
    Sound.removeRecordBackListener();
    audioLevel.value = withTiming(0, { duration: 220 });
    const p = pathRef.current;
    pathRef.current = null;
    return p;
  }, []);

  return useMemo(() => ({ start, stop }), [start, stop]);
}
