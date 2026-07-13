import Config from 'react-native-config';

export const env = {
  // NOTE: react-native-config is NOT wired into the Android build (no
  // dotenv.gradle apply), so Config.API_BASE_URL is undefined and THIS
  // fallback is what's actually used at runtime. Edit it here for dev.
  // `localhost` works on-device once you run:  adb reverse tcp:3000 tcp:3000
  apiBaseUrl: Config.API_BASE_URL || 'http://localhost:3002',

  // Sentry crash reporting. Paste your project DSN here (like apiBaseUrl,
  // react-native-config isn't wired into the Android build, so Config.* is
  // undefined and this fallback is what runs). Leave '' to disable Sentry.
  sentryDsn: Config.SENTRY_DSN || '',

  // NOTE: the "Hey Mia" wake word no longer needs any key — it runs fully
  // on-device via openWakeWord (see android/.../wake/OwwEngine.kt). The old
  // PICOVOICE_ACCESS_KEY was removed.
};
