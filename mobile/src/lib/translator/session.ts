import { AppState, type NativeEventSubscription } from 'react-native';
import { withTiming } from 'react-native-reanimated';

import { expireSessionIf401 } from '@/api/client';
import { transcribeGooglePcm } from '@/api/transcribeGoogle';
import { translateText } from '@/api/translate';
import { ensureMicrophonePermission } from '@/hooks/usePermissions';
import { startSilenceWatch } from '@/hooks/useSilenceAutoStop';
import { audioLevel } from '@/lib/audioLevel';
import { orbPlayback } from '@/lib/orbPlayback';
import { pcmCapture, rmsLevel } from '@/lib/pcmCapture';
import { bcp47, type Direction, type Lang } from '@/lib/translateLanguages';
import {
  matchTranslatorCommand,
  type TranslatorCommand,
} from '@/lib/translatorCommands';
import { wakeWord } from '@/lib/wakeWord';
import { analyzeMicFrame } from '@/orb/micAnalysis';
import { useAuthStore } from '@/stores/authStore';
import { useTranslatorStore } from '@/stores/translatorStore';
import {
  useTranslatorSession,
  type TranslationTurn,
  type TranslatorPhase,
} from '@/stores/translatorSessionStore';
import { mutedCapture } from '@/stt/audio';
import { streamingEnabled, streamUrl } from '@/stt/client';
import { SttController, type Socket } from '@/stt/controller';
import { expoCapture } from '@/stt/expoCapture';

// Translator mode, as a screen-less service. Started by voice (see
// translatorCommands + the start_translation tool) and shown in the chat area
// of the home screen; the orb takes a cool tint while it runs.
//
// It listens hands-free in the "from" language, translates every finished
// sentence and reads it aloud through the orb (so the orb speaks with the
// translation's real voice). Two capture paths, chosen per listen like the
// chat pipeline does:
//   - live: the streaming gateway. One session = a chain of utterances (each
//     capped at 60 s); every committed sentence translates at once and speaks
//     in spoken order. The mic is fed silence while a translation plays.
//   - legacy: record until the VAD hears the end of a sentence, transcribe,
//     translate, speak, listen again.
// Each sentence is checked for a command ("stop translating", "French",
// "swap") BEFORE it is translated, so commands are obeyed, never read out.
//
// Long silence closes the mic (the view stays open, paused): tap the orb or
// say "Hey Mia" to listen again. Leaving the app pauses it the same way.

// The gateway rejects an utterance with no speech after 8 s; in a live
// session silence is normal, so these just start the next utterance.
const NO_SPEECH = /^No (complete )?speech/;
// Consecutive speechless windows (~8 s each) before the mic closes.
const MAX_SILENT_WINDOWS = 5;
const CONFIG_TIMEOUT_MS = 5000;

type LiveRun = {
  kind: 'live';
  direction: Direction;
  stopped: boolean;
  speaking: boolean;
  controller: SttController | null;
  muted: ReturnType<typeof mutedCapture> | null;
  // Sentences translate in parallel but land and speak in spoken order.
  chain: Promise<void>;
  silent: number;
};

type LegacyRun = {
  kind: 'legacy';
  direction: Direction;
  stopped: boolean;
  disposeWatch: (() => void) | null;
  silent: number;
};

type Run = LiveRun | LegacyRun;

let run: Run | null = null;
// Bumped by every listen/halt so late async results from an older run drop.
let generation = 0;
let appStateSub: NativeEventSubscription | null = null;

const set = (patch: Partial<ReturnType<typeof useTranslatorSession.getState>>) =>
  useTranslatorSession.setState(patch);
const get = () => useTranslatorSession.getState();
const direction = () => useTranslatorStore.getState().direction;

function setPhase(phase: TranslatorPhase) {
  if (get().active) set({ phase });
}

