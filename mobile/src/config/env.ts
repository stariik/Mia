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
// (npm run tunnels / npm run device).
const DEV_API_BASE_URL = 'http://localhost:3002';

export const env = {
  apiBaseUrl: __DEV__ ? DEV_API_BASE_URL : PROD_API_BASE_URL,
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
