// Accounts for the leaderboard (docs/ROADMAP.md §7): Showdown-style name +
// password, no email. Passwords are scrypt-hashed (node:crypto, no
// dependency); the session is a signed, self-contained cookie, so there is no
// sessions table. Registration is limited per network: at most
// SIGNUPS_PER_IP_PER_DAY accounts per (hashed) IP in a rolling day.
import {createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const NAME_MAX = 18, PASSWORD_MIN = 8, PASSWORD_MAX = 128;
export const SIGNUPS_PER_IP_PER_DAY = 5;
export const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'rollmons_session';
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'rollmon', 'rollmons', 'system', 'server', 'smoketest']);

export interface User { id: number; name: string }
export interface UserRecord extends User { nameId: string; passwordHash: string; createdAt: string }
export interface UserStore {
  userByNameId(nameId: string): Promise<UserRecord | null>;
  /** Throws NameTakenError when another account already owns the name id. */
  createUser(u: {name: string; nameId: string; passwordHash: string; ipHash: string | null}): Promise<User>;
  signupsSince(ipHash: string, since: Date): Promise<number>;
}
export class NameTakenError extends Error {}

/** Showdown-style identity: case- and punctuation-insensitive; Unicode letters and digits only, so CJK names work. */
export function nameId(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** The display spelling (trimmed, single-spaced, 1–18 characters) and its identity, or null when unusable. */
export function cleanName(raw: unknown): {name: string; id: string} | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  const id = nameId(name);
  if (!id || RESERVED.has(id)) return null;
  return {name, id};
}

export function validPassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= PASSWORD_MIN && raw.length <= PASSWORD_MAX;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---- sessions: `<base64url payload>.<hmac>`; the payload carries id, display name, and expiry */

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function sessionToken(secret: string, user: User, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({u: user.id, n: user.name, e: now + SESSION_DAYS * 86_400_000})).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret: string, token: string | null | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = sign(secret, payload);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const {u, n, e} = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {u: unknown; n: unknown; e: unknown};
    return typeof u === 'number' && typeof n === 'string' && typeof e === 'number' && e > now ? {id: u, name: n} : null;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** The Set-Cookie value that stores (or, with null, clears) the session. */
export function sessionCookie(token: string | null): string {
  const attrs = 'Path=/; HttpOnly; Secure; SameSite=Lax';
  return token ? `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86_400}; ${attrs}` : `${SESSION_COOKIE}=; Max-Age=0; ${attrs}`;
}

/** Addresses are stored only as a keyed hash: enough to count sign-ups per network. */
export function ipHash(secret: string, ip: string | null | undefined): string | null {
  return ip ? createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32) : null;
}
