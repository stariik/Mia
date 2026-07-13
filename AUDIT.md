# Mia — Pre-Launch Diagnostic Audit

**Date:** 2026-07-13 · **Auditor:** Claude (principal-engineer pass, full codebase access)
**Scope:** `mobile/` (React Native 0.85, Android) + `web/` (Next.js API backend)
**Verified:** `tsc --noEmit` clean · release APK builds (42 MB, arm64-only, ProGuard on) · Jest suite present (greetings)

---

## Mental model: the critical path of one voice turn

```
tap orb
 → usePcmRecorder.start()            [mic permission → Picovoice VoiceProcessor, PCM16 @16 kHz]
 → useSilenceAutoStop                [VAD: 400 ms calibration, 750 ms silence stop, 7 s no-speech grace]
 → pcmCapture.stop()                 [trim silence, base64, ≤20 s buffer cap]
 → POST /api/transcribe-google-v2    [Chirp 2; 20 s client timeout]
 → runAssistantTurn()
    → SSE /api/chat                  [gpt-4o + tools, 15 s stall watchdog, ≤3 tool rounds]
    → sentence split (regex)         [per-sentence, parallel synth / serial playback]
    → POST /api/synthesize-elevenlabs [Flash v2.5 mp3 → device cache file]
    → orbPlayback → WebView          [base64 → HTML5 Audio + AnalyserNode drives orb]
 → turn ends (turnId invalidation handles interrupt / re-send)
```

**Where it can fail:** mic permission denial (Georgian rationale shown, good) · PCM start failure (falls back to m4a file recorder + Whisper SSE — good) · STT timeout (20 s, surfaces error — good) · chat stall (15 s watchdog — good) · TTS synth failure (**sentence silently skipped**, only `console.warn`) · WebView playback failure (rejects, chain continues) · **user stuck during "thinking"** (orb `disabled={isThinking}`, no way to cancel a slow/stuck turn until watchdog fires).

The pipeline core is genuinely well-engineered: turn-id superseding, shared foreground/headless turn logic, VAD with hysteresis and adaptive noise floor, upload-side silence trimming. The problems are almost all around the edges: release configuration, backend guarding, persistence, and error UX.

One correction to the brief: **the orb is not Skia.** It's a WebView running an inlined WebGL shader (`mobile/src/lib/orbHtml.ts`, 776 lines). `@shopify/react-native-skia` is installed but referenced **nowhere** in `mobile/src` — it ships megabytes of dead native code in the APK. Same for `ogl` and `@react-native-community/blur`: zero imports.

---

## Scores

| Area | Score | One-liner |
|---|---|---|
| Voice UX | **7/10** | Excellent core loop; can't cancel during thinking; errors surface in English |
| Georgian language quality | **7/10** | Best-available providers (Chirp 2 + ElevenLabs Flash); native-quality UI copy |
| Orb & UI | **6/10** | Looks crafted; WebView/WebGL orb is heavy and architecturally fragile |
| Architecture | **7/10** | Clean layering; dead deps; no persistence; TTS plays through a WebView bridge |
| Reliability | **6/10** | Good timeouts/watchdogs; zero retry; silent TTS drops; Sentry off by default |
| **Play Store readiness** | **2/10** | Unpublishable as-is — see blockers |
| Security & privacy | **4/10** | No client keys (good); 5 unguarded paid routes; forgeable-JWT fallback |
| Performance | **6/10** | Smart upload trimming; dead native libs inflate APK; always-on WebGL rAF |

---

## Launch blockers (all fixed in this pass unless marked MANUAL)

