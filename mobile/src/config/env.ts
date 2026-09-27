import Constants from 'expo-constants';

import { isExpoGo } from '@/lib/runtime';

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION CONFIG — set these before building the Play Store release.
// ─────────────────────────────────────────────────────────────────────────────

/** HTTPS base URL of the deployed web/ backend.
 *  This is compiled into the shipped app: if the domain ever lapses or moves,
 *  every installed copy breaks and only an app update can fix it. Keep the
 *  domain's auto-renew on. See DEPLOY.md. */
const PROD_API_BASE_URL = 'https://api.miavoice.online';

/** Sentry project DSN — crash reporting is silently OFF while empty. */
const PROD_SENTRY_DSN = 'https://f168a97cf5948e7a15ff20291611f813@o4511756148736000.ingest.de.sentry.io/4511756151816272';

// Dev talks to the local Next.js server through `adb reverse tcp:3002`
// (npm run tunnels / npm run device). In Expo Go on a phone, localhost is the
// phone itself, so use the computer the dev server runs on: the host part of
// the address the QR code pointed at (this computer's LAN IP).
const expoDevHost = isExpoGo
  ? Constants.expoConfig?.hostUri?.split(':')[0]
  : undefined;
const DEV_API_BASE_URL = expoDevHost
  ? `http://${expoDevHost}:3002`
  : 'http://localhost:3002';

// Test APKs built against the laptop's backend (eas.json "local" profile) set
// this at bundle time. Must stay a literal process.env.EXPO_PUBLIC_* access so
// babel-preset-expo inlines it into the release bundle.
const LOCAL_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

/** True when a non-dev build talks to the local dev backend (no Caddy). */
export const isLocalBackend = !__DEV__ && !!LOCAL_API_BASE_URL;

export const env = {
  apiBaseUrl: __DEV__
    ? DEV_API_BASE_URL
    : LOCAL_API_BASE_URL || PROD_API_BASE_URL,
  sentryDsn: PROD_SENTRY_DSN,
};

/** True when the build has a usable backend URL. Release builds without
 *  PROD_API_BASE_URL show a clear Georgian error instead of dialing localhost
 *  on the user's own phone (which is what the old fallback did). */
export const isBackendConfigured = env.apiBaseUrl.length > 0;

if (!isBackendConfigured) {
  // Loud, greppable, and visible in Sentry once a DSN exists.
  console.error(
    '[env] PROD_API_BASE_URL is not set — this release build cannot reach any backend.',
  );
}
