import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from '../lib/auth/jwt';
import { enabledFor, providerName } from './config';
import { gainPacket } from './gain';
import {
  createProvider,
  type Provider,
  type ProviderFactory,
} from './providers';
import type { Lease, Quotas } from './quota';
import type { ErrorCode, Identity, ServerMessage, Start } from './protocol';

const idValid = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s);
type Event = ServerMessage extends infer M
  ? M extends Identity
    ? Omit<M, keyof Identity>
    : never
  : never;
export function createGateway(
  quotas: Quotas,
  factory: ProviderFactory = createProvider,
  metric: (record: Record<string, unknown>) => void = (record) =>
    console.info(JSON.stringify(record)),
) {
  const server = http.createServer(async (req, res) => {
    const healthy =
      req.url === '/healthz' && (await quotas.healthy().catch(() => false));
    res.writeHead(healthy ? 200 : 503).end(healthy ? 'ok' : 'unavailable');
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/stt/stream' || wss.clients.size >= 100) {
      socket.destroy();
      return;
    }
    // Trust forwarding headers only on the private network behind Caddy.
    const ip =
      process.env.STT_TRUST_PROXY === 'true'
        ? String(req.headers['x-forwarded-for'] ?? '')
            .split(',')[0]
            .trim()
        : req.socket.remoteAddress ?? 'unknown';
    void quotas
      .rate(`ip:${ip}`, 30)
      .then((ok) => {
        if (!ok || socket.destroyed) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit('connection', ws),
        );
      })
      .catch(() => socket.destroy());
  });
  wss.on('connection', (ws: WebSocket) => {
    let identity: Identity = { sessionId: '', utteranceId: '' };
    let phase: 'auth' | 'opening' | 'listening' | 'finalizing' | 'closed' =
      'auth';
    let upstream: Provider | undefined;
    let lease: Lease | undefined;
    let provider: 'google' | 'elevenlabs' = 'elevenlabs';
    let paidAt = 0,
      readyAt = 0,
      finishAt = 0,
      bytes = 0,
      lastAudio = 0,
      controls = 0;
    let firstPartialMs: number | undefined;
    let auto = true,
      spoke = false,
      endpointSent = false;
    let segments: string[] = [],
      partial = '';
    const level = { loudest: 0 };
    // Opt-in local diagnostics only: saves received PCM as WAV. Never set in production.
    const dump: Buffer[] | undefined = process.env.STT_DEBUG_DUMP_DIR
      ? []
      : undefined;
    let timer = setTimeout(
      () =>
        fail('connection_timeout', 'Connection timed out. Please try again.'),
      5000,
    );
    let initial: ReturnType<typeof setTimeout> | undefined;
    let maximum: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let expired: ReturnType<typeof setTimeout> | undefined;
    const send = (event: Event) => {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536)
        ws.send(JSON.stringify({ ...identity, ...event }));
      else cleanup('stalled');
    };
    function cleanup(outcome: string) {
      if (phase === 'closed') return;
      phase = 'closed';
      clearTimeout(timer);
      clearTimeout(initial);
      clearTimeout(maximum);
      clearInterval(heartbeat);
      clearTimeout(expired);
      try {
        upstream?.cancel();
      } catch {
        /* Still release the lease and socket. */
      }
      const durationSeconds = paidAt ? (Date.now() - paidAt) / 1000 : 0;
      void lease
        ?.release(durationSeconds)
        .catch(() => metric({ event: 'stt_quota_release_failed' }));
      metric({
        event: 'stt_session',
        provider,
        outcome,
        durationSeconds,
        audioSeconds: bytes / 32000,
        firstPartialMs,
        finalizationMs: finishAt ? Date.now() - finishAt : undefined,
        estimatedCostUsd:
          durationSeconds *
          (provider === 'elevenlabs' ? 0.39 / 3600 : 0.016 / 60),
        actualBilledUsd: null,
      });
      if (dump?.length) {
        const pcm = Buffer.concat(dump);
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcm.length, 4);
        header.write('WAVEfmt ', 8);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(16000, 24);
        header.writeUInt32LE(32000, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(pcm.length, 40);
        const dir = process.env.STT_DEBUG_DUMP_DIR!;
        // A diagnostics failure must never take down the gateway.
        try {
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            `${dir}/${Date.now()}_${provider}.wav`,
            Buffer.concat([header, pcm]),
          );
        } catch (error) {
          console.warn('STT debug dump failed:', error);
        }
        dump.length = 0;
      }
      segments = [];
      partial = '';
      ws.close();
      const terminate = setTimeout(() => ws.terminate(), 1000);
      terminate.unref();
    }
    function fail(code: ErrorCode, message: string) {
      if (phase === 'closed') return;
      send({
        type: 'error',
        code,
        message,
        retryable: !['unauthorized', 'protocol', 'disabled'].includes(code),
      });
      cleanup(code);
    }
    function endpoint() {
      if (!auto || endpointSent || phase !== 'listening') return;
      endpointSent = true;
      send({ type: 'endpoint' });
      // Stop capture and flush its tail on the client before acknowledging Finish.
      clearTimeout(timer);
      timer = setTimeout(
        () => fail('stalled', 'Phone stopped responding. Please try again.'),
        2000,
      );
    }
    function finish() {
      if (phase !== 'listening') {
        fail('protocol', 'Finish requires an active stream.');
        return;
      }
      phase = 'finalizing';
      finishAt = Date.now();
      clearTimeout(timer);
      clearTimeout(initial);
      clearTimeout(maximum);
      clearInterval(heartbeat);
      timer = setTimeout(
        () =>
          fail(
            'finalization_timeout',
            'Transcription took too long. Please try again.',
          ),
        5000,
      );
      try {
        upstream!.finish();
      } catch {
        fail('provider', 'Speech service unavailable. Please try again.');
      }
    }
    async function start(msg: Start) {
      identity = { sessionId: msg.sessionId, utteranceId: msg.utteranceId };
      const claims = verifyToken(msg.token.replace(/^Bearer /, ''));
      if (
        !claims ||
        !idValid(claims.sub) ||
        !Number.isFinite(claims.exp) ||
        claims.exp * 1000 <= Date.now()
      ) {
        fail('unauthorized', '401: Session expired. Please sign in again.');
        return;
      }
      if (!enabledFor(claims.sub)) {
        fail(
          'disabled',
          'Streaming disabled. Start a new turn to use the existing recognizer.',
        );
        return;
      }
      if (!(await quotas.rate(`user:${claims.sub}`, 20))) {
        fail('rate_limit', 'Too many attempts. Wait a minute.');
        return;
      }
      if (phase === 'closed') return;
      const acquired = await quotas.acquire(claims.sub, randomUUID());
      if ((phase as string) === 'closed') {
        await acquired?.release(0);
        return;
      }
      if (!acquired) {
        fail('quota', 'Listening limit reached. Try again later.');
        return;
      }
      lease = acquired;
      provider = providerName();
      paidAt = Date.now();
      const untilExpiry = claims.exp * 1000 - Date.now();
      expired = setTimeout(
        () =>
          untilExpiry <= 70000
            ? fail(
                'unauthorized',
                '401: Session expired. Please sign in again.',
              )
            : fail(
                'connection_timeout',
                'Listening session expired. Please start again.',
              ),
        Math.min(70000, untilExpiry),
      );
      upstream = factory(provider, (event) => {
        if (phase === 'closed') return;
        if (event.type === 'ready' && phase === 'opening') {
          phase = 'listening';
          readyAt = lastAudio = Date.now();
          clearTimeout(timer);
          send({ type: 'ready', provider, maxDurationMs: 60000 });
          initial = setTimeout(() => {
            if (!spoke)
              fail('no_speech', 'No speech detected. Tap to try again.');
          }, 8000);
          maximum = setTimeout(() => {
            auto = true;
            endpoint();
          }, 60000);
          heartbeat = setInterval(() => {
            if (Date.now() - lastAudio > 2000)
              fail(
                'stalled',
                'Audio stopped arriving. Check your connection and try again.',
              );
          }, 500);
        } else if (event.type === 'speech') {
          spoke = true;
          clearTimeout(initial);
        } else if (event.type === 'partial' || event.type === 'segment') {
          if (event.text.length > 16000) {
            fail('provider', 'Speech result exceeded the limit.');
            return;
          }
          if (event.text.trim()) {
            spoke = true;
            clearTimeout(initial);
          }
          if (event.type === 'segment') {
            if (event.text.trim()) segments.push(event.text.trim());
            partial = '';
            send({
              type: 'segment',
              segment: segments.length,
              text: event.text,
            });
          } else {
            partial = event.text;
            if (event.text.trim() && firstPartialMs === undefined)
              firstPartialMs = Date.now() - readyAt;
          }
          send({
            type: 'partial',
            text: [...segments, partial].filter(Boolean).join(' '),
          });
        } else if (event.type === 'endpoint') endpoint();
        else if (event.type === 'done') {
          if (phase !== 'finalizing') {
            fail('provider', 'Unexpected speech service completion.');
            return;
          }
          const text = segments.join(' ').trim();
          if (!spoke || !text || partial.trim()) {
            fail('no_speech', 'No complete speech result. Please try again.');
            return;
          }
          send({ type: 'final', text });
          cleanup('success');
        } else if (event.type === 'error')
          fail('provider', 'Speech service unavailable. Please try again.');
      });
      if ((phase as string) === 'closed') upstream.cancel();
    }
    ws.on('message', (data, binary) => {
      if (phase === 'closed') return;
      try {
        if (binary) {
          const audio = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
          if (
            phase !== 'listening' ||
            !audio.length ||
            audio.length > 3200 ||
            audio.length % 2
          )
            throw new Error();
          bytes += audio.length;
          if (bytes > 60000 * 32 || bytes / 32 > Date.now() - readyAt + 2000)
            throw new Error();
          lastAudio = Date.now();
          dump?.push(audio);
          upstream!.write(gainPacket(level, audio));
          send({ type: 'audio_ack', receivedBytes: bytes });
          return;
        }
        if (++controls > 20) throw new Error();
        const msg = JSON.parse(data.toString());
        if (phase === 'auth') {
          if (
            msg.type !== 'start' ||
            msg.version !== 1 ||
            !idValid(msg.sessionId) ||
            !idValid(msg.utteranceId) ||
            typeof msg.token !== 'string' ||
            msg.token.length > 4096 ||
            msg.sampleRate !== 16000 ||
            msg.channels !== 1 ||
            msg.encoding !== 'pcm16'
          )
            throw new Error();
          phase = 'opening';
          void start(msg).catch(() =>
            fail(
              'unavailable',
              'Speech service unavailable. Please try again.',
            ),
          );
        } else {
          if (
            msg.sessionId !== identity.sessionId ||
            msg.utteranceId !== identity.utteranceId
          )
            throw new Error();
          if (msg.type === 'cancel') cleanup('cancelled');
          else if (msg.type === 'finish') finish();
          else if (msg.type === 'keep_listening' && phase === 'listening') {
            auto = false;
            endpointSent = false;
            clearTimeout(timer);
          } else throw new Error();
        }
      } catch {
        fail(
          'protocol',
          'Invalid or stalled audio stream. Please start again.',
        );
      }
    });
    ws.on('close', () => cleanup('disconnected'));
    ws.on('error', () => cleanup('connection_error'));
  });
  return {
    server,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
