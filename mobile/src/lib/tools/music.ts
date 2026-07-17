import { NativeModules, Platform } from 'react-native';

type MusicNative = {
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  skipNext(): Promise<void>;
  skipPrevious(): Promise<void>;
  restart(): Promise<void>;
};

const Native = (NativeModules.MusicControlModule || null) as MusicNative | null;

function unsupported(action: string): Promise<void> {
  return Promise.reject(
    new Error(`music control unsupported on ${Platform.OS}: ${action}`),
  );
}

// Universal music transport via Android media-key events — controls whatever
// app currently owns the audio session. Deliberately transport-only: the
// assistant cannot search or launch music (the system prompt says so too).
export const music = {
  pause: () => (Native ? Native.pause() : unsupported('pause')),
  resume: () => (Native ? Native.resume() : unsupported('resume')),
  togglePlay: () => (Native ? Native.togglePlay() : unsupported('toggle')),
  skipNext: () => (Native ? Native.skipNext() : unsupported('skip_next')),
  skipPrevious: () =>
    Native ? Native.skipPrevious() : unsupported('skip_previous'),
  restart: () => (Native ? Native.restart() : unsupported('restart')),
};
