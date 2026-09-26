import { createHash } from 'node:crypto';
import { createClient } from 'redis';

export type Lease = { release(seconds: number): Promise<void> };
export interface Quotas {
  rate(key: string, limit: number): Promise<boolean>;
  acquire(user: string, id: string): Promise<Lease | null>;
  healthy(): Promise<boolean>;
}
// Reserve the full bounded connection lifetime before opening a paid upstream.
// A crash leaves the reservation charged (conservative), while concurrency leases expire.
const RESERVE = 70;
const acquireScript = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) or redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return 0 end
if tonumber(redis.call('GET', KEYS[3]) or '0') + 70 > tonumber(ARGV[6]) or tonumber(redis.call('GET', KEYS[4]) or '0') + 70 > tonumber(ARGV[7]) then return 0 end
redis.call('ZADD', KEYS[1], now + 75000, ARGV[2])
redis.call('ZADD', KEYS[2], now + 75000, ARGV[2])
redis.call('EXPIRE', KEYS[1], 90)
redis.call('EXPIRE', KEYS[2], 90)
redis.call('INCRBY', KEYS[3], 70)
redis.call('INCRBY', KEYS[4], 70)
redis.call('EXPIRE', KEYS[3], 172800)
redis.call('EXPIRE', KEYS[4], 172800)
redis.call('SET', KEYS[5], 1, 'EX', 172800)
return 1`;
const releaseScript = `
if redis.call('DEL', KEYS[5]) == 0 then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DECRBY', KEYS[3], ARGV[2])
redis.call('DECRBY', KEYS[4], ARGV[2])
return 1`;
export const opaque = (s: string) =>
  createHash('sha256').update(s).digest('hex');
const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${name}`);
  return n;
};

export async function redisQuotas(url: string) {
  const redis = createClient({
    url,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) =>
        retries > 5
          ? new Error('Redis unavailable')
          : Math.min(retries * 200, 1000),
    },
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100,
  });
  redis.on('error', () => {}); // callers fail closed; never log credentials/URLs
  await redis.connect();
  const quotas: Quotas = {
    async healthy() {
      return redis.isReady && (await redis.ping()) === 'PONG';
    },
    async rate(key, max) {
      const count = await redis.eval(
        `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return n`,
        {
          keys: [`stt:rate:${opaque(key)}`],
          arguments: [],
        },
      );
      return Number(count) <= max;
    },
    async acquire(user, id) {
      const day = new Date().toISOString().slice(0, 10);
      const who = opaque(user);
      const keys = [
        'stt:active:global',
        `stt:active:${who}`,
        `stt:seconds:${day}:global`,
        `stt:seconds:${day}:${who}`,
        `stt:lease:${id}`,
      ];
      const ok = await redis.eval(acquireScript, {
        keys,
        arguments: [
          String(Date.now()),
          id,
          day,
          String(limit('STT_GLOBAL_CONCURRENT', 10)),
          String(limit('STT_USER_CONCURRENT', 1)),
          String(limit('STT_GLOBAL_DAILY_SECONDS', 7200)),
          String(limit('STT_USER_DAILY_SECONDS', 900)),
        ],
      });
      if (!ok) return null;
      return {
        async release(seconds) {
          await redis.eval(releaseScript, {
            keys,
            arguments: [
              id,
              String(
                RESERVE - Math.min(RESERVE, Math.max(0, Math.ceil(seconds))),
              ),
            ],
          });
        },
      };
    },
  };
  return { quotas, close: () => redis.quit() };
}
