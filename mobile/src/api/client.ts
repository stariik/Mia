import { env } from '@/config/env';

export function apiUrl(path: string) {
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
