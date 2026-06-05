import Config from 'react-native-config';

export const env = {
  // NOTE: react-native-config is NOT wired into the Android build (no
  // dotenv.gradle apply), so Config.API_BASE_URL is undefined and THIS
  // fallback is what's actually used at runtime. Edit it here for dev.
  // `localhost` works on-device once you run:  adb reverse tcp:3000 tcp:3000
  apiBaseUrl: Config.API_BASE_URL || 'http://localhost:3002',
};
