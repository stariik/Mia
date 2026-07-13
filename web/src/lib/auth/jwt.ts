import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET ?? 'mia-dev-secret-change-in-production';
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

type Payload = { sub: string; email: string; iat: number; exp: number };

function b64u(s: string) {
  return Buffer.from(s).toString('base64url');
}

export function signToken(claims: { sub: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iat: now, exp: now + TTL_SECONDS }));
  const sig = crypto
    .createHmac('sha256', SECRET)
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
      .createHmac('sha256', SECRET)
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
