// Restroom / water breaks.
// A student picks a reason and a teacher types their 4-digit PIN; the server stamps the time they leave.
// The student stops the timer by entering their own student number; the server stamps the time they return.
// All times come from the server clock, never from the browser.
import { add } from '../router.js';
import { all, one, run, audit } from '../lib/db.js';
import { V, bad, todayStr, schoolYearOf, HttpError, isDate, lastNameOf } from '../lib/util.js';
import { hashTeacherPin } from '../lib/crypto.js';
import { assertNotLocked, recordFailure, clearFailures } from '../lib/auth.js';

const REASONS = ['restroom', 'water'];
const DUR = "CAST(ROUND((julianday(returned_at) - julianday(left_at)) * 86400) AS INTEGER)";


const activeBreak = (env, studentId) =>
  one(env, "SELECT id, reason, left_at FROM break_log WHERE student_id = ? AND status = 'out'", studentId);

// ---- Student side ------------------------------------------------------------------
add('GET', '/api/student/break', 'student', async ({ env, student }) => ({
  active: await activeBreak(env, student.student_id),
  server_now: new Date().toISOString(),
}));

add('POST', '/api/student/break/start', 'student', async ({ env, student, body, ip, actor }) => {
  const reason = V.oneOf(body.reason, 'Reason', REASONS);
  const pin = String(body.pin || '').trim();
  if (await activeBreak(env, student.student_id)) throw bad('You are already out. Open the timer and enter your student number when you are back.');
  const keys = [`breakpin:student:${student.student_id}`, `breakpin:ip:${ip}`];
  await assertNotLocked(env, keys, [5, 40], 'Too many wrong teacher PINs. Ask your teacher for help, then try again in 15 minutes.');
  const hash = /^\d{4}$/.test(pin) ? await hashTeacherPin(pin, env) : null;
  const t = hash
    ? await one(env, 'SELECT u.id, u.name FROM teacher_pins p JOIN users u ON u.id = p.user_id WHERE p.pin_hash = ? AND u.active = 1', hash)
    : null;
  if (!t) {
    await recordFailure(env, keys);
    await audit(env, actor, 'break.bad_pin', `reason=${reason}`);
    throw new HttpError(403, 'That teacher PIN is not correct.');
  }
  await clearFailures(env, keys[0]);
  const now = new Date();
  try {
    await run(env,
      'INSERT INTO break_log (student_id, reason, break_date, left_at, released_by, school_year) VALUES (?,?,?,?,?,?)',
      student.student_id, reason, todayStr(env, now), now.toISOString(), t.id, schoolYearOf(todayStr(env, now)));
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw bad('You are already out.');
    throw e;
  }
  await audit(env, actor, 'break.start', `reason=${reason} teacher=${t.id}`);
  return { ok: true, active: await activeBreak(env, student.student_id), server_now: new Date().toISOString(), released_by: lastNameOf(t.name) };
});

add('POST', '/api/student/break/return', 'student', async ({ env, student, body, actor }) => {
  const typed = String(body.student_number || '').trim();
  if (typed !== String(student.student_id)) throw bad('That is not your student number. Check it and try again.');
  const now = new Date().toISOString();
  const r = await run(env,
    "UPDATE break_log SET returned_at = ?, status = 'returned', return_method = 'student' WHERE student_id = ? AND status = 'out'",
    now, student.student_id);
  if (!r.meta.changes) throw bad('You are not marked as out right now.');
  const last = await one(env, `SELECT reason, left_at, returned_at, ${DUR} AS seconds FROM break_log WHERE student_id = ? ORDER BY id DESC LIMIT 1`, student.student_id);
  await audit(env, actor, 'break.return', `seconds=${last.seconds}`);
  return { ok: true, last };
});

// ---- Teacher PINs ------------------------------------------------------------------
add('GET', '/api/breaks/pin', 'staff', async ({ env, user }) => {
  const r = await one(env, 'SELECT updated_at FROM teacher_pins WHERE user_id = ?', user.id);
  return { has_pin: !!r, updated_at: r ? r.updated_at : null };
});

add('PUT', '/api/breaks/pin', 'staff', async ({ env, user, body, actor }) => {
  const pin = String(body.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) throw bad('Your PIN must be exactly 4 digits.');
  const hash = await hashTeacherPin(pin, env);
  const clash = await one(env, 'SELECT user_id FROM teacher_pins WHERE pin_hash = ? AND user_id <> ?', hash, user.id);
  if (clash) throw new HttpError(409, 'Another teacher already uses that PIN. Pick a different 4 digits.');
  await run(env,
    `INSERT INTO teacher_pins (user_id, pin_hash, updated_at) VALUES (?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`,
    user.id, hash, new Date().toISOString());
  await audit(env, actor, 'break.pin_set', '');
  return { ok: true };
});

