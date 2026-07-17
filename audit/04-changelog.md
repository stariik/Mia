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
