import crypto from 'crypto';

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Resolve the secret lazily (per call), NOT at module load. A module-level
// throw would break `next build`, which imports every route module while
// collecting page data — and the build env usually has no runtime secrets.
// Checking here means the build succeeds but a running production server
// without JWT_SECRET still fails fast the moment auth is used (with the dev
// fallback, anyone could forge a token and use the paid routes for free).
function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'mia-dev-secret-change-in-production';
}

type Payload = { sub: string; email: string; iat: number; exp: number };

function b64u(s: string) {
  return Buffer.from(s).toString('base64url');
}

export function signToken(claims: { sub: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iat: now, exp: now + TTL_SECONDS }));
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): Payload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto
      .createHmac('sha256', getSecret())
      .update(`${header}.${body}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