add('DELETE', '/api/breaks/pin', 'staff', async ({ env, user, actor }) => {
  await run(env, 'DELETE FROM teacher_pins WHERE user_id = ?', user.id);
  await audit(env, actor, 'break.pin_clear', '');
  return { ok: true };
});

add('GET', '/api/breaks/pins', 'admin', async ({ env }) => ({
  teachers: await all(env,
    `SELECT u.id, u.name, u.last_name, (p.user_id IS NOT NULL) AS has_pin, p.updated_at
       FROM users u LEFT JOIN teacher_pins p ON p.user_id = u.id WHERE u.active = 1 ORDER BY u.last_name, u.name`),
}));

add('DELETE', '/api/breaks/pins/:id', 'admin', async ({ env, params, actor }) => {
  const id = V.int(params.id, 'teacher', { min: 1 });
  await run(env, 'DELETE FROM teacher_pins WHERE user_id = ?', id);
  await audit(env, actor, 'break.pin_reset', `user=${id}`);
  return { ok: true };
});

// ---- Report ------------------------------------------------------------------------
add('GET', '/api/breaks/report', 'staff', async ({ env, url }) => {
  const today = todayStr(env);
  const q = url.searchParams;
  const to = q.get('to') || today;
  const from = q.get('from') || `${schoolYearOf(today).slice(0, 4)}-08-01`;
  if (!isDate(from) || !isDate(to)) throw bad('Dates must look like 2026-03-17.');
  if (to < from) throw bad('The end date is before the start date.');
  const where = ['b.break_date BETWEEN ? AND ?'];
  const args = [from, to];
  const grade = q.get('grade');
  if (grade) { where.push('s.grade = ?'); args.push(V.int(grade, 'Grade', { min: 6, max: 8 })); }
  const reason = q.get('reason');
  if (reason) { where.push('b.reason = ?'); args.push(V.oneOf(reason, 'Reason', REASONS)); }
  const W = where.join(' AND ');
  const totals = await one(env,
    `SELECT COUNT(*) AS breaks, COALESCE(SUM(b.reason = 'restroom'), 0) AS restroom, COALESCE(SUM(b.reason = 'water'), 0) AS water,
            COUNT(DISTINCT b.student_id) AS students,
            COALESCE(SUM(CASE WHEN b.status = 'returned' THEN ${DUR.replace(/returned_at/g, 'b.returned_at').replace(/left_at/g, 'b.left_at')} END), 0) AS seconds,
            COUNT(CASE WHEN b.status = 'returned' THEN 1 END) AS finished
       FROM break_log b JOIN students s ON s.student_id = b.student_id WHERE ${W}`, ...args);
  const dur = DUR.replace(/returned_at/g, 'b.returned_at').replace(/left_at/g, 'b.left_at');
  const students = await all(env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade, COUNT(*) AS breaks,
            SUM(b.reason = 'restroom') AS restroom, SUM(b.reason = 'water') AS water,
            COALESCE(SUM(CASE WHEN b.status = 'returned' THEN ${dur} END), 0) AS seconds,
            COUNT(CASE WHEN b.status = 'returned' THEN 1 END) AS finished, MAX(b.left_at) AS last_left
       FROM break_log b JOIN students s ON s.student_id = b.student_id WHERE ${W}
      GROUP BY s.student_id ORDER BY breaks DESC, seconds DESC, s.last_name, s.first_name LIMIT 1000`, ...args);
  const log = await all(env,
    `SELECT b.id, b.student_id, s.last_name, s.first_name, s.grade, b.reason, b.break_date, b.left_at, b.returned_at, b.status, b.return_method,
            CASE WHEN b.status = 'returned' THEN ${dur} END AS seconds, u.name AS released_by
       FROM break_log b JOIN students s ON s.student_id = b.student_id LEFT JOIN users u ON u.id = b.released_by
      WHERE ${W} ORDER BY b.id DESC LIMIT 2000`, ...args);
  const out_now = await all(env,
    `SELECT b.id, b.student_id, s.last_name, s.first_name, s.grade, b.reason, b.left_at, u.name AS released_by
       FROM break_log b JOIN students s ON s.student_id = b.student_id LEFT JOIN users u ON u.id = b.released_by
      WHERE b.status = 'out' ORDER BY b.left_at`);
  return { from, to, totals, students, log, out_now, server_now: new Date().toISOString() };
});

add('POST', '/api/breaks/:id/return', 'staff', async ({ env, params, actor }) => {
  const id = V.int(params.id, 'break', { min: 1 });
  const r = await run(env, "UPDATE break_log SET returned_at = ?, status = 'returned', return_method = 'staff' WHERE id = ? AND status = 'out'", new Date().toISOString(), id);
  if (!r.meta.changes) throw bad('That student is not marked as out.');
  await audit(env, actor, 'break.staff_return', `id=${id}`);
  return { ok: true };
});
