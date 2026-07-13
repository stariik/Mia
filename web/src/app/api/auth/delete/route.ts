import { findUserByEmail, checkPassword, deleteUser } from '@/lib/auth/users';

// POST /api/auth/delete  { email, password }
//
// Permanent account deletion (Google Play requirement: apps with account
// creation must offer in-app deletion AND a web path). Password re-auth means
// the same route serves both the app's Settings flow and the public
// /delete-account page — no token needed, so a user who lost access to the
// app can still delete their account. The account holds no other data (no
// conversations or audio are stored server-side), so deleting the user row
// deletes everything.
export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return Response.json(
        { error: 'Email and password are required' },
        { status: 400 },
      );
    }

    const user = findUserByEmail(email);
    if (!user || !checkPassword(user, password)) {
      return Response.json(
        { error: 'Incorrect email or password' },
        { status: 401 },
      );
    }

    deleteUser(user.id);
    return Response.json({ deleted: true });
  } catch {
    return Response.json({ error: 'Deletion failed' }, { status: 500 });
  }
}
