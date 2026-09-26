import { synthesizeWithElevenLabs } from '@/api/synthesize';
import { fs } from '@/lib/fs';
import type { TtsPlayback } from './assistantTurn';

export function mimeForPath(path: string): string {
  return path.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
}

/**
 * Build a file-based TtsPlayback around any "play this local file" function.
 * One implementation of the pattern every non-streaming backend needs:
 *
 *  - synthesize the COMPLETE clip (?complete=1 — a plain player needs the MP3
 *    duration frame the streaming endpoint omits, or it clips the last
 *    syllable);
 *  - start synthesis BEFORE joining the chain, so the next sentence
 *    synthesizes while the previous one is still speaking (no mid-reply gap);
 *  - serialize playback on the chain (callers enqueue without waiting — see
 *    TtsPlayback.speak);
 *  - delete the one-shot cache file afterwards (leftovers from crashes are
 *    swept on app launch).
 *
 * Used by the headless wake turn (nitro-sound), the overlay orb (native
 * WebView), and the in-app orb's non-streaming fallback.
 */
export function makeFilePlayback(
  playFile: (path: string, onStart?: () => void) => Promise<void>,
  stop: () => void,
): TtsPlayback {
  let chain: Promise<void> = Promise.resolve();
  return {
    speak(text, onStart) {
      const synth = synthesizeWithElevenLabs(text, { complete: true });
      const p = chain.then(async () => {
        const path = (await synth).replace(/^file:\/\//, '');
        try {
          await playFile(path, onStart);
        } finally {
          fs.unlink(path);
        }
      });
      chain = p.catch(() => {});
      return p;
    },
    stop,
  };
}
