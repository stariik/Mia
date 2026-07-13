# Rebuild prompt — "Hey Jarvis / Hey Mia" hands-free voice session (Android, app closed)

> Paste this entire file back to Claude Code as the task when you're ready to build.
> It is self-contained: it carries the goal, the architecture, the proven pieces to
> reuse, and — most importantly — the exact mistakes that broke the previous attempt
> so they are not repeated.

---

## 1. What to build

The hands-free, **app-closed** voice-assistant experience for the Mia app
(`mobile/`, bare React Native, Android-only for now).

Flow: with the app **backgrounded or closed**, the user says the wake word
("**Hey Jarvis**" today via the bundled openWakeWord model; "Hey Mia" later once a
custom `mia.onnx` is trained). Then:

```
wake detected → float an orb over the home screen → greet → listen → transcribe
(Georgian) → answer (GPT) → speak the reply → loop (Siri-style) until the user says
goodbye / taps the orb / goes silent → animate the orb closed → re-arm wake detection
```

If the screen is **off or locked**, run **voice-only** (no orb — Android won't let a
non-system app draw over the secure lock screen).

The **in-app foreground** experience (tap the orb on the app's Home screen to talk)
already works and is **out of scope** — do not touch `useVoicePipeline`,
`usePcmRecorder`, `orbPlayback`, or `HomeScreen`'s tap flow.

---

## 2. ⚠️ THE ONE RULE THAT MATTERS MOST (root cause of the last failure)

**Do NOT use `@picovoice/react-native-voice-processor` (the `pcmCapture` module) to
record the turn in the background.**

It is a **foreground-oriented** module. When the app is **closed** (no resumed
Activity), its native `AudioRecord.start()` **hangs forever** — it neither resolves
nor rejects. The turn freezes right after the greeting; the mic never opens (no green
dot, no reaction, tap does nothing). This was confirmed in logcat:

```
[MiaBg] phrase: playback done      ← greeting finished fine
        ← then 60 seconds of NOTHING (no "recorder started", no "recorder start failed")
WakeWordService: Background-turn watchdog fired
```

The greeting, STT, chat, TTS, overlay, and wake detection ALL work. The **only**
broken thing was the background recorder.

**Instead: capture the turn with a native `AudioRecord` running INSIDE the microphone
foreground service (`WakeWordService`).** That service already captures 16 kHz PCM16
in the background 24/7 to hear the wake word, so it provably has background mic
access. Reuse that exact capture path for the user's turn. This is the whole fix.

---

## 3. Architecture (native-capture-centric)

```
┌─ WakeWordService (microphone foreground service, always running) ──────────────┐
│  AudioRecord (VOICE_RECOGNITION, 16 kHz, PCM16, 1280-sample/80 ms chunks)       │
│    • mode = DETECT  → feed chunks to OwwEngine (ONNX) → fires on wake            │
│    • mode = RECORD  → (NEW) buffer PCM, compute RMS, push level to JS, endpoint  │
└────────────────────────────────────────────────────────────────────────────────┘
        │ wake fired (app not foreground)         ▲ final base64 PCM + level events
        ▼                                         │
┌─ JS session orchestrator (NEW, replaces headlessTurn) ─────────────────────────┐
│  show overlay orb → greet (TTS) → startTurnCapture() → drive orb from level     │
│  → on final audio: STT → chat (SSE) → TTS → play via overlay → loop / goodbye   │
└────────────────────────────────────────────────────────────────────────────────┘
```

Key idea: **all microphone capture is native and lives in the mic FGS.** JS only does
network (STT/chat/TTS), the orb visuals, and session flow. JS never opens an
`AudioRecord` in the background.

Two capture-control options — pick one:
- **(Recommended) Native VAD.** The service does simple energy-based endpointing
  (initial-speech grace, trailing-silence stop, max-duration cap), pushes a throttled
  audio level to JS for the orb glow, and emits the final base64 PCM when the user
  stops. Least bridge chatter, most robust. Make the thresholds constants.
- **JS VAD.** The service streams level (not raw frames) to JS; JS decides when to
  stop and calls `stopTurnCapture()`, which returns the buffered base64 PCM. More
  flexible tuning, slightly more bridge traffic. (Reuse the VAD constants that lived
  in the old `headlessTurn.ts` / `useSilenceAutoStop.ts`: `SILENCE_MS ~550–750`,
  `PRE_SPEECH_GRACE_MS ~7000`, `MAX_RECORD_MS ~15000`, peak-relative continue ratio.)

Reuse the **same** `AudioRecord` the wake loop owns (switch its mode) rather than
opening a second recorder — two consumers will fight over the mic.

---

## 4. What already exists and WORKS — reuse, do NOT rewrite

Native (`mobile/android/app/src/main/java/com/mobile/wake/`):
- `OwwEngine.kt` — openWakeWord ONNX pipeline (melspec → embedding → wake model).
  Solid; detects "Hey Jarvis" reliably. **Do not touch.**
- `WakeWordService.kt` — the mic foreground service + capture loop + detection
  routing (foreground → emit `detected`; background → run the turn). **This is where
  you ADD the native RECORD mode.**
- `WakeWordModule.kt` / `WakeWordPackage.kt` — JS bridge (configure/start/stop/
  pause/resume/heartbeat). Add the new turn-capture methods + events here.
- `OrbOverlayModule.kt` — `TYPE_APPLICATION_OVERLAY` WebView that hosts the WebGL orb,
  plays TTS through it (`playTts` resolves on the WebView's `tts-ended`/`tts-error`),
  and emits `tap` events. **Works — reuse.**

JS (`mobile/src/`):
- `lib/orbOverlay.ts` — JS wrapper over `OrbOverlayModule` (show/hide/setState/
  setLevel/playTts/stopTts/subscribe). **Kept. Reuse.**
- `lib/wakeWord.ts` — JS wrapper over `WakeWordModule`. **Kept.** Add wrappers for the
  new native turn-capture methods/events.
- `hooks/useWakeWord.ts` — foreground wake trigger + the Settings toggle. **Kept.**
- `lib/assistantTurn.ts` — `runAssistantTurn` (chat SSE → per-sentence TTS → playback
  through an injected `TtsPlayback`) + `synthesizeForVoice` + `mimeForPath`. UI-
  agnostic. **Reuse verbatim** for the answer half of each turn.
- `lib/nativePlayback.ts` — screen-off TTS playback via nitro-sound. Reuse for the
  voice-only (locked/screen-off) path.
- `lib/orbHtml.ts` — the WebGL orb HTML (shared with the in-app orb). Reuse; it
  already supports `floatIn`, `edgeFade`, and per-state visuals.
- `api/transcribeGoogle.ts` (Chirp 2 STT, has a 20 s timeout), `api/chat.ts`,
  `api/synthesize.ts`. Reuse.

Web endpoints (server, `next dev -p 3002`): `/api/transcribe-google-v2`,
`/api/chat`, `/api/synthesize-elevenlabs`. Working.

---

## 5. What to build fresh

1. **Native turn capture** in `WakeWordService` + `WakeWordModule`:
   - `startTurnCapture()` — switch the capture loop to RECORD mode (buffer PCM16,
     compute RMS, throttle a `wakeLevel` event ~10/s, run endpointing).
   - `stopTurnCapture()` — stop, return/emit final base64 PCM (16 kHz mono).
   - Events to JS: `wakeLevel` (0..1) and `wakeTurnAudio` ({ audioBase64, sampleRate })
     (or have `stopTurnCapture` resolve with the audio if JS-VAD).
   - On finish, re-arm DETECT mode (reset `OwwEngine` so buffered audio can't self-fire).
   - Keep the existing wake-lock + re-arm watchdog so a long turn isn't cut off; add a
     `heartbeat` each exchange (the old design had this — keep it).
2. **JS session orchestrator** (a new `lib/` module; the old `headlessTurn.ts` was
   deleted): show orb → greet → native capture → level→orb → STT → `runAssistantTurn`
   → loop until goodbye/tap/silence → animated hide → resume detection. Plus the
   screen-off voice-only single-turn fallback.
3. **Greeting + goodbye** phrases (the old `greetings.ts` was deleted — recreate a
   tiny module: short Georgian openers/closers + a conservative `isGoodbye()` that
   ignores bare "კარგად").
4. **Wiring in `index.js`**: register the background "turn" handler (in-process, when
   the JS runtime is alive) and the `MiaWakeTurn` headless task (cold-process
   fallback — `WakeTurnService.kt` boots it).

---

## 6. Pitfalls we already hit — DO NOT repeat them

1. **Picovoice in the background** → see §2. Native capture only.
2. **Greeting must never gate the mic.** Whatever plays the greeting, listening must
   start regardless (time-box the greeting, or make capture a separate native phase).
   A greeting that stalls must not block the turn.
3. **TTS-through-WebView → mic conflict.** Playing TTS via the overlay WebView's
   `AudioContext` keeps the loudspeaker route active and can bleed into / block the
   next capture. The old code worked around it with `audioCtx.suspend()` + a settle
   delay. With **native** capture this is far less fragile, but still: stop TTS and let
   the route settle (~200–300 ms) before recording.
4. **No timeout = freeze.** Every awaited network/native step needs a timeout. STT
   already has 20 s; the **TTS synth had none** (`ReactNativeBlobUtil.fetch`) and it
   stalled the whole turn on a dead backend. Add timeouts everywhere, and a
   start-watchdog on capture so nothing can hang the session for 60 s again.
5. **API base URL / port.** `mobile/.env` `API_BASE_URL` must match the web dev server
   (`next dev -p 3002`) **and** an `adb reverse tcp:3002 tcp:3002` tunnel.
   `react-native-config` bakes `.env` at **BUILD time** — after editing `.env` you must
   rebuild (`npm run android`), not just reload Metro. (A `.env` of `:3000` with the
   server on `:3002` made the backend unreachable and, combined with greeting-before-
   mic, looked exactly like a mic bug.)
6. **Background mic requires** `android:foregroundServiceType="microphone"` +
   `FOREGROUND_SERVICE_MICROPHONE` permission, and the FGS must be started while the
   app is in the foreground (while-in-use grant). Already set up — keep it.
7. **Overlay** needs the `SYSTEM_ALERT_WINDOW` ("display over other apps") grant and
   can only show when screen-on + unlocked. Off/locked → voice-only.
8. **Don't open two `AudioRecord`s.** The wake loop and the turn must share one mic.
   Switch modes; don't run a second recorder concurrently.

---

## 7. Environment / config checklist

- Web server running: `cd web && npm run dev` (serves on **:3002**).
- Tunnel: `adb reverse tcp:3002 tcp:3002` (and `tcp:8081` for Metro).
- `mobile/.env`: `API_BASE_URL=http://localhost:3002` (rebuild after changing).
- One-time device grants: microphone, notifications, "display over other apps".
- Native changes need a full rebuild (`npm run android`); JS-only changes just need a
  Metro reload (`r`).
- The user runs builds / the dev server / the device themselves — prepare changes and
  give exact run/test steps; do not auto-launch.

---

## 8. Acceptance criteria (test with the app CLOSED, not just backgrounded)

1. Phone on home screen, Mia swiped away → say "**Hey Jarvis**".
2. Orb floats up within ~2 s and greets.
3. **Green mic indicator appears** and the orb reacts to your voice (this is the bit
   that was broken — native capture must make the mic actually open with the app closed).
4. You speak Georgian → orb shows "thinking" → Mia answers in Georgian (audio).
5. Conversation continues; saying a goodbye, tapping the orb, or staying silent ends
   it and the orb animates closed.
6. Screen off/locked variant → voice-only, single turn, no orb, no crash.
7. No step can hang the session > a few seconds (timeouts + start-watchdog).

---

## 9. Verify via logcat

```
adb logcat -c
adb logcat | findstr /I "MiaBg WakeWordService OrbOverlay recorder vad"
```
Expect: `Wake word detected (background)` → overlay shown → greeting →
**`recorder started`** (the previously-missing line) → `[vad]` levels → recording
stopped → STT text → answer. The absence of `recorder started` = the mic never opened.
