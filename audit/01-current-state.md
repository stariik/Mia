# Mia — Current State Audit (Phase 1)

**Date:** 2026-07-17 · Read-only pass over `mobile/` (RN 0.85, Android), the `web/` API backend it calls, and repo-root extras.
**Verdict up front:** the core is in much better shape than "many uncoordinated prompts" suggests — the voice pipeline, wake-word stack, and alarm engine are deliberate, commented, and defensive. The rot is at the edges: a half-shipped music-search feature that spans three layers, a fallback STT pipeline for a scenario that can't occur in release, ~39 references to fonts that aren't in the APK, three generations of icon scripts, and a repo root full of experiments.

---

## 1. Inventory — what exists and what it actually does

### Entry points
| File | What it does |
|---|---|
| `index.js` | Registers app + 2 headless tasks (`RescheduleAlarms`, `MiaWakeTurn`) + notifee background handler (snooze/dismiss/roll-recurring while killed). Sentry init — **dormant: `PROD_SENTRY_DSN` is `''`**. |
| `App.tsx` | Boot: hide splash, ensure channels/notification permission, sweep leaked TTS cache files, reconcile alarms/timers after store hydration, route alarm-fire → AlarmRing, refresh location on foreground. |

### Screens (7)
| Screen | Reachable | Notes |
|---|---|---|
| `AuthScreen` | ✓ (no token) | Login/register/delete. **Mixes two animation systems** (RN `Animated` + Reanimated) in one file. |
| `HomeScreen` (571 ln) | ✓ | Orb + tap-to-talk + text input toggle + history drawer + settings sheet + toolbar. Brittle orb-size math (`(height-170)*0.58-88`). |
| `AlarmsScreen` | ✓ | List/edit/delete alarms; recurrence UI via `AlarmEditSheet`. |
| `TimersScreen` | ✓ | Quick durations + custom hh:mm:ss; live countdown at 4 Hz. |
| `TranslatorScreen` | ✓ | Two-mic ka⇄ru/en interpreter; own error/status handling. |
| `AlarmRingScreen` | ✓ (nav ref) | Full-screen ring, snooze/dismiss, lock-screen flags toggled correctly. |
| `MusicDevScreen` (297 ln) | **✗ DEAD** | Not registered in `RootNavigator`. Dev harness for the unshipped music-search feature. |

### Voice pipeline (the heart)
```
FOREGROUND TURN
tap orb / say "Mia" / suggestion chip / typed text
 → useVoicePipeline.startListening()
    wakeWord.pauseDetection()                       [release shared mic]
    usePcmRecorder.start()                          [Picovoice VoiceProcessor, PCM16 @16 kHz]
      └─ fallback: useAudioRecorder (nitro-sound .m4a)   ← only if Picovoice native module missing
    audioLevel (Reanimated SharedValue) ← per-frame RMS  [drives orb + VAD]
 → useSilenceAutoStop                               [VAD: 400 ms calib, hysteresis, 750 ms silence, 7 s grace]
 → stopListeningAndSend()
    pcmCapture.stop() → trimSilence → base64
    POST /api/transcribe-google-v2                  [Chirp 2 + phrase boost + normalize + conditional gpt-4o-mini proofread]
      └─ fallback path: SSE /api/transcribe-stream  [gpt-4o-transcribe]
 → runAssistantTurn()                               [UI-agnostic, shared with headless]
    SSE /api/chat                                   [gpt-4o, 200 max_tokens, ≤3 tool rounds, 15 s watchdog]
    sentence-split regex → playback.speak() per sentence (synth overlaps, playback serialized)
    client tool calls → runClientToolCalls          [set_timer/set_alarm/music transport]
 → orbPlayback
    preferred: WebView MediaSource streams /api/synthesize-elevenlabs   [eleven_v3, first-byte start, 1.2 s prebuffer]
    fallback:  synth-to-file (?complete=1) → base64 over bridge → <audio>
```
```
APP-CLOSED "HEY MIA" SESSION (wakeSession.ts + WakeWordService.kt)
oww detect (on-device ONNX) → headless task MiaWakeTurn → runWakeSession()
 → orbOverlay.show() (native WebView overlay; voice-only if locked/no permission)
 → greet → native RECORD-mode capture (level events) → Chirp 2 → runAssistantTurn(nativePlayback|overlayPlayback)
 → loop ≤10 turns (orb) / 1 turn (voice-only) → goodbye/tap/silence → re-arm detection
```

Three `TtsPlayback` implementations exist: `orbPlayback` (in-app WebView, streams), `nativePlayback` (nitro-sound file, headless), `overlayPlayback` (inside wakeSession.ts — overlay WebView, file). **The latter two are near-identical synth-file-then-play chains**; overlayPlayback differs only in which player it hands the file to.

