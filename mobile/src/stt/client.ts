import { apiUrl, authHeaders } from '@/api/client';

export async function streamingEnabled(signal: AbortSignal): Promise<boolean> {
  const response = await fetch(apiUrl('/api/stt/config'), {
    headers: authHeaders(),
    signal,
  });
  if (response.status === 404) return false; // older server during staged deployment
  if (!response.ok)
    throw new Error(
      `${response.status}: Could not check speech configuration.`,
    );
  const config = await response.json();
  return config.version === 1 && config.streaming === true;
}

export function streamUrl() {
  const url = apiUrl('/api/stt/stream').replace(/^http/, 'ws');
  // ponytail: dev has no Caddy in front — dial the gateway's own port (WS_PORT).
  return __DEV__ ? url.replace(':3002/', ':3001/') : url;
}
