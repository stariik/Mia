import ReactNativeBlobUtil from 'react-native-blob-util';

import { apiUrl, authHeaders } from './client';

const POLL_DELAY_MS = 200;
const MAX_POLLS = 240;

/** Returns the absolute local file path of the downloaded audio. */
export async function synthesizeWithCamb(text: string): Promise<string> {
  const submitRes = await fetch(apiUrl('/api/synthesize-camb'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!submitRes.ok) throw new Error(await readError(submitRes, 'Camb submit'));
  const { taskId } = (await submitRes.json()) as { taskId: number };

  let status = 'PENDING';
  let runId: number | null = null;

  for (let i = 0; i < MAX_POLLS && status === 'PENDING'; i++) {
    await sleep(POLL_DELAY_MS);
    const pollRes = await fetch(
      apiUrl(`/api/synthesize-camb/status?taskId=${taskId}`),
    );
    if (!pollRes.ok) throw new Error(await readError(pollRes, 'Camb poll'));
    const data = (await pollRes.json()) as {
      status: string;
      runId: number | null;
    };
    status = data.status;
    runId = data.runId;
  }

  if (status !== 'SUCCESS' || !runId) {
    throw new Error(`Camb TTS failed: ${status}`);
  }

  return downloadToCache(
    apiUrl(`/api/synthesize-camb/audio?runId=${runId}`),
    'wav',
  );
}

export async function synthesizeWithOpenAI(
  text: string,
  voice: string,
): Promise<string> {
  const url = apiUrl('/api/synthesize');
  return downloadToCachePost(url, { text, voice }, 'mp3');
}

/**
 * ElevenLabs Flash v2.5 multilingual (Georgian).
 * The server streams audio bytes directly from ElevenLabs — no polling.
 * Typical first-byte latency: ~200–400ms vs Camb's 600ms–2s.
 */
export async function synthesizeWithElevenLabs(text: string): Promise<string> {
  const url = apiUrl('/api/synthesize-elevenlabs');
  return downloadToCachePost(url, { text }, 'mp3');
}

async function downloadToCache(url: string, ext: 'wav' | 'mp3') {
  const task = ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: ext,
  }).fetch('GET', url);
  const res = await task;
  const info = res.info();
  if (info.status < 200 || info.status >= 300) {
    throw new Error(`TTS download failed (${info.status})`);
  }
  return res.path();
}

async function downloadToCachePost(
  url: string,
  body: Record<string, unknown>,
  ext: 'wav' | 'mp3',
) {
  const task = ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: ext,
  }).fetch(
    'POST',
    url,
    { 'Content-Type': 'application/json', ...authHeaders() },
    JSON.stringify(body),
  );
  const res = await task;
  const info = res.info();
  if (info.status < 200 || info.status >= 300) {
    throw new Error(`TTS failed (${info.status})`);
  }
  return res.path();
}

async function readError(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { error?: string };
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}
