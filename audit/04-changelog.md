# Mia — Restoration Changelog (Phase 4)

Each entry = one step of `03-gap-plan.md` = one commit. Verification noted per step.

## Step 1 — Dead JS code deleted (plan items 5, 6-JS, 7, 20, 21-logic)
- **Deleted files:** `src/screens/MusicDevScreen.tsx` (unreachable dev screen), `__tests__/App.test.tsx` (single skipped test), `assets/orb-static.png` + `scripts/gen-orb-static.mjs` (orphaned — nothing imports the PNG), `scripts/generate-icon.mjs` + `scripts/generate-icon-pro.mjs` (superseded by `gen-icons.mjs`, the one wired to `npm run icons`), `build-release.log`.
- **`lib/tools/music.ts`:** rewritten to transport-only (pause/resume/toggle/next/prev/restart). Removed `playFromSearch`, `stop`, `isProviderInstalled`, `MUSIC_PROVIDER_PACKAGES`, `MusicProvider` — the server has no `play_music`/`stop_music` tools, so none of it was reachable from voice.
- **`lib/tools/runClientCalls.ts`:** dropped the `play_music`/`stop_music` branches + provider parsing; dropped two always-on `console.warn` debug lines that were rewritten away with the file.
- **`lib/tools/platform/index.ts` / `native.ts`:** removed never-called `notify()`; removed dead iOS logic (`scheduleAlarmIOSRecurring`, iOS branch in `scheduleAlarm`, per-weekday cancel loop, `ios:` notification payloads referencing a nonexistent `alarm.caf`) — product is Android-only. Same `ios:` payloads removed from `headless.ts`.
- **`lib/wakeSession.ts`:** "TEMP diagnostic — remove once the stall is fixed" comment corrected — the stall was fixed; the tracing stays because the headless session has no Metro and logcat is its only window.
- **Tests:** `runClientCalls.test.ts` updated (play_music/stop_music cases removed with the feature).
- **Why:** spec §4 — Mia must not pretend to search music; no iOS; no dead surface.
- **Verify:** grep clean, `tsc --noEmit` clean, jest 20/20 green. Behavior change: none (all deleted paths were unreachable).

## Step 2 — Dead Kotlin + manifest queries (plan item 6-Kotlin)
- **`MusicControlModule.kt`:** removed `playFromSearch`, `isProviderInstalled`, `stop` (JS no longer declares/calls any of them) and their now-unused imports; doc comment updated to state the module is transport-only by design.
- **`AndroidManifest.xml`:** removed the whole `<queries>` block (three music-app package queries + `MEDIA_PLAY_FROM_SEARCH` intent) — it existed only to resolve the deleted search intent. Media-key dispatch needs no package visibility.
- **Verify:** grep clean; `gradlew :app:compileDebugKotlin` succeeds. Behavior change: none (media transport untouched).

