import Config from 'react-native-config';

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION CONFIG — set these before building the Play Store release.
// (react-native-config is NOT wired into the Android build, so Config.* is
// undefined at runtime and these constants are what actually ships.)
// ─────────────────────────────────────────────────────────────────────────────

/** HTTPS base URL of the deployed web/ backend.
 *  This is compiled into the shipped app: if the domain ever lapses or moves,
 *  every installed copy breaks and only an app update can fix it. Keep the
 *  domain's auto-renew on. See DEPLOY.md. */
const PROD_API_BASE_URL = 'https://api.miavoice.online';

/** Sentry project DSN — crash reporting is silently OFF while empty. */
const PROD_SENTRY_DSN = '';

const DEV_API_BASE_URL = Config.API_BASE_URL || 'http://localhost:3002';

export const env = {
  apiBaseUrl: __DEV__ ? DEV_API_BASE_URL : PROD_API_BASE_URL,
  sentryDsn: Config.SENTRY_DSN || PROD_SENTRY_DSN,

  // NOTE: the "Hey Mia" wake word no longer needs any key — it runs fully
  // on-device via openWakeWord (see android/.../wake/OwwEngine.kt). The old
  // PICOVOICE_ACCESS_KEY was removed.
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
