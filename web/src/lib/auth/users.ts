import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

type User = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
};

function readUsers(): User[] {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUsers(users: User[]): void {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export function createUser(email: string, password: string): User | null {
  const users = readUsers();
  if (users.some((u) => u.email === email.toLowerCase())) return null;
  const user: User = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
  };
  writeUsers([...users, user]);
  return user;
}

export function findUserByEmail(email: string): User | undefined {
  return readUsers().find((u) => u.email === email.toLowerCase());
}

export function checkPassword(user: User, password: string): boolean {
  return verifyPassword(password, user.passwordHash);
}

/** Permanently remove a user (Play account-deletion requirement). Returns
 *  false when no such user exists. */
export function deleteUser(id: string): boolean {
  const users = readUsers();
  const remaining = users.filter((u) => u.id !== id);
  if (remaining.length === users.length) return false;
  writeUsers(remaining);
  return true;
}
