import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { audioLevel } from '@/lib/audioLevel';
import type { Capture } from './controller';

export function expoCapture(): Capture {
  let stream: InstanceType<typeof AudioModule.AudioStream> | undefined;
  let subscriptions: { remove(): void }[] = [];
  let stopped = false;
  let starting = false;
  return {
    async start(frame, interrupted) {
      if (!AudioModule.AudioStream)
        throw new Error(
          'Update Expo Go to a version supporting SDK 57 audio streaming.',
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: false,
      });
      if (stopped) return;
      const own = new AudioModule.AudioStream({
        sampleRate: 16000,
        channels: 1,
        encoding: 'int16',
      });
      stream = own;
      subscriptions = [
        own.addListener('audioStreamBuffer', buffer => {
          if (stopped) return;
          const values = new Int16Array(buffer.data);
          let energy = 0;
          for (const value of values) energy += (value / 32768) ** 2;
          audioLevel.value = values.length
            ? Math.max(
                0,
                (20 *
                  Math.log10(
                    Math.max(1e-6, Math.sqrt(energy / values.length)),
                  ) +
                  60) /
                  60,
              )
            : 0;
          frame(buffer.data, buffer.sampleRate, buffer.channels);
        }),
        own.addListener('audioStreamStatus', status => {
          if (!status.isStreaming && !stopped) interrupted();
        }),
      ];
      starting = true;
      try {
        await own.start();
      } finally {
        starting = false;
        if (stopped) {
          try {
            own.stop();
          } finally {
            own.release();
            if (stream === own) stream = undefined;
          }
        }
      }
    },
    stop() {
      stopped = true;
      subscriptions.forEach(sub => sub.remove());
      subscriptions = [];
      try {
        stream?.stop();
      } finally {
        if (!starting) {
          stream?.release();
          stream = undefined;
        }
        audioLevel.value = 0;
      }
    },
  };
}
