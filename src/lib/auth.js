import { all, one, run } from './db.js';
import { randomToken, sha256Hex } from './crypto.js';
import { HttpError } from './util.js';

export const COOKIE = '__Host-sid';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function startSession(env, type, ref, hours) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + hours * 3600 * 1000);
  await run(env, 'INSERT INTO sessions (token_hash, user_type, user_ref, created_at, expires_at) VALUES (?,?,?,?,?)',
    hash, type, String(ref), now.toISOString(), expires.toISOString());
  return { token, maxAge: hours * 3600 };
}

export const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function loadSession(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (!token || token.length < 20) return null;
  const hash = await sha256Hex(token);
  const s = await one(env, 'SELECT user_type, user_ref, expires_at FROM sessions WHERE token_hash = ?', hash);
  if (!s) return null;
  if (s.expires_at <= new Date().toISOString()) {
    await run(env, 'DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  if (s.user_type === 'staff') {
    const user = await one(env, 'SELECT id, email, name, role FROM users WHERE id = ? AND active = 1', Number(s.user_ref));
    return user ? { type: 'staff', hash, user } : null;
  }
  const student = await one(env,
    'SELECT student_id, first_name, last_name, grade, homeroom_teacher, room FROM students WHERE student_id = ? AND active = 1',
    Number(s.user_ref));
  return student ? { type: 'student', hash, student } : null;
}

export const endSession = (env, hash) => run(env, 'DELETE FROM sessions WHERE token_hash = ?', hash);
export const endAllSessions = (env, type, ref) =>
  run(env, 'DELETE FROM sessions WHERE user_type = ? AND user_ref = ?', type, String(ref));

// ---- Login throttling (per account and per IP) --------------------------------
const WINDOW_MS = 15 * 60 * 1000;

export async function assertNotLocked(env, keys, limits) {
  const since = Date.now() - WINDOW_MS;
  for (let i = 0; i < keys.length; i++) {
    const r = await one(env, 'SELECT COUNT(*) AS c FROM login_attempts WHERE key = ? AND ts > ?', keys[i], since);
    if (r.c >= limits[i]) {
      throw new HttpError(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again, or ask an admin to reset it.');
    }
  }
}
export async function recordFailure(env, keys) {
  const now = Date.now();
  for (const k of keys) await run(env, 'INSERT INTO login_attempts (key, ts) VALUES (?, ?)', k, now);
}
export const clearFailures = (env, key) => run(env, 'DELETE FROM login_attempts WHERE key = ?', key);

export async function cleanup(env) {
  await run(env, 'DELETE FROM sessions WHERE expires_at <= ?', new Date().toISOString());
  await run(env, 'DELETE FROM login_attempts WHERE ts < ?', Date.now() - WINDOW_MS);
}

export { all };
