import { signToken } from '@/lib/auth/jwt';

// Dev-only guest session: lets the mobile app skip sign-up while developing.
// Production answers 404 so nobody can mint a free token for the paid routes.
const GUEST = { id: 'guest-dev', email: 'guest@mia.dev' };

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const token = signToken({ sub: GUEST.id, email: GUEST.email });
  return Response.json({ token, user: GUEST });
}
