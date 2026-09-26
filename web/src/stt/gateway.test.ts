import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createGateway } from './gateway';
import { signToken } from '../lib/auth/jwt';
import { redisQuotas, type Quotas } from './quota';
import type { ProviderEvent, ProviderFactory } from './providers';

const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms));
process.env.STT_ENABLED = 'true';
process.env.STT_ROLLOUT = 'all';
process.env.JWT_SECRET = 'test-only-secret';
function fakeProvider() {
  const sessions: {
    emit: (event: ProviderEvent) => void;
    audio: Buffer[];
    cancelled: boolean;
    finished: boolean;
  }[] = [];
  const factory: ProviderFactory = (_name, emit) => {
    const session = {
      emit,
      audio: [] as Buffer[],
      cancelled: false,
      finished: false,
    };
    sessions.push(session);
    queueMicrotask(() => emit({ type: 'ready' }));
    return {
      write: (audio) => session.audio.push(audio),
      finish: () => {
        session.finished = true;
      },
      cancel: () => {
        session.cancelled = true;
      },
    };
  };
  return { sessions, factory };
}
async function connect(
  port: number,
  user = 'user',
  token = signToken({ sub: user, email: '' }),
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/stt/stream`);
  const messages: Record<string, unknown>[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  await once(ws, 'open');
  const send = (type: string) =>
    ws.send(JSON.stringify({ type, sessionId: 's', utteranceId: 'u' }));
  ws.send(
    JSON.stringify({
      type: 'start',
      sessionId: 's',
      utteranceId: 'u',
      token,
      version: 1,
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm16',
    }),
  );
  const wait = async (type: string) => {
    for (let i = 0; i < 200; i++) {
      const m = messages.find((e) => e.type === type);
      if (m) return m;
      await pause();
    }
    throw new Error(`Timed out waiting for ${type}`);
  };
  return { ws, messages, send, wait };
}
async function fixture(quotas?: Quotas) {
  let releases = 0;
  const q = quotas ?? {
    rate: async () => true,
    healthy: async () => true,
    acquire: async () => ({
      release: async () => {
        releases++;
      },
    }),
  };
  const provider = fakeProvider();
  const metrics: Record<string, unknown>[] = [];
  const gateway = createGateway(q, provider.factory, (m) => metrics.push(m));
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const port = (gateway.server.address() as { port: number }).port;
  return { ...gateway, ...provider, port, metrics, releases: () => releases };
}
test('authentication happens before quota acquisition and paid connection', async () => {
  const f = await fixture();
  try {
    const c = await connect(f.port, 'user', 'invalid');
    assert.equal((await c.wait('error')).code, 'unauthorized');
    assert.equal(f.sessions.length, 0);
  } finally {
    await f.close();
  }
});
test('segments aggregate, Keep listening suppresses endpoints, only acknowledged Finish can finalize', async () => {
  const f = await fixture();
  try {
    const c = await connect(f.port);
    await c.wait('ready');
    c.send('keep_listening');
    await pause();
    c.ws.send(Buffer.alloc(3200));
    await pause();
    const p = f.sessions[0];
    p.emit({ type: 'segment', text: 'ერთი' });
    p.emit({ type: 'endpoint' });
    p.emit({ type: 'segment', text: 'ორი' });
    await pause();
    assert.equal(
      c.messages.filter((m) => m.type === 'endpoint' || m.type === 'final')
        .length,
      0,
    );
    c.send('finish');
    await pause();
    assert.equal(p.finished, true);
    p.emit({ type: 'done' });
    assert.equal((await c.wait('final')).text, 'ერთი ორი');
    await pause();
    assert.equal(p.cancelled, true);
    assert.equal(f.releases(), 1);
    assert.equal(JSON.stringify(f.metrics).includes('ერთი'), false);
  } finally {
    await f.close();
  }
});
test('disconnect invalidates delayed provider events and releases lease', async () => {
  const f = await fixture();
  try {
    const c = await connect(f.port);
    await c.wait('ready');
    c.ws.close();
    await once(c.ws, 'close');
    await pause();
    const p = f.sessions[0];
    p.emit({ type: 'segment', text: 'late' });
    p.emit({ type: 'done' });
    assert.equal(
      c.messages.some((m) => m.type === 'final'),
      false,
    );
    assert.equal(p.cancelled, true);
    assert.equal(f.releases(), 1);
  } finally {
    await f.close();
  }
});
test('silence cannot finalize, and invalid audio closes the stream', async () => {
  const f = await fixture();
  try {
    const c = await connect(f.port);
    await c.wait('ready');
    c.send('finish');
    await pause();
    f.sessions[0].emit({ type: 'done' });
    assert.equal((await c.wait('error')).code, 'no_speech');
    const invalid = await connect(f.port);
    await invalid.wait('ready');
    invalid.ws.send(Buffer.alloc(3201));
    assert.equal((await invalid.wait('error')).code, 'protocol');
  } finally {
    await f.close();
  }
});
test('quota failures never open upstream', async () => {
  const f = await fixture({
    healthy: async () => true,
    rate: async () => true,
    acquire: async () => null,
  });
  try {
    const c = await connect(f.port);
    assert.equal((await c.wait('error')).code, 'quota');
    assert.equal(f.sessions.length, 0);
  } finally {
    await f.close();
  }
});
test(
  'Redis: ten concurrent users, per-user/global limits, cleanup and persistence across gateway restart',
  { skip: !process.env.STT_TEST_REDIS_URL },
  async () => {
    const redis = await redisQuotas(process.env.STT_TEST_REDIS_URL!);
    const prefix = `test${Date.now()}`;
    let f = await fixture(redis.quotas);
    try {
      const clients = await Promise.all(
        Array.from({ length: 10 }, (_, i) => connect(f.port, `${prefix}_${i}`)),
      );
      await Promise.all(clients.map((c) => c.wait('ready')));
      assert.equal(f.sessions.length, 10);
      clients.forEach(c => c.ws.send(Buffer.alloc(3200)));
      await Promise.all(clients.map(c => c.wait('audio_ack')));
      assert.ok(f.sessions.every(s => s.audio.length === 1));
      const extra = await connect(f.port, `${prefix}_extra`);
      assert.equal((await extra.wait('error')).code, 'quota');
      clients.forEach((c) => c.ws.close());
      await pause(100);
      assert.ok(f.sessions.every((s) => s.cancelled));
      const single = await connect(f.port, `${prefix}_single`);
      await single.wait('ready');
      const duplicate = await connect(f.port, `${prefix}_single`);
      assert.equal((await duplicate.wait('error')).code, 'quota');
      single.ws.close(); await pause(50);
      // Charge 70 seconds, restart the gateway/client, and show a daily cap still holds.
      const lease = await redis.quotas.acquire(
        `${prefix}_budget`,
        `${prefix}_lease`,
      );
      assert.ok(lease);
      await lease.release(70);
      await f.close();
      await redis.close();
      const second = await redisQuotas(process.env.STT_TEST_REDIS_URL!);
      process.env.STT_USER_DAILY_SECONDS = '100';
      f = await fixture(second.quotas);
      const exhausted = await connect(f.port, `${prefix}_budget`);
      assert.equal((await exhausted.wait('error')).code, 'quota');
      delete process.env.STT_USER_DAILY_SECONDS;
      await f.close();
      await second.close();
    } catch (error) {
      await f.close();
      await redis.close().catch(() => {});
      throw error;
    }
  },
);

test('account rate limit and delayed quota admission fail closed before opening upstream', async () => {
  const limited = await fixture({ healthy: async () => true, rate: async key => !key.startsWith('user:'), acquire: async () => null });
  try {
    const c = await connect(limited.port);
    assert.equal((await c.wait('error')).code, 'rate_limit');
    assert.equal(limited.sessions.length, 0);
  } finally { await limited.close(); }
  let admit!: (lease: { release: (seconds: number) => Promise<void> }) => void;
  let refunded = -1;
  const delayed = await fixture({ healthy: async () => true, rate: async () => true,
    acquire: () => new Promise(resolve => { admit = resolve; }) });
  try {
    const c = await connect(delayed.port); await pause();
    c.ws.close(); await once(c.ws, 'close'); await pause();
    admit({ release: async seconds => { refunded = seconds; } }); await pause();
    assert.equal(refunded, 0); assert.equal(delayed.sessions.length, 0);
  } finally { await delayed.close(); }
});
