import Sound from 'react-native-nitro-sound';

// Lightweight TTS playback for screens without the orb WebView (the Translator
// screen). Uses nitro-sound's player. play() resolves when playback finishes
// (or errors); calling it again — or stop() — cancels any current playback.

let playing = false;
let resolveCurrent: (() => void) | null = null;

function settle() {
  const r = resolveCurrent;
  resolveCurrent = null;
  playing = false;
  try {
    Sound.removePlayBackListener();
  } catch {}
  r?.();
}

export async function stopAudio(): Promise<void> {
  if (!playing) return;
  try {
    await Sound.stopPlayer();
  } catch {}
  settle();
}

/** Play a local audio file; resolves when it finishes (never rejects). */
export async function playAudioFile(path: string): Promise<void> {
  await stopAudio();
  // nitro-sound wants a bare filesystem path on Android.
  const uri = path.replace(/^file:\/\//, '');
  playing = true;
  return new Promise<void>((resolve) => {
    resolveCurrent = resolve;
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      try {
        await Sound.stopPlayer();
      } catch {}
      settle();
    };
    try {
      Sound.addPlayBackListener((e: { currentPosition: number; duration: number }) => {
        // Finished when we reach (≈) the end. duration/position are in ms.
        if (e.duration > 0 && e.currentPosition >= e.duration - 60) {
          void finish();
        }
      });
    } catch {}
    Sound.startPlayer(uri).catch(() => void finish());
  });
}
