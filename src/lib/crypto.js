// Hashing and token helpers using only the Web Crypto API (works in Workers and Node 20+).
//
// Staff passwords:  HMAC-SHA256(PEPPER, password) -> PBKDF2-SHA256 (per-user random salt).
// Student PINs:     HMAC-SHA256(PEPPER, salt:studentId:pin)   (fast keyed hash; see SECURITY.md).
// Session tokens:   32 random bytes; only the SHA-256 hash is stored in the database.

const enc = new TextEncoder();

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function needPepper(env) {
  if (!env.PEPPER || String(env.PEPPER).length < 24) {
    throw new Error('Server is missing the PEPPER secret (at least 24 characters).');
  }
  return String(env.PEPPER);
}

async function hmac(pepper, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function iterationsFor(env) {
  // Workers caps PBKDF2 at 100,000 iterations.
  const n = Number(env.PBKDF2_ITERATIONS) || 100000;
  return Math.min(100000, Math.max(10000, n));
}

async function derive(password, saltBytes, iterations, pepper) {
  const pre = await hmac(pepper, password);
  const key = await crypto.subtle.importKey('raw', pre, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256));
}

export async function hashPassword(password, env) {
  const pepper = needPepper(env);
  const iterations = iterationsFor(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, iterations, pepper);
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(password, stored, env) {
  const pepper = needPepper(env);
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Math.min(100000, Number(parts[1]) || 0);
  if (!iterations) return false;
  const bits = await derive(password, fromB64(parts[2]), iterations, pepper);
  return timingSafeEqual(bits, fromB64(parts[3]));
}

export async function hashPin(pin, studentId, env) {
  const pepper = needPepper(env);
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const mac = await hmac(pepper, `${salt}:${studentId}:${pin}`);
  return `hmac$${salt}$${toB64(mac)}`;
}

export async function verifyPin(pin, studentId, stored, env) {
  const pepper = needPepper(env);
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'hmac') return false;
  const mac = await hmac(pepper, `${parts[1]}:${studentId}:${pin}`);
  return timingSafeEqual(mac, fromB64(parts[2]));
}

export function randomToken(bytes = 32) {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Uniform random 6-digit PIN (100000-999999, so spreadsheets never drop a leading zero),
// using rejection sampling to avoid modulo bias.
export function randomPin() {
  const span = 900000;
  const max = Math.floor(0x100000000 / span) * span;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= max);
  return String(100000 + (buf[0] % span));
}

export async function constantTimeStringEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  return timingSafeEqual(enc.encode(ha), enc.encode(hb));
}
