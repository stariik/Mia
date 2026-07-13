import { env } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';

export function apiUrl(path: string) {
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Authorization header for the signed-in user (empty when logged out). The
 *  guarded API routes (chat / STT / TTS) reject calls without it. */
export function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
