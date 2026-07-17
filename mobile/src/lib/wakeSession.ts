import { AppState } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { synthesizeWithElevenLabs } from '@/api/synthesize';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import {
  mimeForPath,
  runAssistantTurn,
  type TtsPlayback,
} from '@/lib/assistantTurn';
import { isGoodbye, pickFarewell, pickGreeting } from '@/lib/greetings';
import { nativePlayback } from '@/lib/nativePlayback';
import { orbOverlay } from '@/lib/orbOverlay';
import { wakeWord, type WakeEvent } from '@/lib/wakeWord';
import { useAuthStore } from '@/stores/authStore';

// The app-closed "Hey Jarvis / Hey Mia" session. Triggered by the native wake
// service (index.js → 'turn' event or the MiaWakeTurn headless task):
//
//   show orb → greet → native capture → STT → answer → loop until goodbye / tap
//   / silence → animate orb closed → re-arm wake detection.
//
// All mic capture is native (WakeWordService RECORD mode); JS only does network,
// the orb visuals, and flow. Screen on & unlocked → floating orb + multi-turn.
// Screen off/locked → voice-only, single turn (Android won't draw over the lock
// screen). See mobile/docs/hey-jarvis-rebuild-prompt.md.

const GREETING_SYNTH_TIMEOUT_MS = 6000; // network TTS for a greeting/farewell
const GREETING_PLAY_TIMEOUT_MS = 15_000; // hang guard only — clips are ~2s
const CAPTURE_TIMEOUT_MS = 20_000; // native VAD caps at 15s; slack so a missed event can't hang
const MAX_TURNS = 10; // safety cap on a runaway conversation loop

let running = false;

// Dev-only stage tracing. The wake session runs headless (no Metro attached),
// so logcat is the only window into it — keep these. Filter: [MiaBg].
const mlog = (...args: unknown[]) => {
  if (__DEV__) console.warn('[MiaBg]', ...args);
};

// Plays a synthesized file through the floating orb's WebView so the orb
// visualizes the reply.
//
// Unlike the in-app orb this does NOT stream: the overlay's WebView is owned by
// a native module, which only exposes playTts(base64), so RN must hand it a
// finished file. Teaching it to stream means a Kotlin change — worth doing after
// the in-app path proves out, since it would save ~1.4s here too.
let overlayChain: Promise<void> = Promise.resolve();

const overlayPlayback: TtsPlayback = {
  speak(text, onStart) {
    // ?complete=1: a plain player needs the duration frame the streaming
    // endpoint omits, or it clips the final syllable.
    const synth = synthesizeWithElevenLabs(text, { complete: true });
    const p = overlayChain.then(async () => {
      const filePath = await synth;
      const clean = filePath.replace(/^file:\/\//, '');
      try {
        const base64 = await ReactNativeBlobUtil.fs.readFile(clean, 'base64');
        onStart?.();
        await orbOverlay.playTts(base64, mimeForPath(clean));
      } finally {
        ReactNativeBlobUtil.fs.unlink(clean).catch(() => {});
      }
    });
    overlayChain = p.catch(() => {});
    return p;
  },
  stop() {
    orbOverlay.stopTts();
  },
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}


type TurnAudio = { audioBase64: string | null; sampleRate: number };

/**
 * One native turn capture: start RECORD mode, drive the orb from `level`
 * events, resolve with the buffered audio when the native VAD endpoints. A
 * JS-side timeout is the last line of defence so nothing can hang the session.
 */
function captureTurn(): Promise<TurnAudio> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: TurnAudio) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(r);
    };
    const unsub = wakeWord.subscribe((e: WakeEvent) => {
      if (e.type === 'level') orbOverlay.setLevel(e.level);
      else if (e.type === 'turnAudio')
        finish({ audioBase64: e.audioBase64, sampleRate: e.sampleRate });
    });
    const timer = setTimeout(() => {
      wakeWord.stopTurnCapture();
      finish({ audioBase64: null, sampleRate: 16000 });
    }, CAPTURE_TIMEOUT_MS);
    mlog('captureTurn: calling native startTurnCapture');
    wakeWord.startTurnCapture();
  });
}

// Time-boxed so a dead TTS backend can never block the next capture. Synthesis
// now happens inside playback.speak(), so the old split budget (synth vs play)
// collapses into one: the cap has to cover both or it would cut clips off
// mid-word ("გამარჯ—") whenever synth ate most of it. Both backends resolve on
// real completion and have native hang guards, so this is a last resort, not the
// normal end.
const SPEAK_TIMEOUT_MS = GREETING_SYNTH_TIMEOUT_MS + GREETING_PLAY_TIMEOUT_MS;