### Hooks (7)
`useVoicePipeline` (orchestrator, turn-id interrupts), `usePcmRecorder` / `useAudioRecorder` (capture), `useSilenceAutoStop` (VAD), `usePermissions` (once-per-session guard against the permission-loop keyboard bug), `useWakeWord` (launch re-arm, wake trigger, settings toggle), `useTranslator` (interpreter flow).

### Libs (`src/lib`)
- `pcmCapture` — singleton PCM capture, silence-trim, base64. Shared foreground/headless. 20 s buffer cap.
- `assistantTurn` — the shared turn engine. Solid. (Oddity: exports `mimeForPath`.)
- `orbAudio` / `orbPlayback` / `nativeAudio` / `nativePlayback` / `audioPlayer` — **five audio-playback files, three playback stacks** (WebView-stream, nitro-file for headless, nitro-file for translator). `audioPlayer.ts` and `nativeAudio.ts` are two independent nitro-sound play-file wrappers with different completion heuristics.
- `orbHtml` (1,059 ln) — self-contained WebGL orb + MediaSource TTS player. Generated-ish but hand-maintained; fine.
- `orbOverlay` / `wakeWord` / `wakeSession` — wake stack JS side. Mature, heavily commented, watchdogged.
- `tools/` — `runClientCalls` (dispatch), `music` (native transport), `platform/native` (notifee timers/alarms, 540 ln), `platform/headless` (store-free re-arm/snooze/roll, duplicates trigger config), `platform/index` (types).
- `location` (nominatim reverse geocode), `greetings`, `errorMessages` (EN→KA mapping), `haptics`, `audioLevel`, `translateLanguages`.

### Stores (5, zustand)
| Store | Persistence | Notes |
|---|---|---|
| `conversationStore` | `persist` middleware | Multi-conversation + **derived `messages` mirror kept "for backwards-compatible selectors"**. `updateLastAssistant` fires per SSE chunk → **entire store JSON-serialized to AsyncStorage on every token**. |
| `toolsStore` | `persist` | Timers + alarms. Headless code bypasses it and re-parses the same AsyncStorage key by hand. |
| `locationStore` | `persist` | city/coords/manual override/permissionDenied. |
| `authStore` | **manual** AsyncStorage hydrate | Different pattern from the other three; manual because headless needs `hydrate()` — but persist middleware could do the same. |
| `voiceStore` | none (correct) | Transient pipeline flags. |

### Native Android (2,273 ln Kotlin)
`WakeWordService` (809 ln — mic FGS, DETECT/RECORD modes, watchdogs), `OwwEngine` (openWakeWord ONNX port), `OrbOverlayModule` (floating orb WebView), `WakeTurnService` + `RescheduleAlarmsService` (headless hosts), `AlarmModule` (channels/lock-flags), `MusicControlModule` (media-key transport + **`playFromSearch` — see dead code**), `BootReceiver`, `MainActivity` (wake intents, lock flags, orb dismiss). All deliberate and documented. Assets: 3 oww ONNX models incl. trained `mia.onnx`.