## Step 3 — Dependency prune (plan items 8, 9)
- **Removed deps:** `@react-native/new-app-screen` (template leftover, 0 imports), `react-native-permissions` (0 imports — `PermissionsAndroid` used directly), `react-native-config` (never wired into the Android build; `Config.*` was always undefined at runtime), `react-native-gesture-handler` (only `GestureHandlerRootView`, no gestures anywhere; native-stack doesn't need it).
- **`config/env.ts`:** rewritten without `Config` — dev URL is a plain `__DEV__` constant (`http://localhost:3002` via adb reverse), prod values unchanged.
- **`App.tsx`:** `GestureHandlerRootView` wrapper removed.
- **`tsconfig.json`:** dropped `react-native-config` types; **`apiUrl.test.ts`** rewritten without the config mock (asserts against the dev URL).
- **Verify:** tsc clean, jest 20/20, `compileDebugKotlin` green (autolinking picked up the removals). Behavior change: none at runtime (Config was already inert); dev-URL override via `.env` never worked anyway.

## Step 4 — Fallback STT pipeline removed (plan item 10)
- **Deleted:** `hooks/useAudioRecorder.ts` (nitro-sound m4a recorder), `api/transcribe.ts` (SSE consumer), `web/src/app/api/transcribe-stream/route.ts` (gpt-4o-transcribe endpoint).
- **`hooks/useVoicePipeline.ts`:** collapsed to the single PCM→Chirp 2 path; removed the recorder-kind state machine and dev-only `dlog` around the fallback attempt. A Picovoice start failure now surfaces as a user-visible error instead of a silent downgrade — the module is compiled into every build, so this can only mean something is genuinely broken.
- **Cleanups:** stale references in `useSilenceAutoStop`/`audioLevel`/`pcmCapture` comments; `errorMessages` no longer matches "transcription stream stalled" (that stream is gone).
- **Why:** spec §4 — one capture path, one STT provider. ~350 lines and a second STT vendor deleted.
- **Verify:** mobile tsc + jest 20/20; web tsc clean (after clearing stale generated `.next/types`). **Device check needed (yours): one full voice turn.**

## Step 5 — Fonts routed through theme tokens (plan item 11)
- **The defect:** ~39 style entries across 13 files hardcoded `fontFamily: 'Manrope-*'` — Manrope has never been in `assets/fonts/`, so all of that text silently rendered in Roboto, off the design system.
- **`theme/typography.ts`:** comment corrected (it claimed Manrope files exist); added two deliberate tokens — `fonts.numeric` (`SpaceGrotesk-Bold`, big clock/countdown numerals) and `fonts.brand` (`Coiny-Regular`, the wordmark).
- **Replacements everywhere:** `Manrope-SemiBold`→`fonts.bodyBold` (MarkGEO-Bold), `Manrope-Regular`→`fonts.body` (MarkGEO-Regular), `SpaceGrotesk-Bold`→`fonts.numeric`, `SpaceGrotesk-Medium`→`fonts.body` (its one use was a Georgian time-ago label that SpaceGrotesk can't even render — Latin-only face), MarkGEO/Coiny literals→tokens. Zero `fontFamily` literals remain outside `theme/`.
- **Deleted:** `SpaceGrotesk-Medium.ttf` (now unused, both copies) and `Coiny.zip` (a zip archive sitting in the fonts dir). OFL license + README kept.
- **Intended visible change:** text that was accidentally Roboto now renders in MarkGEO (per spec: Georgian correctness, one styling pattern).
- **Verify:** tsc + jest green; grep shows no font literals outside theme. **Visual pass on all screens is yours.**

## Step 6 — Playback consolidated (plan item 12)
- **New `lib/filePlayback.ts`:** `makeFilePlayback(playFile, stop)` — the one implementation of the synth-complete-file → chain-serialized playback → unlink pattern that three backends had each hand-rolled. `mimeForPath` moved here (out of `assistantTurn`, which is about turns, not MIME types).
- **`nativePlayback.ts`:** now 13 lines — the factory over `nativeAudio`.
- **`wakeSession.ts` overlayPlayback:** now the factory over `orbOverlay.playTts` (private chain code deleted).
- **`orbPlayback.ts`:** streaming path unchanged; its file fallback is now the factory too.
- **`audioPlayer.ts` deleted:** it was a second, weaker nitro-sound file player (no watchdog, end−60 ms heuristic) used only by the Translator. `nativeAudio` (watchdogged) is now the app's single file player; it gained a guard that settles any in-flight `play()` when a new one starts (replay taps), and the Translator now unlinks its one-shot TTS files after playback (they used to accumulate until the next app launch's sweep).
- **Verify:** tsc + jest green. **Device checks (yours): translator speak + replay; a "Hey Mia" overlay turn; in-app turn with streaming forced off is unreachable normally — the orb fallback only triggers on stream failure.**

## Step 7 — Pipeline hardening (plan items 14, 15, 16)
- **Ghost-turn race fixed (`useVoicePipeline`):** `startListening` now bumps the turn id, and `stopListeningAndSend` snapshots it before the STT await — a transcription superseded by a new recording/interrupt is discarded instead of firing a stale turn. The stale path also skips `wakeWord.resumeDetection()` (the new recording owns the mic).
- **Orb WebView death / stall (`orbAudio` + `AIAssistantOrb` + `orbPlayback`):** a 45 s stall watchdog fails all in-flight TTS if sentences are pending but the WebView produces no event; `onRenderProcessGone` on the orb's WebView fails them immediately when Android kills the renderer. `orbPlayback` no longer falls back to file playback on stall/terminated errors (the fallback plays through the same WebView — it would just stall again). The turn now unwinds and the orb returns to idle instead of sticking on "speaking".
- **401 dead-end fixed (`api/client.expireSessionIf401`):** any pipeline/translator/chat failure whose message carries 401/unauthorized signs the user out, so RootNavigator routes to AuthScreen — previously the toast said "log in again" with no way to do so. Called from the voice pipeline's STT catch, `runAssistantTurn`'s two error paths, and the translator. New unit test `expireSession.test.ts` (3 cases).
- **Verify:** tsc clean; jest 23/23.

## Step 8 — Logging + conversationStore hygiene (plan items 13, 17)
- **New `lib/log.ts`:** one `__DEV__`-gated `dlog`. Babel's `transform-remove-console` keeps `warn`/`error` in release, so every chatty `console.warn`/`console.log` was shipping — all are now `dlog` (orb diagnostics, TTS traces, wake-session `mlog` is a one-line wrapper over it). Genuine, rare failures were *promoted* to `console.error` for release/Sentry visibility: orb page error, WebView death, translator silent-speak, client-tool failure, pcmCapture module missing, wake-session crash. Zero ungated `console.warn|log` remain.
- **`stores/conversationStore.ts`:** dropped the derived `messages` mirror ("kept for backwards-compatible selectors") — consumers use the new `selectActiveMessages` selector (stable reference; HomeScreen + assistantTurn updated); every action stops maintaining the duplicate, and the custom persist `merge` disappears with it.
- **Debounced persistence:** `updateLastAssistant` fires per streamed token, and persist wrote (stringify of all ≤30 conversations) on every one. A custom `PersistStorage` now debounces 300 ms *above* the JSON layer — one stringify per flush, latest state wins. Cost accepted per plan: a hard kill inside the window loses the trailing ~300 ms of streamed text from history only.
- **Verify:** tsc clean; jest 23/23; grep confirms no ungated console calls.

## Step 9 — Navigation typing + AuthScreen animation consistency (plan items 18, 19)
- **`navigationRef.ts`:** exports `RootNav` (`NativeStackNavigationProp<RootStackParamList>`), the one navigation prop type.
- **`RootNavigator.tsx`:** the three `any`-typed wrapper components (`AlarmsRoute`/`TimersRoute`/`TranslatorRoute`) are gone — screens register directly.
- **Alarms/Timers/Translator screens:** `onBack` prop removed; each uses `useNavigation<RootNav>()` + `goBack()`. **HomeScreen:** `useNavigation<any>` → `useNavigation<RootNav>`. **AlarmRingScreen:** hand-rolled route/navigation prop types → `NativeStackScreenProps<RootStackParamList, 'AlarmRing'>`.
- **AuthScreen:** the two RN-`Animated` values (tab-switch fade, error shake) converted to Reanimated shared values (`withSequence`/`withTiming`, `interpolate` for the shake translate). One animation system per file now; RN `Animated` import gone.
- **Verify:** tsc clean; jest 23/23. Same navigation behavior, same animations (identical timings/curves).

## Step 10 — Repo-root cleanup + stale comments (plan items 20, 22)
- **Deleted:** `spike/` (old pipeline experiment with its own lockfile), `mia-obs/` (abandoned 2-file Obsidian vault), `PLAN.md` (Whisper-era architecture doc that contradicted the code — superseded by `audit/02-target-spec.md`), `tts-samples/` on disk (was already gitignored). `AUDIT.md` kept as a dated historical report.
- **Stale comments fixed:** `api/chat.ts` and `assistantTurn.ts` no longer claim to "mirror web/src/app/page.tsx:handleUserMessage" (that file is a 40-line landing stub now); `tools/platform/index.ts` no longer claims an identical web counterpart exists.
- **Verify:** tsc clean (comment-only code changes).
