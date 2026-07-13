import { apiUrl } from './client';

type AuthResponse = { token: string; user: { id: string; email: string } };

async function post(path: string, body: { email: string; password: string }): Promise<AuthResponse> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data as AuthResponse;
}

export const authApi = {
  login: (email: string, password: string) =>
    post('/api/auth/login', { email, password }),
  register: (email: string, password: string) =>
    post('/api/auth/register', { email, password }),
};
