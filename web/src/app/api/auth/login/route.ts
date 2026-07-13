import { findUserByEmail, checkPassword } from '@/lib/auth/users';
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

    const user = findUserByEmail(email);
    if (!user || !checkPassword(user, password)) {
      return Response.json({ error: 'Incorrect email or password' }, { status: 401 });
    }

    const token = signToken({ sub: user.id, email: user.email });
    return Response.json({ token, user: { id: user.id, email: user.email } });
  } catch {
    return Response.json({ error: 'Login failed' }, { status: 500 });
  }
}
