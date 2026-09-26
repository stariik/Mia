import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';

// The app's few file operations, on expo-file-system so they work the same in
// Expo Go and in native builds. Paths are accepted with or without `file://`.

// Prefix for one-shot audio files; the launch sweep deletes leftovers by it.
const CACHE_PREFIX = 'mia-';

function toUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export const fs = {
  /** Fetch `url` into a new cache file and return its path (no `file://`).
   *  Throws on a non-2xx status. */
  async downloadToCache(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    ext: string,
  ): Promise<string> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = `${CACHE_PREFIX}${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const file = new File(Paths.cache, name);
    file.write(bytes);
    return file.uri.replace(/^file:\/\//, '');
  },

  readBase64(path: string): Promise<string> {
    return new File(toUri(path)).base64();
  },

  /** Best-effort delete; never throws. */
  async unlink(path: string): Promise<void> {
    try {
      new File(toUri(path)).delete();
    } catch {}
  },

  /** Delete audio files a crash or interrupted turn left in the cache. Also
   *  clears `RNFetchBlob*` files from builds that used react-native-blob-util. */
  sweepCache(): void {
    try {
      for (const entry of Paths.cache.list()) {
        if (
          entry instanceof File &&
          (entry.name.startsWith(CACHE_PREFIX) ||
            entry.name.startsWith('RNFetchBlob'))
        ) {
          try {
            entry.delete();
          } catch {}
        }
      }
    } catch {}
  },
};
