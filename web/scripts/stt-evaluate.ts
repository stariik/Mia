/** Opt-in replay only: no chat/actions. All recordings and result text stay outside Git. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { evaluate, type Recording, type Result } from '../src/stt/evaluation';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function privatePath(file: string) {
  const resolved = path.resolve(file);
  if (!resolved.split(path.sep).includes('stt-evaluation-private'))
    throw new Error('Use an ignored stt-evaluation-private directory.');
  return resolved;
}
function pcm(file: string) {
  const data = fs.readFileSync(file);
  if (path.extname(file) === '.pcm') return data;
  if (
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Expected PCM16 WAV or .pcm');
  let valid = false;
  for (let offset = 12; offset + 8 <= data.length; ) {
    const size = data.readUInt32LE(offset + 4),
      name = data.toString('ascii', offset, offset + 4);
    if (name === 'fmt ')
      valid =
        size >= 16 &&
        data.readUInt16LE(offset + 8) === 1 &&
        data.readUInt16LE(offset + 10) === 1 &&
        data.readUInt32LE(offset + 12) === 16000 &&
        data.readUInt16LE(offset + 22) === 16;
    if (name === 'data') {
      if (!valid || offset + 8 + size > data.length)
        throw new Error('Expected mono PCM16LE 16 kHz');
      return data.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV data');
}
async function replay(
  base: string,
  token: string,
  provider: string,
  recording: Recording,
  data: Buffer,
): Promise<Result> {
  const common = {
    id: recording.id,
    provider,
    audioSha256: crypto.createHash('sha256').update(data).digest('hex'),
    text: '',
    actualBilledUsd: null,
    firstPartialMs: null,
    finalLatencyMs: null,
    capturedThroughSpeechEnd: false,
  };
  if (provider === 'legacy') {
    const started = Date.now();
    const response = await fetch(`${base}/api/transcribe-google-v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioBase64: data.toString('base64'),
        sampleRate: 16000,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    return {
      ...common,
      text: response.ok ? body.text ?? '' : '',
      error: response.ok ? undefined : `http_${response.status}`,
      finalLatencyMs:
        Date.now() -
        started +
        data.length / 32 -
        (recording.speechEndMs ?? data.length / 32),
      capturedThroughSpeechEnd: true,
    };
  }
  return new Promise<Result>((resolve) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/stt/stream`);
    const identity = {
      sessionId: crypto.randomUUID(),
      utteranceId: crypto.randomUUID(),
    };
    let started = 0,
      sent = 0,
      finishing = false,
      ended = false;
    let firstPartialMs: number | null = null;
    const done = (text: string, error?: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      ws.close();
      resolve({
        ...common,
        text,
        error,
        firstPartialMs,
        finalLatencyMs:
          started && recording.speechEndMs != null
            ? Date.now() - started - recording.speechEndMs
            : null,
        capturedThroughSpeechEnd:
          recording.speechEndMs == null || sent / 32 >= recording.speechEndMs,
      });
    };
    const deadline = setTimeout(() => {
      done('', 'timeout');
      ws.terminate();
    }, 70000);
    const finish = () => {
      if (finishing || ended) return;
      finishing = true;
      ws.send(JSON.stringify({ ...identity, type: 'finish' }));
    };
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          ...identity,
          type: 'start',
          token,
          version: 1,
          sampleRate: 16000,
          channels: 1,
          encoding: 'pcm16',
        }),
      ),
    );
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (
        event.sessionId !== identity.sessionId ||
        event.utteranceId !== identity.utteranceId
      )
        return;
      if (event.type === 'ready') {
        if (event.provider !== provider) {
          done('', 'wrong_server_provider');
          return;
        }
        if (recording.keepListening)
          ws.send(JSON.stringify({ ...identity, type: 'keep_listening' }));
        started = Date.now();
        void (async () => {
          for (
            let offset = 0;
            offset < data.length && !ended && !finishing;
            offset += 3200
          ) {
            await sleep(Math.max(0, started + offset / 32 - Date.now()));
            if (ended || finishing) break;
            const packet = data.subarray(offset, offset + 3200);
            ws.send(packet);
            sent += packet.length;
          }
          finish();
        })().catch(() => done('', 'send_failed'));
      } else if (
        event.type === 'partial' &&
        event.text?.trim() &&
        firstPartialMs === null &&
        recording.speechStartMs != null
      )
        firstPartialMs = Date.now() - started - recording.speechStartMs;
      else if (event.type === 'endpoint' && !recording.keepListening) finish();
      else if (event.type === 'final') done(event.text);
      else if (event.type === 'error') done('', event.code);
    });
    ws.on('error', () => done('', 'connection_error'));
    ws.on('close', () => {
      if (!ended) done('', 'disconnected');
    });
  });
}
async function main() {
  const [
    command,
    manifestArg,
    outputArg,
    provider = 'elevenlabs',
    count = '10',
  ] = process.argv.slice(2);
  if (!manifestArg || !outputArg)
    throw new Error(
      'Usage: stt-evaluate.ts replay|score PRIVATE_MANIFEST PRIVATE_RESULTS [provider] [limit<=60]',
    );
  const manifestPath = privatePath(manifestArg),
    output = privatePath(outputArg);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    recordings: Recording[];
    deviceGates?: Record<string, boolean>;
  };
  if (command === 'score') {
    const results: Result[] = fs
      .readFileSync(output, 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    console.log(
      JSON.stringify(
        evaluate(manifest.recordings, results, manifest.deviceGates),
        null,
        2,
      ),
    );
    return;
  }
  if (
    command !== 'replay' ||
    !['legacy', 'elevenlabs', 'google'].includes(provider)
  )
    throw new Error('Invalid command or provider');
  const base = process.env.STT_EVAL_BASE_URL?.replace(/\/$/, ''),
    token = process.env.STT_EVAL_TOKEN;
  if (!base || !token)
    throw new Error('Set STT_EVAL_BASE_URL and STT_EVAL_TOKEN');
  const limit = Number(count);
  if (!Number.isInteger(limit) || limit < 1 || limit > 60)
    throw new Error('Replay limit must be 1..60');
  const selected = manifest.recordings.slice(0, limit).map((recording) => {
    if (!recording.humanRecorded)
      throw new Error(`Record ${recording.id} on a phone first`);
    const data = pcm(
      privatePath(path.resolve(path.dirname(manifestPath), recording.file)),
    );
    if (!data.length || data.length % 2 || data.length > 1920000)
      throw new Error('Audio must be <=60 seconds of PCM16 mono');
    return { recording, data };
  });
  if (selected.reduce((n, r) => n + r.data.length / 32000, 0) > 900)
    throw new Error('Evaluation run exceeds 15 minutes');
  for (const { recording, data } of selected) {
    const result = await replay(base, token, provider, recording, data);
    fs.appendFileSync(output, JSON.stringify(result) + '\n');
    console.log(
      JSON.stringify({
        id: recording.id,
        provider,
        error: result.error ?? null,
      }),
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
