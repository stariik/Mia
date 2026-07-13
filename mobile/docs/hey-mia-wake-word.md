# "Hey Mia" wake word (Android)

Always-on wake-word detection: say **"Mia"** with the app closed and it comes
to the front and starts listening, like Siri/Google Assistant.

This is **Android-only**. iOS does not allow third-party apps to listen for a
custom wake word in the background — the closest possible there is a
*"Hey Siri, talk to Mia"* Shortcut/App Intent (a separate, future task).

> **Free, no account, no key.** Detection runs fully on-device via
> [**openWakeWord**](https://github.com/dscripka/openWakeWord) (Apache-2.0) on
> top of ONNX Runtime. There is **no per-user licensing or cost** — that's why
> we moved off Picovoice Porcupine, whose free tier couldn't be shipped
> commercially. (Note: the in-app STT recorder still uses
> `@picovoice/react-native-voice-processor`, which is also free/Apache-2.0 and
> needs no key — that's unrelated to the wake word.)

---

## How it works

openWakeWord is a three-stage on-device pipeline, run inside a microphone
foreground service so it survives the UI being closed. No audio leaves the
phone until the keyword fires.

```
WakeWordService (Kotlin FGS, type=microphone)
  └─ AudioRecord captures 16 kHz PCM16 mono in 80 ms (1280-sample) chunks
     └─ OwwEngine scores each chunk, low power, on-device:
          melspectrogram.onnx → embedding_model.onnx → <wakeword>.onnx → score
        on threshold (N consecutive frames) → split by app visibility:
          ├─ FOREGROUND (RESUMED): emit "WakeWordEvent" {detected}
          │     → HomeScreen.onWake() → pipeline.startListening()  (in-app orb)
          └─ NOT foreground: release mic + wake lock, emit {turn}
                → wakeTurnListener → runHeadlessTurn()  (NO app launch)
                  ├─ screen ON & unlocked: float the orb overlay, play via it
                  └─ screen OFF / locked:  voice-only (native playback)
```

**Two turn paths, picked by `isAppInForeground()` (ReactContext RESUMED):**

- **Foreground** — the live JS UI runs the turn through the in-app orb WebView,
  exactly like tapping the orb. Native only emits the `detected` event.
- **Not foreground (backgrounded / closed)** — runs the whole turn **without
  launching the Activity**. The mic foreground service keeps the app process —
  and its JS runtime — alive even with no UI, so native just releases its
  `AudioRecord`, takes a wake lock, and emits a `turn` event; the module-level
  `wakeTurnListener` (registered in `index.js`) runs `runHeadlessTurn()`
  in-process. It records (hands-free silence auto-stop), transcribes, chats, and:
  - **screen on & unlocked** → floats the **orb overlay** (a `SYSTEM_ALERT_WINDOW`
    WebView hosting the same orb HTML) and plays the reply *through* it, so the
    orb visualizes the speech like the in-app one;
  - **screen off / locked** → stays voice-only via `nativePlayback` (nitro-sound),
    because a non-system app can't draw over the secure lock screen.

  Only if the JS runtime isn't alive (rare: service restarted into a fresh
  process) does it fall back to booting a `WakeTurnService` (`HeadlessJsTaskService`).

The shared turn logic (chat → TTS → playback) lives in `runAssistantTurn` with a
pluggable `TtsPlayback` backend — `orbPlayback` (in-app WebView), `overlayPlayback`
(overlay WebView), `nativePlayback` (nitro-sound) — so all paths run identical code.

The in-app recorder and the listener can't both own the mic, so the foreground
pipeline calls `wakeWord.pauseDetection()` before recording (releases the
`AudioRecord`, keeps the ONNX engine warm) and `resumeDetection()` after (resets
the engine's buffers + re-acquires the mic). The background turn does the same via
the native mic release + `resumeDetection()` when it finishes (with a native
watchdog as a safety net if a turn ever hangs).

Config (wake model file, detection threshold) is persisted in SharedPreferences
— read by the service directly — so it works after a process restart or reboot
without a live JS runtime.

### The pipeline math (for maintainers)

`OwwEngine` is a faithful port of openWakeWord's streaming preprocessor. Feeding
fixed 1280-sample chunks collapses the reference's general buffering to one
clean step per chunk:

- melspectrogram of the last `1280 + 480` samples → **+8 mel frames** (32 bins
  each; the `+480` is 3 frames of STFT left-context, and the mel transform is
  `x/10 + 2` to match Google's native model);
- embedding of the most recent **76 mel frames** → **+1 feature frame** (96-dim);
- wake-word classifier over the last **N feature frames** (N = the model's input
  width, usually 16) → a score in `[0,1]`.

Detection needs `trigger` consecutive frames at/above `threshold`, then a short
refractory period so one utterance fires once.

---

## Setup — making it actually say "Mia"

The shared feature models and a **pretrained fallback** are already bundled in
`android/app/src/main/assets/`:

| File | Role |
| --- | --- |
| `melspectrogram.onnx` | audio → mel frames (shared, never changes) |
| `embedding_model.onnx` | mel → Google speech embedding (shared) |
| `hey_jarvis_v0.1.onnx` | **fallback** wake model — works out of the box |

So the whole flow is testable **right now**: enable the toggle and say
**"Hey Jarvis"**. To make it respond to **"Mia"**, train a custom model (free,
no audio recording — it synthesizes training speech):

### 1. Train the custom "Mia" model

1. Open openWakeWord's **automatic model training** notebook in Google Colab
   (free GPU): <https://github.com/dscripka/openWakeWord> → *Training New Models*
   → `automatic_model_training.ipynb`.
2. Set the target phrase to **`Mia`** (or `Hey Mia`) and run it. It generates
   synthetic TTS samples and trains in ~1 hour. Export the **ONNX** model.
3. Rename the output to **`mia.onnx`** and drop it into:

   ```
   android/app/src/main/assets/mia.onnx
   ```

   (The filename must match `MIA_MODEL_ASSET` in `src/lib/wakeWord.ts` and
   `WakeWordService.MIA_MODEL_ASSET`.) When present, the service uses it
   automatically instead of the fallback.

> openWakeWord models depend on the shared `melspectrogram` + `embedding`
> feature models, which are version-matched here to the **v0.5.1** release. Train
> against that feature set (the default in the current notebook).

### 2. Rebuild (native change — not just a Metro reload)

```
cd mobile
npm run android        # or your device build command
```

### 3. Enable it

Open **Settings → ხმოვანი გამოძახება**, turn on **„Mia"-ს გამოძახება**, and
grant the microphone permission when prompted. A persistent "Mia is listening"
notification confirms the service is running.

### Testing the screen-off (headless) turn

With the app **backgrounded or closed** (screen off), say the wake word and a
short question — Mia should answer **without turning the screen on**. To watch
it: `adb logcat -s OwwEngine WakeWordService WakeTurnService ReactNativeJS`.
You'll see `Wake word detected (background).` → the `MiaWakeTurn` task running →
playback. Note the STT/chat/TTS server (`env.apiBaseUrl`) must be reachable from
the device on the network it's on — `localhost` + `adb reverse` only works while
tethered to the dev machine, so for a real screen-off test point it at a
reachable host.

### Tuning sensitivity

The detection threshold (default `0.5`) and consecutive-frame `trigger` (default
`3`) live in `WakeWordService` (`DEFAULT_THRESHOLD`, `DEFAULT_TRIGGER`) and can be
set per-session via `wakeWord.configure(threshold)`. Lower threshold / lower
trigger = more sensitive (more false fires); higher = stricter (more misses).

---

## Known caveats (platform realities, all flagged on purpose)

- **Battery** — an always-on mic + neural inference draws power. openWakeWord is
  efficient (three tiny models, single-threaded), but it isn't free. It's a bit
  heavier than Porcupine's hand-tuned DSP.
- **The persistent notification is mandatory** — Android requires it for a
  background mic foreground service; it can't be hidden.
- **OEM battery killers** — Xiaomi/Huawei/Samsung/etc. aggressively kill
  background services. Users may need to disable battery optimization /
  whitelist the app for "Hey Mia" to survive deep sleep.
- **Android 14 boot restriction** — a microphone foreground service generally
  can't be (re)started from a `BOOT_COMPLETED` broadcast. We try anyway, and
  the app re-arms the service on its next foreground launch
  (`ensureWakeWordOnLaunch`), so opening the app once after a reboot restores it.
- **Screen-off answers depend on the process staying alive** — detection +
  the headless turn run in the app process kept alive by the mic FGS. If an OEM
  killer or the system reclaims the process, there's nothing to detect or answer
  until the app is opened again (same root cause as the battery-killer note).
- **Headless turn needs the server reachable** — the screen-off turn does STT /
  chat / TTS over the network, so `env.apiBaseUrl` must be reachable from the
  device (not `localhost`/`adb reverse`, which only works while tethered).
- **Self-trigger during TTS** — detection is paused while a turn owns the mic,
  and re-arms only after playback completes, so Mia won't hear herself.
- **The app never auto-opens on wake** — the background turn runs in-process via
  a JS event (no Activity launch, no full-screen-intent). Earlier builds posted
  an FSI notification that auto-launched the app when the screen was off; that's
  gone. (`postWakeLaunchNotification` is retained but unused.)
- **Floating orb only shows when on & unlocked** — the orb overlay is a
  `SYSTEM_ALERT_WINDOW`, which Android won't render over the secure lock screen
  or use to wake the screen. So: screen on & unlocked → floating orb; screen off
  / locked → voice-only (by design). Needs the one-time "display over other apps"
  grant (requested when you enable the wake word); if denied, every turn is
  voice-only.
- **Overlay WebGL is the device-risk spot** — the overlay hosts the WebGL orb in
  a hardware-accelerated overlay WebView. This is the piece most likely to need
  per-device tuning (HW accel, WebView audio autoplay). It degrades to voice-only
  if the overlay can't show.
- **Tool calls that need the UI won't run headless** — core tools (time/alarm,
  weather, music) are native/server-side and work screen-off; any tool that
  drives navigation or on-screen UI is a no-op until the app is open.
- **Play Store review** — background `RECORD_AUDIO` + a microphone foreground
  service draws extra scrutiny; you'll need a clear data-safety justification.
- **Model assets in git** — the three `.onnx` files (~3.7 MB total) are bundled
  in `assets/`. They're Apache-2.0 and required at build time; if you'd rather
  not commit binaries, fetch them in a build step instead (URLs in
  `OwwEngine.kt` / the oWW v0.5.1 release).

---

## Files

| File | Role |
| --- | --- |
| `android/.../wake/OwwEngine.kt` | openWakeWord inference core (melspec → embedding → classifier, streaming buffers, threshold logic) |
| `android/.../wake/WakeWordService.kt` | Foreground service + AudioRecord capture; routes detection foreground (emit `detected`) vs background (release mic + wake lock + emit `turn`); turn watchdog |
| `android/.../wake/WakeTurnService.kt` | `HeadlessJsTaskService` fallback when the JS runtime isn't alive |
| `android/.../wake/OrbOverlayModule.kt` | Floating orb overlay: `SYSTEM_ALERT_WINDOW` WebView hosting the orb HTML + `ReactNativeWebView` JS bridge |
| `android/.../wake/WakeWordModule.kt` | JS bridge (configure/start/stop/pause/resume/events) |
| `android/.../wake/WakeWordPackage.kt` | Registers `WakeWordModule` + `OrbOverlayModule` |
| `android/.../MainApplication.kt` | Registers `WakeWordPackage` |
| `android/.../alarm/BootReceiver.kt` | Re-arms the service after reboot |
| `android/app/src/main/assets/*.onnx` | melspectrogram + embedding + wake models |
| `android/app/src/main/AndroidManifest.xml` | Mic FGS + `WakeTurnService` decls + `SYSTEM_ALERT_WINDOW` |
| `android/app/build.gradle` | `onnxruntime-android` dependency |
| `index.js` | registers `wakeTurnListener` (in-process turn) + `MiaWakeTurn` fallback task |
| `src/lib/wakeWord.ts` | JS wrapper (no-ops when native module absent) |
| `src/lib/wakeTurnListener.ts` | module-level `turn` handler → `runHeadlessTurn` (in-process, no UI) |
| `src/lib/assistantTurn.ts` | UI-agnostic turn (chat → TTS → playback) with pluggable `TtsPlayback` |
| `src/lib/headlessTurn.ts` | `runHeadlessTurn`: record (silence auto-stop) → STT → turn; drives + plays through the overlay orb, else native |
| `src/lib/pcmCapture.ts` | shared plain PCM16 capture (foreground hook + headless) |
| `src/lib/orbOverlay.ts` / `overlayPlayback.ts` | JS wrapper for the overlay orb + its TTS playback backend |
| `src/lib/nativeAudio.ts` / `nativePlayback.ts` | `nitro-sound` TTS playback (screen-off, no UI) |
| `src/lib/orbPlayback.ts` | in-app WebView-orb TTS playback (foreground) |
| `src/lib/orbHtml.ts` | the WebGL orb HTML — shared by the in-app orb and the overlay |
| `src/hooks/useWakeWord.ts` | `ensureWakeWordOnLaunch`, `useWakeTrigger`, `useWakeWordToggle` (+ overlay permission) |
| `src/hooks/useVoicePipeline.ts` | foreground turn: record + pause/resume detection + orb playback |
| `src/components/SettingsSheet.tsx` | "Hey Mia" toggle |
| `src/screens/HomeScreen.tsx` | Wires wake → `startListening` |