async function speak(text: string, playback: TtsPlayback): Promise<void> {
  await withTimeout(playback.speak(text), SPEAK_TIMEOUT_MS, 'greeting speak');
}

export async function runWakeSession(): Promise<void> {
  if (running) return; // one session at a time
  running = true;

  // The headless runtime never mounts the UI, so authStore.hydrate() (done in
  // RootNavigator for the app) never ran — token stays null and every guarded
  // API call 401s, making the whole session silent. Hydrate here; no-op when
  // the runtime is warm from a previous app launch.
  if (!useAuthStore.getState().hydrated) {
    await useAuthStore.getState().hydrate();
  }

  let cancelled = false;
  let activePlayback: TtsPlayback | null = null;
  let abortChat: (() => void) | null = null;

  // Tear down everything in flight so a tap / opening the app ends the turn
  // INSTANTLY: abort the chat stream, stop the native mic capture, and stop the
  // current TTS (its stop() resolves the in-flight play() so the loop unwinds),
  // then hide the orb immediately. Idempotent; the finally block re-arms.
  const cancel = (reason: string) => {
    if (cancelled) return;
    cancelled = true;
    mlog('cancel ->', reason);
    try {
      abortChat?.();
    } catch {}
    try {
      wakeWord.stopTurnCapture();
    } catch {}
    try {
      activePlayback?.stop();
    } catch {}
    orbOverlay.hide(); // instant visual close
  };

  // Tap the orb → dismiss (Siri-style).
  const unsubTap = orbOverlay.subscribe((e) => {
    if (e.type === 'tap') cancel('orb tapped');
  });
  // Opening the app while the orb is up → dismiss it too.
  const appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') cancel('app opened');
  });

  try {
    // Orb shows only when screen-on + unlocked + permission granted; otherwise
    // run voice-only.
    mlog('session start; requesting orb overlay…');
    const orbShown = await orbOverlay.show();
    mlog('orbShown =', orbShown);
    const playback: TtsPlayback = orbShown ? overlayPlayback : nativePlayback;
    activePlayback = playback;
    if (cancelled) return; // tapped / app opened during orb show

    orbOverlay.setState('speaking');
    mlog('greeting: synth+play start');
    await speak(pickGreeting(), playback).catch((e) => mlog('greeting failed:', String(e)));
    mlog('greeting: done');

    let turns = 0;
    let saidGoodbye = false;
    do {
      mlog('loop top; cancelled =', cancelled);
      if (cancelled) break;
      wakeWord.heartbeat(); // keep the native turn wake-lock / watchdog alive

      playback.stop(); // release the TTS audio route before recording
      // The "let the audio route settle before opening the mic" wait now lives
      // in the native turn thread (WakeWordService.turnCaptureLoop). A JS
      // setTimeout does NOT fire while the app is backgrounded — RN pauses its
      // Timing module with no resumed Activity — which hung the whole turn here
      // until the app was reopened.
      orbOverlay.setState('listening');

      mlog('capture: start');
      const { audioBase64, sampleRate } = await captureTurn();
      mlog('capture: done, bytes =', audioBase64?.length ?? 0);
      if (cancelled || !audioBase64) break; // tap or silence ends the session

      orbOverlay.setState('thinking');
      const text = await transcribeGooglePcm(audioBase64, sampleRate).catch(
        () => '',
      );
      if (cancelled || !text.trim()) break;
      if (isGoodbye(text)) {
        saidGoodbye = true;
        break;
      }

      wakeWord.heartbeat();
      orbOverlay.setState('speaking');
      await runAssistantTurn({
        text,
        playback,
        isCurrent: () => !cancelled,
        onChatAbort: (a) => {
          abortChat = a;
        },
      });
      abortChat = null;
      turns += 1;
      // Voice-only (screen off): single turn by design. Orb: loop.
    } while (orbShown && turns < MAX_TURNS && !cancelled);

    if (saidGoodbye && !cancelled) {
      orbOverlay.setState('speaking');
      await speak(pickFarewell(), playback).catch((e) =>
        mlog('farewell failed:', String(e)),
      );
    }
  } catch (e) {
    console.warn('[MiaBg] session error', e);
  } finally {
    unsubTap();
    appStateSub.remove();
    orbOverlay.stopTts();
    orbOverlay.hide(); // animates closed
    wakeWord.resumeDetection(); // re-arm "Hey Jarvis"
    running = false;
  }
}
