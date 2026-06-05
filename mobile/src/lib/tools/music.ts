import { NativeModules, Platform } from 'react-native';

export type MusicProvider = 'spotify' | 'apple_music' | 'samsung_music';

export const MUSIC_PROVIDER_PACKAGES: Record<MusicProvider, string> = {
  spotify: 'com.spotify.music',
  apple_music: 'com.apple.android.music',
  samsung_music: 'com.sec.android.app.music',
};

type MusicNative = {
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  skipNext(): Promise<void>;
  skipPrevious(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isProviderInstalled(pkg: string): Promise<boolean>;
  playFromSearch(query: string, providerPackage: string | null): Promise<void>;
};

const Native = (NativeModules.MusicControlModule || null) as MusicNative | null;

function unsupported(action: string): Promise<void> {
  return Promise.reject(
    new Error(`music control unsupported on ${Platform.OS}: ${action}`),
  );
}

export const music = {
  pause: () => (Native ? Native.pause() : unsupported('pause')),
  resume: () => (Native ? Native.resume() : unsupported('resume')),
  togglePlay: () => (Native ? Native.togglePlay() : unsupported('toggle')),
  skipNext: () => (Native ? Native.skipNext() : unsupported('skip_next')),
  skipPrevious: () =>
    Native ? Native.skipPrevious() : unsupported('skip_previous'),
  stop: () => (Native ? Native.stop() : unsupported('stop')),
  restart: () => (Native ? Native.restart() : unsupported('restart')),

  isProviderInstalled(provider: MusicProvider): Promise<boolean> {
    if (!Native) return Promise.resolve(false);
    return Native.isProviderInstalled(MUSIC_PROVIDER_PACKAGES[provider]);
  },

  /**
   * Routes a search query to a specific provider's app via Android's
   * MEDIA_PLAY_FROM_SEARCH intent. If `provider` is omitted, Android picks
   * the user's default music app.
   *
   * Spotify and Apple Music auto-start playback of the top match. Samsung
   * Music searches only the device's local library.
   */
  playFromSearch(query: string, provider?: MusicProvider): Promise<void> {
    if (!Native) return unsupported('play_music');
    const pkg = provider ? MUSIC_PROVIDER_PACKAGES[provider] : null;
    return Native.playFromSearch(query, pkg);
  },
};
