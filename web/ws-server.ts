import dotenv from 'dotenv';
import { createGateway } from './src/stt/gateway';
import { redisQuotas } from './src/stt/quota';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
async function main() {
  if (!process.env.JWT_SECRET || !process.env.REDIS_URL)
    throw new Error('JWT_SECRET and REDIS_URL are required');
  const redis = await redisQuotas(process.env.REDIS_URL);
  const gateway = createGateway(redis.quotas);
  gateway.server.listen(Number(process.env.WS_PORT ?? 3001), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void gateway
        .close()
        .then(() => redis.close())
        .then(() => process.exit(0));
    });
}
main().catch(() => {
  console.error('STT gateway startup failed; check configuration and Redis.');
  process.exit(1);
});
