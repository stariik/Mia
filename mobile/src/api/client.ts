import { env, isBackendConfigured } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';

export function apiUrl(path: string) {
  if (!isBackendConfigured) {
    // Release build shipped without PROD_API_BASE_URL (see config/env.ts).
    // Every caller already surfaces Error.message to the user.
    throw new Error('სერვერის მისამართი არ არის კონფიგურირებული');
  }
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Authorization header for the signed-in user (empty when logged out). The
 *  guarded API routes (chat / STT / TTS) reject calls without it. */
export function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Call with any failed request's error message. A 401 means the 30-day token
 * expired (or was revoked) — sign the user out so RootNavigator routes back to
 * AuthScreen. Without this the user is dead-ended: every call fails with
 * "სესია ამოიწურა" but nothing offers a way back to login.
 */
export function expireSessionIf401(message: string | null | undefined): void {
  if (!message) return;
  if (!/\b401\b|unauthorized/i.test(message)) return;
  if (!useAuthStore.getState().token) return; // already signed out
  useAuthStore
    .getState()
    .logout()
    .catch(() => {});
}
