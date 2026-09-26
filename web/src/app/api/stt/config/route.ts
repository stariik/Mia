import { guard } from '@/lib/apiGuard';
import { enabledFor } from '@/stt/config';

export function GET(request: Request) {
  const auth = guard(request);
  if ('error' in auth) return auth.error;
  return Response.json(
    { streaming: enabledFor(auth.userId), version: 1 },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
