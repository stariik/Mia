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
