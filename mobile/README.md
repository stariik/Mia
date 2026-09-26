# mobile/ — Mia (React Native, Android)

React Native port of the Georgian voice AI at `../web/`. Shares the Next.js
backend under `../web/src/app/api/` — deploy that to Vercel (or run locally)
and point this app at it via `.env`.

## Stack

- **Runtime:** React Native 0.85.2 (bare CLI), Hermes + new architecture on.
- **State:** Zustand stores ported verbatim from `web/src/stores/`.
- **Design:** DESIGN.md tokens → `src/theme/`. Glassmorphism via
  `@react-native-community/blur`, gradients via `react-native-linear-gradient`,
  VoiceOrb animated with Reanimated 3.
- **Pipeline:** mic → Whisper (`/api/transcribe`) → Gemini streaming via SSE
  (`/api/chat`) → TTS (Camb.ai or OpenAI) → `react-native-sound` playback.
- **Tools:** the same registry contract as web; native side-effects live in
  `src/lib/tools/platform/native.ts` (notifee + setTimeout).

## First-time setup

1. **Install deps** — already done during bootstrap:
   ```
   npm install
   ```
2. **Fonts** — drop `Manrope-Regular.ttf` and `Manrope-SemiBold.ttf` into
   `assets/fonts/`. Space Grotesk is already included. Then:
   ```
   npx react-native-asset
   ```
   See `assets/fonts/README.md` for sourcing notes. Until Manrope is added,
   text falls back to Roboto but the layout still works.
3. **Backend URL** — edit `.env`:
   ```
   API_BASE_URL=https://<your-vercel-project>.vercel.app
   ```
   For local dev against `next dev`, `http://10.0.2.2:3000` points the Android
   emulator at your host machine.
4. **Android Studio** — install if you don't have it; create an AVD (Pixel 7,
   API 34). Under the AVD's advanced settings enable
   "Virtual microphone uses host audio input".

## Run

**Emulator:**
```
npx react-native run-android
```
Metro auto-starts on port 8081.

**Physical phone (USB):**
```
adb devices                         # confirm device is visible
adb reverse tcp:8081 tcp:8081        # so phone reaches Metro at localhost
npx react-native run-android
```

**Physical phone (Wi-Fi, Android 11+):**
Developer options → Wireless debugging → Pair device with pairing code.
```
adb pair <ip:port> <code>
adb connect <ip:5555>
adb reverse tcp:8081 tcp:8081
npx react-native run-android
```

## Test

```
npm test           # Jest unit tests for API helpers + tool dispatch
npx tsc --noEmit   # Type-check
```

End-to-end verification (needs AVD + backend + mic):
1. Tap the mic → speak Georgian → release → user message appears.
2. Assistant text streams in word-by-word.
3. TTS plays back.
4. Ask for a timer ("დამიყენე ტაიმერი ხუთ წამზე") → chip appears, counts
   down, notifies at 0, chip clears.
5. Ask for an alarm ("ხუთი წუთის შემდეგ გამაღვიძე") → chip with wall-clock
   time, notification fires at trigger.

## Folder map

```
src/
  api/              client, /api/chat SSE, /api/transcribe upload, TTS
  config/env.ts     react-native-config glue
  stores/           Zustand (conversation, voice, tools)
  lib/tools/
    types.ts                  ClientToolCall type
    runClientCalls.ts         dispatches set_timer / set_alarm
    platform/
      index.ts                ToolPlatform interface
      native.ts               notifee + setTimeout adapter
  theme/            colors/typography/spacing/radius tokens from DESIGN.md
  components/       GlassCard, VoiceOrb, ChatBubble, ChipTag, GlowButton,
                    AppTextInput, ActiveTimers, ActiveAlarms, SettingsSheet
  hooks/            useVoicePipeline, usePcmRecorder, useAudioRecorder,
                    useSilenceAutoStop, usePermissions
  navigation/       RootNavigator (single Home screen, stack-ready)
  screens/          HomeScreen
```

## Alarms & timers

Lock-screen ringing alarm + timer with system alarm tone. Code paths:

- `src/lib/tools/platform/native.ts` — scheduling, recurrence, snooze (9 min),
  full-screen-intent on Android.
- `src/lib/tools/platform/headless.ts` — used by the boot receiver and Notifee
  background event handler when the app is killed.
- `android/app/src/main/java/com/mobile/alarm/` — native pieces:
  - `AlarmModule.kt` — exposes `getDefaultAlarmUri` + creates the `alarms-v1`
    / `timers-v1` notification channels using `RingtoneManager.TYPE_ALARM`.
  - `BootReceiver.kt` + `RescheduleAlarmsService.kt` — re-arm pending alarms
    after device reboot via the `RescheduleAlarms` headless JS task.

### iOS notes
iOS cannot show a full-screen lock-screen ring (Apple restriction). Alarms
fire as time-sensitive notifications. To use a custom tone instead of the
default notification sound, drop a `< 30s` sound file at `ios/mobile/alarm.caf`
and add it to the Xcode project (Build Phases → Copy Bundle Resources). The
JS code already references `sound: 'alarm.caf'`. Recurring alarms on iOS
schedule one weekly notification per selected weekday.

Testing iOS from Windows: use Expo EAS Build (`eas build -p ios`) + TestFlight,
or a cloud Mac (MacInCloud / MacStadium). A real iOS device is required to
validate lock-screen behavior.

## Known limitations in v1

- **Google STT disabled.** `/api/transcribe-google` hardcodes WEBM_OPUS 48 kHz;
  Android records AAC/m4a. Mobile uses Whisper exclusively.
- **No VAD.** Manual tap-to-start, tap-to-stop. The web VAD used `AudioContext`
  which has no RN equivalent yet.
- **`react-native-audio-recorder-player` v4 is marked deprecated** in favor of
  Nitro Sound. Works fine for now; swap later if it breaks.