1. **`applicationId "com.mobile"`** — `mobile/android/app/build.gradle:84`. Play will likely reject the ID as too generic, and it is *permanent* after first upload. → Changed to `ge.mia.app` (namespace untouched, no Kotlin moves). **Confirm before first Play upload — it can never change afterwards.**
2. **Release build signed with the debug keystore** — `build.gradle:105` (`signingConfig signingConfigs.debug` under `release`). Play rejects debug-signed artifacts. → Added `keystore.properties`-driven release signing + generated a real upload keystore (gitignored). MANUAL: back it up (see LAUNCH-CHECKLIST).
3. **API base URL falls back to `http://localhost:3002` in release** — `mobile/src/config/env.ts:8`. A production install would talk to the user's own phone. → Rewrote `env.ts` with a `__DEV__` split and an explicit `PROD_API_BASE_URL` that fails loudly (Georgian error + Sentry) when unset. MANUAL: set the production URL (needs your hosting decision).
4. **No account deletion** — app has email/password accounts (`web/src/app/api/auth/{login,register}`) but no deletion path. Google Play policy requires in-app deletion *and* a web link. → Implemented `/api/auth/delete`, a `web /delete-account` page, and a delete flow in the mobile SettingsSheet.
5. **Five unguarded paid API routes** — `guard()` protects only chat / Chirp STT / ElevenLabs TTS. `/api/translate` (gpt-4o), `/api/synthesize` (OpenAI TTS), `/api/synthesize-camb/*`, `/api/transcribe`, `/api/transcribe-stream` (both Whisper) accept anonymous requests: anyone with the URL can drain your OpenAI/Camb bill. → Guarded all five; mobile callers now send `authHeaders()`.
6. **JWT secret has a hardcoded dev fallback** — `web/src/lib/auth/jwt.ts:3`. Deploy without `JWT_SECRET` and every token is forgeable (and with #5 fixed, forgeable tokens = free API). → Now throws at startup in production when unset.
7. **Sentry disabled** (`env.ts` DSN empty) — you'd launch blind. MANUAL: paste DSN (checklist).
8. **Privacy policy + Data Safety form** — MANUAL, but answers are pre-filled in LAUNCH-CHECKLIST.md.

## High-value defects (fixed)

9. **Conversations and settings evaporate on every app kill.** `conversationStore` and `voiceStore` are memory-only despite AsyncStorage being installed and a full multi-conversation drawer UI existing (`ConversationDrawer.tsx`, 323 lines of UI for state that never survives a restart). → Persisted both (capped at 30 conversations).
10. **Cannot interrupt a thinking/stalled turn.** `HomeScreen.tsx:257` disables the orb while `isThinking`; if the backend is slow the user stares at bouncing dots for up to 15 s with no escape. → Tap-while-thinking now cancels the turn and starts listening.
11. **Raw English error strings shown to Georgian users.** `toastMessage()` passes through any error <80 chars — "Stream stalled", "Chat failed", "Empty transcription.", "Transcription timed out". → Central Georgian error mapping; technical detail kept in dev builds only.
12. **TTS cache never cleaned.** Every spoken sentence writes an mp3 via `react-native-blob-util` `fileCache` (`synthesize.ts:63-96`) and no code ever deletes them — storage grows unboundedly with use. → Files deleted after playback; leftover sweep on launch.
13. **Cleartext dev-IP allowlist ships in the release** `network_security_config.xml`. Not exploitable by itself, but sloppy. → Dev IPs moved to a debug-only resource overlay; release config is HTTPS-only, no exceptions.
14. **Dead native dependencies inflate the APK**: `@shopify/react-native-skia` (unused, native C++ per-arch), `@react-native-community/blur` (unused), `ogl` (unused JS). → Removed all three.
15. **arm64-only build** (`gradle.properties: reactNativeArchitectures=arm64-v8a`) excludes every 32-bit budget phone. → **Attempted `armeabi-v7a`, reverted.** `react-native-nitro-sound`'s CMake build fails on armeabi-v7a under Windows (`ninja: manifest still dirty after 100 tries`) — the pre-existing comment already documented this and set arm64-only deliberately. arm64 covers effectively all phones sold in the last several years; revisit on a Linux CI where the native build may succeed. Left as a documented post-launch item, not a blocker.

## Findings noted, deliberately NOT changed (risk > reward one week out)

- **The WebView orb.** TTS audio literally plays inside a WebView `<audio>` element so an AnalyserNode can drive the shader (`orbAudio.ts`). It works, it's smooth, and replacing it with native playback + Skia would be a rewrite of the app's most-tested surface days before launch. Post-launch: move playback to nitro-sound (already installed, already used by the headless path) and drive the orb from `audioLevel` like listening mode does.
- **No audio focus handling.** Playback via WebView audio doesn't reliably duck/pause other apps' music, and an incoming call during recording isn't specially handled (capture just yields silence frames; VAD stops it). Needs a small native `AudioFocusRequest` module — post-launch.
- **`MAX_BUFFERED_SAMPLES` caps recording at 20 s** and silently truncates longer speech (`pcmCapture.ts:36`). Acceptable for v1 voice commands; note for the streaming-STT phase (already on your roadmap).
- **In-memory rate limiting / JSON-file user store** (`apiGuard.ts`, `users.json`). Fine at launch scale on one instance; move to Redis/SQLite when you scale. Already marked with a ponytail ceiling comment in the code.
- **`MusicDevScreen.tsx`** is unreferenced (not in the navigator, so Metro doesn't bundle it). Left in place as a dev tool.
- **Server keeps no voice audio** (checked: STT routes forward to Google/OpenAI and return text; nothing written to disk). Good — this is what the Data Safety form will say.

## Per-area detail

### Voice UX — 7/10
Tap-to-talk with VAD auto-stop (`useSilenceAutoStop.ts` — calibrated noise floor, hysteresis, peak-relative continuation: this is better VAD than most shipping assistants). Barge-in works while speaking (`HomeScreen.tsx:150`). Text input fallback exists. Wake word ("Hey Mia", on-device openWakeWord ONNX) with a headless screen-off turn. Latency perception is well handled: per-sentence TTS streaming means first audio lands after the first sentence, not the full reply. Deductions: no cancel-during-thinking (fixed), English errors (fixed), no audio focus, mic-permission denial has no "open settings" recovery path.

### Georgian quality — 7/10
Provider choices are right (Chirp 2 is the only STT that handles Georgian well; Google TTS has zero Georgian voices, so ElevenLabs Flash v2.5 default + Camb fallback is correct). UI copy is native-quality Georgian throughout (`usePermissions.ts`, `SettingsSheet`, `AuthScreen`, suggestion chips). Goodbye detection handles ka/en/ru ambiguity thoughtfully (`greetings.ts` — bare "კარგად" correctly not a goodbye). `georgianNumbers.ts` exists server-side for TTS number reading. Untestable from here: real-world STT accuracy on dialects; recommend a 20-utterance smoke test before launch.

### Orb & UI — 6/10
Visually distinctive (aurora backdrop, active rings, wordmark, capability-tinted suggestion chips — doesn't read as template). But: WebView + `injectJavaScript` at 20 Hz for levels, `androidLayerType="hardware"`, continuous rAF with no visibility pause = battery cost while the app is open and idle. Layout math handles small screens (`orbSize` clamp, `HomeScreen.tsx:112`). Dark-only is a defensible brand choice. Keyboard handled (`adjustResize` + KeyboardAvoidingView; the notorious permission-loop focus bug is already fixed and documented in `usePermissions.ts`).

### Architecture — 7/10
Genuinely good separation: `assistantTurn.ts` is UI-agnostic and shared verbatim between foreground and headless wake turns; capture logic single-sourced in `pcmCapture.ts`; stores are thin. Deductions: playback-through-WebView coupling, dead deps, no persistence (fixed), `conversationStore.messages` mirror field is a smell but harmless.

### Reliability — 6/10
Every network call has a timeout or watchdog. Interrupt bookkeeping via monotonic turn ids is correct (checked all `isCurrent()` gates). No retry anywhere (acceptable: voice users just tap again). TTS failure silently drops a sentence mid-reply — user hears a gap (logged only; left as-is, low frequency). Sentry wiring exists but is dead until a DSN is set. Cold start offline: app boots to Auth/Home fine (no network calls block first render); first voice turn fails with (now-Georgian) toast.

### Play Store readiness — 2/10 → items 1–8 above
Also verified good: `targetSdkVersion 36` (exceeds Play's requirement), all dangerous permissions have runtime flows, `USE_FULL_SCREEN_INTENT` + `SCHEDULE_EXACT_ALARM` justified by the alarm feature (declare in listing), console stripped from release bundles (`babel-plugin-transform-remove-console`), ProGuard/R8 on with correct keep rules, bootsplash + adaptive icon + 512 px store icon present.

### Security & privacy — 4/10 → items 5, 6, 13
Good: zero API keys in the mobile bundle (all providers proxied server-side), HTTPS-only base config, scrypt password hashing with timing-safe compare, JWT HS256 with timing-safe verify, per-user rate limit + global daily budget cap on guarded routes. Audio goes device → your server → Google/OpenAI/ElevenLabs; nothing persisted server-side.

### Performance — 6/10
Upload-side silence trimming cuts STT round-trip meaningfully (the single biggest latency lever already pulled). Parallel synth / serial playback is the right pattern. APK 42 MB before dead-dep removal (arm64, ProGuard). JS-thread PCM handling (frame → RMS → SharedValue) is cheap; base64 encode of ≤20 s runs once on stop (~640 KB, fine). Orb idle battery cost noted above.

---

## The single most important missing thing

**A production backend.** See LAUNCH-CHECKLIST.md §1 and the closing section of the final report: every fix in this audit is moot while `PROD_API_BASE_URL` has nowhere to point. The app is a thin client — chat, STT, TTS, translation, auth all live in `web/`, which currently runs only on your laptop with users in a local JSON file. Runner-up candidates (streaming STT latency, audio focus) are quality problems; this one is an existence problem.
