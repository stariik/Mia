import { createUser } from '@/lib/auth/users';
import { signToken } from '@/lib/auth/jwt';

export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      );
    }

    const user = createUser(email, password);
    if (!user) {
      return Response.json({ error: 'Email already in use' }, { status: 409 });
    }

    const token = signToken({ sub: user.id, email: user.email });
    return Response.json({ token, user: { id: user.id, email: user.email } });
  } catch {
    return Response.json({ error: 'Registration failed' }, { status: 500 });
  }
}
