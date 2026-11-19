// Per-person preferences. Right now: the order of the left-hand menu.
import { add } from '../router.js';
import { one, run } from '../lib/db.js';
import { bad } from '../lib/util.js';

const STAFF_PATHS = ['dashboard', 'record', 'reports', 'monthly', 'reward-report', 'p5', 'store', 'rewards', 'classes', 'breaks'];
const STUDENT_PATHS = ['me', 'shop', 'seat', 'classes'];

const allowedPaths = (session) =>
  session.type === 'student' ? STUDENT_PATHS : [...STAFF_PATHS, ...(session.user.role === 'admin' ? ['admin'] : [])];
const whoIs = (session) =>
  session.type === 'student' ? ['student', String(session.student.student_id)] : ['staff', String(session.user.id)];

export async function loadNavOrder(env, session) {
  const [type, ref] = whoIs(session);
  const row = await one(env, "SELECT value FROM user_prefs WHERE user_type = ? AND user_ref = ? AND key = 'nav_order'", type, ref);
  if (!row) return null;
  try {
    const list = JSON.parse(row.value);
    const ok = new Set(allowedPaths(session));
    return Array.isArray(list) ? list.filter((p) => ok.has(p)) : null;
  } catch {
    return null;
  }
}

add('PUT', '/api/me/nav-order', 'any', async (c) => {
  const order = c.body.order;
  if (!Array.isArray(order) || order.length > 30) throw bad('Send the menu order as a list.');
  const ok = new Set(allowedPaths(c.session));
  const clean = [];
  for (const p of order) {
    if (typeof p !== 'string') throw bad('Menu items must be text.');
    if (ok.has(p) && !clean.includes(p)) clean.push(p);
  }
  const [type, ref] = whoIs(c.session);
  await run(c.env,
    `INSERT INTO user_prefs (user_type, user_ref, key, value) VALUES (?, ?, 'nav_order', ?)
     ON CONFLICT (user_type, user_ref, key) DO UPDATE SET value = excluded.value`, type, ref, JSON.stringify(clean));
  return { ok: true, order: clean };
});

add('DELETE', '/api/me/nav-order', 'any', async (c) => {
  const [type, ref] = whoIs(c.session);
  await run(c.env, "DELETE FROM user_prefs WHERE user_type = ? AND user_ref = ? AND key = 'nav_order'", type, ref);
  return { ok: true };
});