### Backend (`web/` — API-only; page.tsx is a health-check landing page)
| Route | Role |
|---|---|
| `/api/chat` | gpt-4o SSE + tool loop. Guarded. |
| `/api/transcribe-google-v2` | Chirp 2 + normalize/trim/phrase-boost + confidence-gated gpt-4o-mini proofread. Guarded. |
| `/api/transcribe-stream` | gpt-4o-transcribe SSE — **only consumed by the mobile fallback recorder path**. Guarded. |
| `/api/synthesize-elevenlabs` | eleven_v3, streamed or `?complete=1`. Guarded. Excellent comments on why v3 (Georgian) and why two shapes. |
| `/api/translate` | gpt-4o. Guarded. |
| `/api/auth/{login,register,delete}` | scrypt + hand-rolled HS256 JWT (30-day TTL), **users in a JSON file** (`data/users.json`) — fine for current scale, single-instance only (matches apiGuard's in-memory limiter, ponytail-tagged). |

Server tools: get_time, get_weather, calculate (server) + set_timer, set_alarm, pause/resume/toggle/skip×2/restart music (client). **No `play_music` or `stop_music` tool exists.**

---

## 2. Dead code, unused deps, leftovers

### Dead in `mobile/src`
1. **`MusicDevScreen.tsx` (297 ln)** — unreachable; not in navigator.
2. **`play_music` / `stop_music` branches in `runClientCalls.ts`** — the server never emits these tool names; the system prompt explicitly tells the model it *cannot* search music. With them die: `parseProvider`, `VALID_PROVIDERS`.
3. **`music.playFromSearch` / `music.stop` / `music.isProviderInstalled` / `MUSIC_PROVIDER_PACKAGES`** — used only by items 1–2. Native counterpart `MusicControlModule.playFromSearch` + the three `<package>` entries + `MEDIA_PLAY_FROM_SEARCH` `<queries>` in AndroidManifest support the same dead feature. This is one half-shipped feature spanning JS, Kotlin, and the manifest.
4. **`nativePlatform.notify()`** — defined, never called (interface parity with a web platform that no longer exists as a product).
5. **`__tests__/App.test.tsx`** — a single `test.skip` with an apology comment.
6. **`assets/orb-static.png` + `scripts/gen-orb-static.mjs`** — the PNG is referenced nowhere in src; the AuthScreen use case it was generated for no longer imports it.
7. **iOS branches** throughout `platform/native.ts` (`scheduleAlarmIOSRecurring`, `alarm.caf`, per-weekday trigger cancels) and the whole `ios/` template dir — product is Android-only (Play launch); none of it has ever run.

### Unused / semi-dead dependencies
| Dep | Status |
|---|---|
| `@react-native/new-app-screen` | **Unused** (0 imports) — RN template leftover. |
| `react-native-permissions` | **Unused** (0 imports) — `PermissionsAndroid` is used directly. |
| `react-native-config` | **Functionally dead**: env.ts's own comment says it "is NOT wired into the Android build, so Config.* is undefined at runtime". Dev URL fallback + tsconfig types + a jest mock keep it looking alive. Wire it or delete it. |
| `react-native-gesture-handler` | Used only for `GestureHandlerRootView` in App.tsx; no gestures anywhere. Native-stack navigation does not require it. Removable. |
| `react-native-sse`, `react-native-nitro-sound`, `react-native-blob-util`, everything else | Genuinely used. (`nitro-modules`, `worklets`, `screens` are peer requirements — keep.) |

### The fallback STT pipeline (a judgment call, flagged honestly)
`useAudioRecorder` (m4a) → `api/transcribe.ts` (SSE) → `/api/transcribe-stream` (gpt-4o-transcribe) exists solely for "Picovoice native module not linked" — which cannot happen in a release APK (it's compiled in). It costs: one hook, one API module, one server route, one extra STT provider (with its own Georgian prompt), and a second recording configuration. Either it's insurance worth ~350 lines, or it's dead weight. Phase 3 will recommend deletion.

### Repo-root / tooling cruft
- `spike/` — an old pipeline test script with its own package-lock.
- `mia-obs/` — abandoned Obsidian vault (2 files).
- `tts-samples/` — scratch audio (already gitignored, still on disk).
- `PLAN.md` — describes the Whisper-era architecture; contradicts current code.
- `mobile/scripts/generate-icon.mjs` + `generate-icon-pro.mjs` — two superseded generations of icon scripts; only `gen-icons.mjs` is wired to `npm run icons`.
- `assets/fonts/Coiny.zip` — a zip archive shipped in the fonts folder (not compiled into the APK, but cruft).
- `SpaceGrotesk-Medium.ttf` linked into the app but never referenced.
- `mobile/build-release.log` — a build log committed at the mobile root.

### Stale comments/docs (lie to the next reader)
- `api/chat.ts` and `assistantTurn.ts` say they "mirror `web/src/app/page.tsx:handleUserMessage`" — that file is now a 40-line landing stub.
- `typography.ts` claims `Manrope-Regular.ttf` / `Manrope-SemiBold.ttf` exist in assets/fonts "as fallback" — **they do not exist** (see §3.1).
- Root `AUDIT.md` (2026-07-13) says TTS is "Flash v2.5" — code is `eleven_v3` (and documents why Flash was rejected).
- `wakeSession.ts` carries a "TEMP diagnostic — remove once the stall is fixed" logger; the fix landed.

---

## 3. Inconsistencies

### 3.1 Fonts — a real, visible defect
`assets/fonts/` contains **MarkGEO (×3), SpaceGrotesk (×2), Coiny** — no Manrope. Yet **10 files carry ~39 hardcoded `fontFamily: 'Manrope-Regular' | 'Manrope-SemiBold'`** (HomeScreen bubbles/input/toast, TranslatorScreen, TimersScreen, SettingsSheet, ConversationDrawer, BottomToolBar, OrbStatus, SuggestionChips, AlarmEditSheet, MusicDevScreen). On Android a missing family silently falls back to Roboto — so roughly half the UI ignores the design system, renders in the system font, and *possibly lacks proper Georgian rendering consistency* with the MarkGEO the theme mandates. Either add Manrope or (correct answer) route everything through `typography`/`fonts` tokens.

### 3.2 One concern, N patterns
| Concern | Patterns found |
|---|---|
| Store persistence | persist middleware ×3, manual hydrate ×1, none ×1 |
| Screen back-navigation | `onBack` prop via wrapper routes (Alarms/Timers/Translator) · navigation prop (AlarmRing) · `useNavigation<any>` (Home) |
| Animation | Reanimated everywhere except AuthScreen, which mixes in RN `Animated` |
| Error surfacing | `voiceStore.error` + `errorMessages.ts` mapping (pipeline) · inline Georgian strings (Translator) · local state + shake (Auth) |
| Logging | `__DEV__`-gated `dlog`/`mlog` vs **16 ungated `console.warn`** — and babel's `transform-remove-console` *excludes* `warn`, so those ship in release (`transcribe.ts` logs payload sizes + API URLs in prod) |
| nitro-sound play-file wrapper | `nativeAudio.ts` (position>=duration + watchdog) vs `audioPlayer.ts` (position>=duration−60 ms) — two clocks, two edge behaviors |
| Silence trimming | duplicated client (`pcmCapture`) + server (`transcribe-google-v2`) — documented as defense-in-depth, acceptable, but the constants are copy-pasted |
| Notification trigger config | duplicated `platform/native.ts` vs `platform/headless.ts` (channel IDs, actions, full-screen intent config ×2) |

### 3.3 Capability drift
- Voice `set_alarm` cannot set recurring alarms (`days` never passed) while the Alarms UI fully supports recurrence. (Known roadmap item, but it's an inconsistency the model's prompt doesn't acknowledge.)
- `translateLanguages.ts` declares 10 languages; the Translator UI offers 2 (ru/en). Server `languages.ts` is the claimed source of truth; both lists must be kept in sync by hand.

---

## 4. Fragility — races, leaks, edge cases

1. **Re-record race:** during "Transcribing…" (`modeRef === 'idle'`, transcription in flight) a new `startListening()` is allowed. The *old* transcription's `handleText` can then fire mid-new-recording — a ghost turn answering a question the user is re-asking. The turn-id guard protects assistant turns, not the STT phase.
2. **Orb WebView death = hung turn:** if Android kills the orb WebView mid-stream, `streamPending` promises in `orbAudio` never settle; `runAssistantTurn` awaits `Promise.all(spoken)` forever and `isThinking/isSpeaking` stick until the user taps (which calls `stopSpeaking`). No watchdog on the speak path (chat and greeting paths have them).
3. **AsyncStorage write per token:** `updateLastAssistant` on every SSE chunk triggers zustand persist → full `conversations` map JSON-serialized dozens of times per reply. Works, but it's the hottest path in the app doing its heaviest I/O.
4. **Expired session dead-ends:** JWT TTL is 30 days; on 401 the user sees "სესია ამოიწურა — გაიარეთ ავტორიზაცია" but nothing routes them to AuthScreen — the only path is Settings → გასვლა, which the toast doesn't say. No token refresh exists.
5. **Sentry is off:** DSN is `''`, so the entire crash-reporting wiring (init, `Sentry.wrap`) is dormant in the shipped app. A launch-checklist item, but today: zero prod telemetry.
6. **In-memory auth/rate state:** apiGuard counters and JSON-file users are single-instance by design (documented ponytail ceiling) — fine now, breaks silently if the backend ever scales to 2 instances.
7. **`pcmCapture` 20 s cap** silently stops buffering while the UI still shows "listening" — VAD normally stops first, but a noisy room + long dictation truncates input with no user feedback.
8. **`new Promise(async …)` antipattern** in `api/transcribe.ts` — rejections inside are handled, but it's a known footgun shape.
9. **Alarm state lives in three places** (zustand store, notifee triggers, in-process setTimeout handles) reconciled in three code paths (`reconcileTools`, headless roll, arm handles). It appears correct, but every new alarm feature must be implemented 2–3×; this is where the next bug will be born.
10. **Permission-loop defenses** (once-per-session requests, geolocation `skipPermissionRequests`) are correct but scattered; the invariant "no automatic code path may call `request()` twice" is enforced by convention + comments, not structure.

---

## 5. What is genuinely good (do not churn)
- `runAssistantTurn` as a UI-agnostic shared engine between foreground and headless — the right abstraction, well-executed.
- The interrupt model (monotonic turn ids + `isCurrent()` checks) — clean and correct.
- Sentence-level TTS pipelining with overlapped synthesis / serialized playback, and the MediaSource first-byte streaming path with documented prebuffer.
- The wake-word stack: on-device ONNX, action-driven FGS lifecycle, watchdogs, wake-locks, headless-task warm-runtime trick — hard-won platform knowledge, all documented.
- `usePermissions`' once-per-session policy and the keyboard-focus-bug archaeology.
- Server route comments that record *why* (eleven_v3 vs flash, streamed vs complete, regional Chirp endpoints, lazy JWT secret) — decisions won't be re-litigated by accident.
- Georgian-first UX discipline: error mapping, number normalization for TTS, phrase boosting, the system prompt.
