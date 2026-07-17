# Mia — Ideal Design & Gap Plan (Phase 3)

## 1. The ideal architecture (designed from the spec, ignoring current code)

A perfectionist building Mia from scratch lands very close to what exists — the current pipeline architecture (shared turn engine, injected playback backends, native wake stack) *is* the minimal correct design for the spec. The ideal differs at the edges: **one capture path, one STT provider, two playback backends instead of three-and-two-halves, zero dead surface, one pattern per concern.**

```
mobile/
  App.tsx  index.js
  src/
    api/            client.ts · auth.ts · chat.ts · transcribe.ts(Chirp only) · synthesize.ts · translate.ts
    audio/          pcmCapture.ts · audioLevel.ts · filePlayer.ts(one nitro-sound wrapper)
    assistant/      assistantTurn.ts(+TtsPlayback type) · orbPlayback.ts · filePlayback.ts(factory: native|overlay)
    wake/           wakeWord.ts · wakeSession.ts · orbOverlay.ts
    tools/          runClientCalls.ts · music.ts(transport only) · alarms.ts(native.ts) · alarmsHeadless.ts
    hooks/          useVoicePipeline.ts · usePcmRecorder.ts · useSilenceAutoStop.ts · usePermissions.ts · useWakeWord.ts · useTranslator.ts
    screens/        Auth · Home · Alarms · Timers · Translator · AlarmRing   (6 — no dev screens)
    components/     orb (AIAssistantOrb · orbHtml · ActiveOrbRings · OrbStatus) · sheets (Settings · AlarmEdit) · ConversationDrawer · BottomToolBar · SuggestionChips · AuroraBackdrop · MiaWordmark/BrandMark
    stores/         conversation · tools · location · auth · voice   (zustand; persist where persistent)
    navigation/     RootNavigator.tsx(typed, no wrappers) · navigationRef.ts
    theme/          colors · typography(only source of fontFamily) · spacing · radius
    lib/            errorMessages · greetings · haptics · location · translateLanguages
  android/          (unchanged native stack, minus MusicControlModule.playFromSearch)
```

**Dependencies (ideal):** current list minus `@react-native/new-app-screen`, `react-native-permissions`, `react-native-config`, `react-native-gesture-handler`. Everything else earns its place. (This grouping of `src/` is aspirational — the plan below does NOT move files for cosmetics; it only deletes, merges, and fixes. Renaming directories churns imports for zero behavior gain.)