function newId() {
  return `t_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : 'თარგმნა ვერ მოხერხდა';
  expireSessionIf401(msg);
  set({ error: msg });
}

// ── Turns ────────────────────────────────────────────────────────────────

function addPendingTurn(source: Lang, target: Lang, heard: string): string {
  const id = newId();
  const turn: TranslationTurn = {
    id,
    source,
    target,
    heard,
    translated: '',
    pending: true,
  };
  set({ turns: [...get().turns, turn] });
  return id;
}

function resolveTurn(id: string, patch: Partial<TranslationTurn>) {
  set({
    turns: get().turns.map((t) =>
      t.id === id ? { ...t, pending: false, ...patch } : t,
    ),
  });
}

/** Translate one heard sentence into its turn. Resolves the translation, or
 *  null if it failed (the turn shows as failed). */
async function translateInto(
  id: string,
  heard: string,
  d: Direction,
): Promise<string | null> {
  try {
    const translated = (await translateText(heard, d.from, d.to)).trim();
    resolveTurn(id, { translated });
    return translated;
  } catch (e) {
    resolveTurn(id, { failed: true });
    fail(e);
    return null;
  }
}

async function speakOut(text: string) {
  if (!text) return;
  try {
    await orbPlayback.speak(text);
  } catch {
    // Interrupted (pause, stop, a new direction) or the voice failed; the
    // translation stays on screen either way.
  }
}

// ── Commands heard mid-session ──────────────────────────────────────────

function applyCommand(cmd: TranslatorCommand) {
  if (cmd.kind === 'stop') {
    translator.stop();
    return;
  }
  if (cmd.kind === 'swap') {
    translator.swap();
    return;
  }
  if (cmd.kind === 'set' || cmd.kind === 'start') {
    if (cmd.from || cmd.to) translator.setDirection(cmd);
  }
}

// ── Live (streaming) capture ─────────────────────────────────────────────

function startUtterance(r: LiveRun) {
  if (r.stopped || run !== r) return;
  const muted = mutedCapture(expoCapture());
  muted.setMuted(r.speaking);
  r.muted = muted;
  const committed: string[] = [];
  const controller: SttController = new SttController({
    capture: muted,
    socket: () => new WebSocket(streamUrl()) as unknown as Socket,
    token: useAuthStore.getState().token ?? '',
    identity: { sessionId: `tr_${Date.now()}`, utteranceId: newId() },
    language: r.direction.from,
    // Pauses are sentence boundaries, not the end of the turn.
    state: (s) => {
      if (run !== r || r.stopped) return;
      if (s === 'listening') {
        controller.keepListening();
        if (!r.speaking && get().phase !== 'working') setPhase('listening');
      }
    },
    partial: (text) => {
      if (run !== r || r.stopped) return;
      // Partials repeat this utterance's committed sentences; show only the
      // unfinished one.
      const done = committed.join(' ');
      set({
        liveText: (done && text.startsWith(done)
          ? text.slice(done.length)
          : text
        ).trim(),
      });
    },
    segment: (text) => {
      if (run !== r || r.stopped) return;
      committed.push(text);
      onLiveSentence(r, text);
    },
    elapsed: () => {},
  });
  r.controller = controller;
  controller
    .start()
    .then(() => {
      if (run !== r) return;
      if (r.stopped) return endRun(r);
      startUtterance(r);
    })
    .catch((e: Error) => {
      if (run !== r) return;
      if (r.stopped) return endRun(r);
      if (NO_SPEECH.test(e.message)) {
        r.silent += 1;
        if (r.silent >= MAX_SILENT_WINDOWS) return translator.pause();
        return startUtterance(r);
      }
      fail(e);
      translator.pause();
    });
}

function onLiveSentence(r: LiveRun, heard: string) {
  r.silent = 0;
  set({ liveText: '' });
  const cmd = matchTranslatorCommand(heard, { inSession: true });
  if (cmd) {
    applyCommand(cmd);
    return;
  }
  const d = r.direction;
  const id = addPendingTurn(d.from, d.to, heard);
  const translation = translateInto(id, heard, d);
  r.chain = r.chain.then(async () => {
    const translated = await translation;
    if (run !== r || r.stopped || !translated) return;
    if (!useTranslatorStore.getState().autoSpeak) return;
    r.speaking = true;
    r.muted?.setMuted(true);
    setPhase('speaking');
    try {
      await speakOut(translated);
    } finally {
      r.speaking = false;
      r.muted?.setMuted(false);
      if (run === r && !r.stopped) setPhase('listening');
    }
  });
}

async function startLive(d: Direction, gen: number) {
  const r: LiveRun = {
    kind: 'live',
    direction: d,
    stopped: false,
    speaking: false,
    controller: null,
    muted: null,
    chain: Promise.resolve(),
    silent: 0,
  };
  run = r;
  if (!(await ensureMicrophonePermission())) {
    if (gen !== generation) return;
    set({ error: 'მიკროფონის ნებართვა არ არის' });
    translator.pause();
    return;
  }
  if (gen !== generation) return;
  startUtterance(r);
}

// ── Legacy (record → transcribe) capture ─────────────────────────────────

async function startLegacy(d: Direction, gen: number) {
  const r: LegacyRun = {
    kind: 'legacy',
    direction: d,
    stopped: false,
    disposeWatch: null,
    silent: 0,
  };
  run = r;
  await recordSentence(r, gen);
}

async function recordSentence(r: LegacyRun, gen: number) {
  try {
    if (!(await ensureMicrophonePermission())) {
      throw new Error('მიკროფონის ნებართვა არ არის');
    }
    if (gen !== generation || r.stopped) return;
    await pcmCapture.start((frame) => {
      // Direct write — see usePcmRecorder for why this is not withTiming.
      audioLevel.value = rmsLevel(frame);
      analyzeMicFrame(frame);
    });
  } catch (e) {
    if (gen !== generation) return;
    fail(e);
    translator.pause();
    return;
  }
  if (gen !== generation || r.stopped) {
    pcmCapture.reset();
    return;
  }
  setPhase('listening');
  r.disposeWatch = startSilenceWatch((spoke) => {
    r.disposeWatch = null;
    void onLegacyStop(r, gen, spoke);
  });
}

async function onLegacyStop(r: LegacyRun, gen: number, spoke: boolean) {
  if (gen !== generation || r.stopped) return;
  const { audioBase64, sampleRate } = await pcmCapture.stop();
  audioLevel.value = withTiming(0, { duration: 220 });
  if (gen !== generation || r.stopped) return;

  if (!spoke || !audioBase64) {
    r.silent += 1;
    if (r.silent >= MAX_SILENT_WINDOWS) translator.pause();
    else await recordSentence(r, gen);
    return;
  }
  r.silent = 0;
  setPhase('working');
  const d = r.direction;
  let heard = '';
  try {
    heard = (
      await transcribeGooglePcm(audioBase64, sampleRate, [bcp47(d.from)])
    ).trim();
  } catch (e) {
    if (gen !== generation) return;
    fail(e);
  }
  if (gen !== generation || r.stopped) return;

  const cmd = heard ? matchTranslatorCommand(heard, { inSession: true }) : null;
  if (cmd) {
    applyCommand(cmd);
    if (cmd.kind !== 'stop' && run === r) await recordSentence(r, gen);
    return;
  }
  if (heard) {
    const id = addPendingTurn(d.from, d.to, heard);
    const translated = await translateInto(id, heard, d);
    if (gen !== generation || r.stopped) return;
    if (translated && useTranslatorStore.getState().autoSpeak) {
      setPhase('speaking');
      await speakOut(translated);
      if (gen !== generation || r.stopped) return;
    }
  }
  await recordSentence(r, gen);
}

// ── Run lifecycle ────────────────────────────────────────────────────────

function endRun(r: Run) {
  if (run !== r) return;
  run = null;
  set({ liveText: '' });
  wakeWord.resumeDetection();
}

/** Close the mic and silence any translation being read. */
function halt() {
  generation += 1;
  const r = run;
  orbPlayback.stop();
  if (!r) return;
  r.stopped = true;
  if (r.kind === 'live') {
    r.controller?.cancel();
  } else {
    r.disposeWatch?.();
    r.disposeWatch = null;
    pcmCapture.reset();
    audioLevel.value = withTiming(0, { duration: 220 });
  }
  endRun(r);
}

async function listen() {
  halt();
  const gen = generation;
  const d = direction();
  set({ error: null, liveText: '' });
  setPhase('connecting');
  // Hand the mic off from the "Hey Mia" service (no-op when it isn't running).
  wakeWord.pauseDetection();

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), CONFIG_TIMEOUT_MS);
  let live = false;
  try {
    live = await streamingEnabled(abort.signal);
  } catch {
    // Config check failed: the legacy path still works.
  } finally {
    clearTimeout(timeout);
  }
  if (gen !== generation || !get().active) {
    // Superseded. Give the mic back to "Hey Mia" only if nothing else is
    // about to open it (a newer listen() is in 'connecting').
    if (!get().active || get().phase === 'paused') wakeWord.resumeDetection();
    return;
  }
  if (live) await startLive(d, gen);
  else await startLegacy(d, gen);
}

function onAppState(state: string) {
  if (state !== 'active' && get().active && get().phase !== 'paused') {
    translator.pause();
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export const translator = {
  isActive: () => get().active,

  /** Enter translator mode (or retarget a running one) and start listening. */
  async start(req: { from?: Lang; to?: Lang } = {}) {
    if (req.from || req.to) applyDirection(req);
    if (!get().active) {
      set({ active: true, phase: 'paused', turns: [], liveText: '', error: null });
      appStateSub = AppState.addEventListener('change', onAppState);
    }
    await listen();
  },

  /** Leave translator mode: back to the normal chat. */
  stop() {
    if (!get().active) return;
    halt();
    appStateSub?.remove();
    appStateSub = null;
    set({ active: false, phase: 'off', liveText: '', error: null });
  },

  /** Close the mic but keep the translator view. */
  pause() {
    if (!get().active) return;
    halt();
    set({ phase: 'paused' });
  },

  resume() {
    if (!get().active) return;
    void listen();
  },

  /** The orb tap: interrupt a translation being read, else toggle the mic. */
  toggleListening() {
    const { active, phase } = get();
    if (!active) return;
    if (phase === 'paused') {
      void listen();
    } else if (phase === 'speaking' && run?.kind === 'live') {
      orbPlayback.stop();
    } else {
      translator.pause();
    }
  },

  /** Read translations aloud (or not); turning it off silences one playing. */
  setAutoSpeak(on: boolean) {
    if (!on) orbPlayback.stop();
    useTranslatorStore.getState().setAutoSpeak(on);
  },

  swap() {
    useTranslatorStore.getState().swap();
    restartIfListening();
  },

  setFrom(lang: Lang) {
    applyDirection({ from: lang });
    restartIfListening();
  },

  setTo(lang: Lang) {
    applyDirection({ to: lang });
    restartIfListening();
  },

  setDirection(req: { from?: Lang; to?: Lang }) {
    applyDirection(req);
    restartIfListening();
  },

  /** Typed text in the current direction. Resolves true once translated. */
  async translateTyped(input: string): Promise<boolean> {
    const text = input.trim();
    if (!text || !get().active) return false;
    // The user is typing, not talking: close the mic so the spoken result
    // isn't heard back as a new sentence.
    translator.pause();
    const gen = generation;
    const d = direction();
    const id = addPendingTurn(d.from, d.to, text);
    const translated = await translateInto(id, text, d);
    if (!translated) return false;
    if (gen === generation && useTranslatorStore.getState().autoSpeak) {
      void speakOut(translated);
    }
    return true;
  },

  /** Read a translation again (closes the mic so it isn't re-translated). */
  replay(turn: TranslationTurn) {
    if (!turn.translated) return;
    translator.pause();
    void speakOut(turn.translated);
  },
};

function applyDirection(req: { from?: Lang; to?: Lang }) {
  const prefs = useTranslatorStore.getState();
  if (req.from && req.to) {
    if (req.from === prefs.direction.to && req.to === prefs.direction.from) {
      prefs.swap();
      return;
    }
    prefs.setFrom(req.from);
    useTranslatorStore.getState().setTo(req.to);
    return;
  }
  if (req.from) prefs.setFrom(req.from);
  if (req.to) prefs.setTo(req.to);
}

function restartIfListening() {
  const { active, phase } = get();
  if (!active || phase === 'paused') return;
  void listen();
}

/** Test hook: forget everything between tests. */
export function __resetTranslatorForTests() {
  halt();
  appStateSub?.remove();
  appStateSub = null;
  run = null;
  set({ active: false, phase: 'off', turns: [], liveText: '', error: null });
}
