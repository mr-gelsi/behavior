import { add } from '../router.js';
import { all, one, run, audit, getSettings } from '../lib/db.js';
import { HttpError, V, bad, todayStr, schoolYearOf } from '../lib/util.js';
import { hashPassword, verifyPassword, verifyPin, constantTimeStringEqual } from '../lib/crypto.js';
import {
  startSession, sessionCookie, clearedCookie, endSession, endAllSessions,
  assertNotLocked, recordFailure, clearFailures,
} from '../lib/auth.js';
import { json } from '../lib/util.js';

const STAFF_HOURS = 12;
const STUDENT_HOURS = 8;
let dummyHash = null;

add('GET', '/api/setup/status', 'none', async ({ env }) => {
  const n = (await one(env, 'SELECT COUNT(*) AS c FROM users')).c;
  return { needed: n === 0 };
});

// First-run only: creates the first Admin. Needs the SETUP_TOKEN secret.
add('POST', '/api/setup', 'none', async ({ env, body, ip }) => {
  const n = (await one(env, 'SELECT COUNT(*) AS c FROM users')).c;
  if (n > 0) throw new HttpError(403, 'Setup is already complete.');
  if (!env.SETUP_TOKEN || String(env.SETUP_TOKEN).length < 16) throw new HttpError(500, 'The SETUP_TOKEN secret is not configured on the server.');
  await assertNotLocked(env, [`setup:${ip}`], [5]);
  const ok = await constantTimeStringEqual(body.token || '', env.SETUP_TOKEN);
  if (!ok) {
    await recordFailure(env, [`setup:${ip}`]);
    throw new HttpError(403, 'Setup token is incorrect.');
  }
  const email = V.str(body.email, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
  const name = V.str(body.name, 'Name', { max: 80 });
  const password = V.str(body.password, 'Password', { max: 200 });
  if (password.length < 12) throw bad('Password must be at least 12 characters.');
  const hash = await hashPassword(password, env);
  await run(env, "INSERT INTO users (email, name, role, pw_hash) VALUES (?,?, 'admin', ?)", email, name, hash);
  await audit(env, `staff:${email}`, 'setup.first_admin', '');
  return { ok: true };
});

add('POST', '/api/login', 'none', async ({ env, body, ip }) => {
  const kind = V.oneOf(body.kind, 'kind', ['staff', 'student']);
  if (kind === 'staff') {
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
    const password = String(body.password || '').slice(0, 200);
    const keys = [`staff:${email}`, `ip:${ip}`];
    await assertNotLocked(env, keys, [5, 40]);
    const user = email ? await one(env, 'SELECT id, email, name, role, pw_hash FROM users WHERE email = ? AND active = 1', email) : null;
    if (!dummyHash) dummyHash = await hashPassword('not-a-real-password', env);
    const ok = await verifyPassword(password, user ? user.pw_hash : dummyHash, env);
    if (!user || !ok) {
      await recordFailure(env, keys);
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    await clearFailures(env, keys[0]);
    const { token, maxAge } = await startSession(env, 'staff', user.id, STAFF_HOURS);
    await audit(env, `staff:${user.email}`, 'login', '');
    return json({ ok: true, type: 'staff' }, 200, { 'set-cookie': sessionCookie(token, maxAge) });
  }
  const sid = String(body.student_id || '').trim();
  const pin = String(body.pin || '').trim();
  if (!/^\d{1,9}$/.test(sid)) throw new HttpError(401, 'Student ID or PIN is incorrect.');
  const keys = [`student:${sid}`, `ip:${ip}`];
  await assertNotLocked(env, keys, [5, 150]);
  const s = await one(env, 'SELECT student_id, pin_hash FROM students WHERE student_id = ? AND active = 1', Number(sid));
  const ok = s && s.pin_hash ? await verifyPin(pin, s.student_id, s.pin_hash, env) : false;
  if (!ok) {
    await recordFailure(env, keys);
    throw new HttpError(401, 'Student ID or PIN is incorrect.');
  }
  await clearFailures(env, keys[0]);
  const { token, maxAge } = await startSession(env, 'student', s.student_id, STUDENT_HOURS);
  return json({ ok: true, type: 'student' }, 200, { 'set-cookie': sessionCookie(token, maxAge) });
});

add('POST', '/api/logout', 'any', async ({ env, session }) => {
  await endSession(env, session.hash);
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
});

add('GET', '/api/me', 'any', async ({ env, session, user, student }) => {
  const settings = await getSettings(env);
  const today = todayStr(env);
  if (student) {
    return { type: 'student', student, settings: { school_name: settings.school_name }, today };
  }
  const period = await one(env, 'SELECT id, name, start_date, end_date FROM reward_periods WHERE ? BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1', today);
  const years = new Set([schoolYearOf(today)]);
  for (const r of await all(env, 'SELECT DISTINCT school_year AS y FROM steps')) years.add(r.y);
  for (const r of await all(env, 'SELECT DISTINCT school_year AS y FROM reward_periods')) years.add(r.y);
  return {
    type: 'staff',
    user: { name: user.name, email: user.email, role: user.role },
    settings: {
      school_name: settings.school_name,
      code_label: settings.code_label,
      teacher_max_p5: settings.teacher_max_p5,
      nonqual_min_step: settings.nonqual_min_step,
      nonqual_step1_count: settings.nonqual_step1_count,
    },
    today,
    school_year: schoolYearOf(today),
    years: [...years].sort().reverse(),
    current_period: period,
  };
});

add('POST', '/api/me/password', 'staff', async ({ env, body, user, session }) => {
  const current = String(body.current || '');
  const next = V.str(body.next, 'New password', { max: 200 });
  if (next.length < 12) throw bad('New password must be at least 12 characters.');
  const row = await one(env, 'SELECT pw_hash FROM users WHERE id = ?', user.id);
  if (!(await verifyPassword(current, row.pw_hash, env))) throw new HttpError(403, 'Current password is incorrect.');
  await run(env, 'UPDATE users SET pw_hash = ? WHERE id = ?', await hashPassword(next, env), user.id);
  await endAllSessions(env, 'staff', user.id);
  await audit(env, `staff:${user.email}`, 'password.change', '');
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
});