**One pattern per concern:** Reanimated only · zustand (+persist for persistent stores; auth's manual hydrate kept deliberately for the headless runtime, documented) · typed navigation via `useNavigation<NativeStackNavigationProp<RootStackParamList>>` · all fontFamily via `theme/typography` · one `__DEV__`-gated logger · pipeline errors via `voiceStore.error`→`errorMessages`, screen-local errors via local state.

---

## 2. Ideal vs. actual — action table

| # | Area | Current state | Ideal state | Action |
|---|------|--------------|-------------|--------|
| 1 | Turn engine (`assistantTurn`, interrupts, sentence pipelining) | Correct, documented | Same | **KEEP** |
| 2 | Wake stack (Kotlin + JS, oww ONNX) | Mature, watchdogged | Same | **KEEP** |
| 3 | Alarm/timer engine (notifee + headless + reconcile) | Correct; state in 3 places is inherent to Android | Same (duplication documented) | **KEEP** |
| 4 | Backend routes + guard + prompts | Coherent, well-commented | Same minus transcribe-stream | **KEEP** (minus #10) |
| 5 | MusicDevScreen (297 ln) | Unreachable | Absent | **DELETE** |
| 6 | `play_music`/`stop_music` + `playFromSearch`/`stop`/`isProviderInstalled`/provider packages (JS) + `MusicControlModule.playFromSearch` (Kotlin) + manifest `<queries>` packages | Half-shipped feature, server never calls it | Absent (spec: MUST NOT search music) | **DELETE** |
| 7 | `nativePlatform.notify()` | Never called | Absent | **DELETE** |
| 8 | Unused deps: new-app-screen, react-native-permissions | Installed, unimported | Absent | **DELETE** |
| 9 | react-native-config + gesture-handler | Config not wired (Config.* undefined at runtime); gesture-handler = root view only | Absent; dev URL from `__DEV__` constant | **DELETE** |
| 10 | Fallback STT pipeline: `useAudioRecorder` + `api/transcribe.ts` + `/api/transcribe-stream` (~350 ln, 2nd recorder config, 2nd STT provider) | Guards against "Picovoice not linked" — impossible in release | Single capture path; missing native module = loud error | **DELETE** |
| 11 | Fonts: ~39 hardcoded `Manrope-*` (not bundled → silent Roboto fallback), stray `SpaceGrotesk-Bold` literals | Half the UI off-theme | All text through `typography`/`fonts` tokens (MarkGEO) | **REFACTOR** (visible fix) |
| 12 | Playback wrappers: `nativeAudio` + `audioPlayer` (2 nitro-sound file players), `nativePlayback` + `overlayPlayback` (2 identical synth-file chains) | 4 modules, 2 completion heuristics | 1 file-player + 1 file-playback factory (player injected); orbPlayback unchanged | **REFACTOR** |
| 13 | conversationStore: derived `messages` mirror + full-store persist on every SSE token | Redundant state, hot-path I/O | Drop mirror (selector on activeId); debounced persist storage (~300 ms) | **REFACTOR** |
| 14 | Ghost-turn race: `startListening` allowed while previous transcription in flight | Old transcript can fire a stale turn | STT phase covered by the turn-id guard | **FIX** |
| 15 | Orb WebView death → speak promises hang, thinking/speaking stick | No watchdog on speak path | Per-sentence speak watchdog + settle pending on `onRenderProcessGone`/`onContentProcessDidTerminate` | **FIX** |
| 16 | 401 → toast says "log in again", no route to Auth; no refresh | Dead end after 30-day token expiry | On 401 from guarded call: `authStore.logout()` → RootNavigator shows Auth | **FIX** |
| 17 | 16 ungated `console.warn` (survive release — babel excludes `warn`), incl. payload/URL logging | Prod log noise, minor privacy leak | One `__DEV__`-gated logger; keep genuine `console.error` | **FIX** |
| 18 | Navigation: wrapper route components + `onBack` props + `useNavigation<any>` | 3 patterns | Typed `useNavigation`, no wrappers | **REFACTOR** (small) |
| 19 | AuthScreen mixes RN Animated + Reanimated | 2 animation systems in 1 file | Reanimated only | **REFACTOR** (cosmetic, low priority) |
| 20 | Stale artifacts: `orb-static.png`+script, icon scripts ×2, `Coiny.zip`, `SpaceGrotesk-Medium.ttf`, `App.test.tsx` (skipped), `build-release.log`, "TEMP diagnostic" mlog note, stale comments (`handleUserMessage`, typography's Manrope claim) | Lies to the next reader | Absent / corrected | **DELETE/FIX** |
| 21 | iOS branches in `platform/native.ts` + `ios/` dir | Never run, never shipped | Keep `ios/` template dir (RN tooling expects it; zero maintenance) but delete dead iOS *logic* in native.ts (`scheduleAlarmIOSRecurring`, per-weekday cancels) | **DELETE** (logic only) |
| 22 | Repo root: `spike/`, `mia-obs/`, `PLAN.md` (describes Whisper-era design), `tts-samples/` | Contradicts/clutters | Removed or archived (PLAN.md superseded by `audit/02-target-spec.md`) | **DELETE** (with your OK — these are your files) |
| 23 | Sentry DSN empty → zero prod crash reporting | Spec C14 unmet | Real DSN in env.ts before release | **CONFIG** (yours — needs the DSN, not code) |
| 24 | Voice `set_alarm` lacks recurrence | Roadmap Phase 2 feature, not drift | Unchanged for now | **KEEP** (out of scope) |

## 3. Ordered execution plan (app builds & behaves after every step)

Each step = one logical commit. Verification baseline for every step: `tsc --noEmit` clean + `jest` green in `mobile/` (and `web/` typecheck when touched). Device runs are yours — flagged where they matter.

| Step | What | Verify |
|---|---|---|
| **1. Pure dead-code deletion** (items 5, 6-JS-side, 7, 20, 21-logic) — MusicDevScreen; play_music/stop_music branches + provider plumbing in `music.ts`/`runClientCalls.ts`; `notify()`; skipped App.test; orb-static asset+script; 2 old icon scripts; Coiny.zip; SpaceGrotesk-Medium; build-release.log; TEMP-comment cleanups; iOS logic in native.ts | tsc + jest; grep proves zero remaining refs |
| **2. Native dead code** (item 6-Kotlin) — `MusicControlModule.playFromSearch`, `isProviderInstalled`, manifest `<queries>` package entries (keep the media-key transport) | Android build compiles (you run it); music transport unaffected |
| **3. Dependency prune** (items 8, 9) — remove 4 deps; env.ts loses `Config.*` (dev URL = `'http://localhost:3002'` under `__DEV__`); drop tsconfig `react-native-config` types + jest mock; remove `GestureHandlerRootView` | tsc + jest; clean `npm install`; app boots (device run: yours) |
| **4. Fallback STT removal** (item 10) — delete `useAudioRecorder`, `api/transcribe.ts`, `web/.../transcribe-stream/route.ts`; `useVoicePipeline` collapses to single PCM path (Picovoice-missing now sets a clear error) | tsc both packages; jest; device voice-turn test (yours) |
| **5. Fonts** (item 11) — replace every hardcoded `Manrope-*`/`SpaceGrotesk-*` literal with `typography`/`fonts` tokens; correct typography.ts comment | tsc; visual pass on all 6 screens (yours) — *this changes visible glyphs from Roboto-fallback to MarkGEO; that's the intended fix, per spec* |
| **6. Playback consolidation** (item 12) — one nitro-sound `filePlayer`; `filePlayback(player)` factory replacing nativePlayback + overlayPlayback; move `mimeForPath` in | tsc + jest; device: translator replay, headless wake turn (yours) |
| **7. Pipeline hardening** (items 14, 15, 16) — turn-id over STT phase; speak watchdog + WebView-death settle; 401 → logout | tsc + jest (+ new unit tests for 14's guard where testable) |
| **8. Logging & store hygiene** (items 13, 17) — dlog-style logger everywhere; conversationStore drops `messages` mirror (persist `merge` already rebuilds — selectors read `conversations[activeId]`); debounced persist storage | tsc + jest; chat history survives app restart (device, yours) |
| **9. Navigation + Auth animation consistency** (items 18, 19) — typed navigation, remove wrapper routes/onBack props; AuthScreen → Reanimated only | tsc; screen-to-screen nav pass (yours) |
| **10. Docs & repo root** (item 22 — with your explicit OK per item) — remove spike/, mia-obs/; delete or archive PLAN.md; fix stale code comments | grep for stale references |
| **11. Final conformance pass** — re-read whole tree against `02-target-spec.md`; confirm every file justifies itself; write closing entry in `04-changelog.md` | full tsc + jest + your release-build smoke test |

Steps 1–4 are ~-1,200 lines and 4 dependencies with zero intended behavior change. Steps 5–9 are the correctness/consistency work. Nothing here touches the turn engine's logic, the wake stack's lifecycle, or the alarm engine's semantics.

## 4. Risk notes

- **Biggest real risk — step 4 (STT fallback removal):** if any device ships where the Picovoice native module fails at runtime (not link time), voice input dies with an error instead of degrading. Mitigation: the error is loud and Georgian; Sentry (once on) would show it; the fallback can be restored from git in minutes. I judge the ~350-line permanent tax higher than this risk, but it's your call to make at approval time.
- **Step 5 (fonts) changes how half the UI looks** — from accidental Roboto to intended MarkGEO. If you prefer the accidental look, the alternative is bundling Manrope instead; say so and I'll flip the step.
- **Step 3 (gesture-handler removal):** native-stack doesn't require it, but if any future drawer gesture is planned, removing it now means re-adding later. It's a 2-minute re-add.
- **Step 6 (playback merge):** completion heuristics differ between the two current players (exact-end vs end−60 ms + watchdog). The merged player keeps the more defensive one (watchdog). Regression surface: translator replay + headless wake turn — both on your device checklist.
- **Step 8 (debounced persist):** a hard app kill within the debounce window loses the last ~300 ms of streamed assistant text in history (not on screen). Acceptable; flush on turn end closes most of it.
- **What could break invisibly:** the wake session and alarm headless paths run without Metro attached — after steps 4/6/7, an on-device "Hey Mia" session and a killed-app alarm fire are the two mandatory manual checks before calling this done.
- **Not touched at all:** Kotlin wake stack (except dead playFromSearch), orbHtml WebGL, VAD constants, prompts, server STT/TTS routes' logic, apiGuard, auth storage — all working, all spec-conformant.

---

**STOPPED for approval.** Say which steps to run (all, or a subset), and whether the three call-outs — STT-fallback deletion (step 4), MarkGEO-vs-Manrope (step 5), and repo-root deletions (step 10) — are approved as proposed.
