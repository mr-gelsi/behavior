// Charger and computer check-out log.
// A student picks what they need and a teacher types their 4-digit PIN to certify it; the server stamps the time.
// The student returns it by typing their own student number (or a teacher marks it returned).
import { add } from '../router.js';
import { all, one, run, audit } from '../lib/db.js';
import { V, bad, todayStr, schoolYearOf, HttpError, isDate, lastNameOf } from '../lib/util.js';
import { hashTeacherPin } from '../lib/crypto.js';
import { assertNotLocked, recordFailure, clearFailures } from '../lib/auth.js';

const ITEMS = ['charger', 'computer'];

const openItems = (env, studentId) =>
  all(env, "SELECT id, item, checked_out_at FROM equipment_log WHERE student_id = ? AND status = 'out' ORDER BY id", studentId);

add('GET', '/api/student/equipment', 'student', async ({ env, student }) => ({
  out: await openItems(env, student.student_id),
  history: await all(env,
    `SELECT e.id, e.item, e.log_date, e.checked_out_at, e.returned_at, e.status, COALESCE(u.last_name, u.name) AS teacher
       FROM equipment_log e LEFT JOIN users u ON u.id = e.released_by
      WHERE e.student_id = ? ORDER BY e.id DESC LIMIT 30`, student.student_id),
}));

add('POST', '/api/student/equipment/checkout', 'student', async ({ env, student, body, ip, actor }) => {
  const item = V.oneOf(body.item, 'Item', ITEMS);
  const pin = String(body.pin || '').trim();
  if ((await openItems(env, student.student_id)).some((o) => o.item === item)) throw bad(`You already have a ${item} checked out. Return it first.`);
  const keys = [`equippin:student:${student.student_id}`, `equippin:ip:${ip}`];
  await assertNotLocked(env, keys, [5, 40], 'Too many wrong teacher PINs. Ask your teacher for help, then try again in 15 minutes.');
  const hash = /^\d{4}$/.test(pin) ? await hashTeacherPin(pin, env) : null;
  const t = hash
    ? await one(env, 'SELECT u.id, u.name, u.last_name FROM teacher_pins p JOIN users u ON u.id = p.user_id WHERE p.pin_hash = ? AND u.active = 1', hash)
    : null;
  if (!t) {
    await recordFailure(env, keys);
    await audit(env, actor, 'equipment.bad_pin', `item=${item}`);
    throw new HttpError(403, 'That teacher PIN is not correct.');
  }
  await clearFailures(env, keys[0]);
  const now = new Date();
  const day = todayStr(env, now);
  try {
    await run(env,
      'INSERT INTO equipment_log (student_id, item, log_date, checked_out_at, released_by, school_year) VALUES (?,?,?,?,?,?)',
      student.student_id, item, day, now.toISOString(), t.id, schoolYearOf(day));
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw bad(`You already have a ${item} checked out.`);
    throw e;
  }
  await audit(env, actor, 'equipment.checkout', `item=${item} teacher=${t.id}`);
  return { ok: true, approved_by: t.last_name || lastNameOf(t.name), out: await openItems(env, student.student_id) };
});

add('POST', '/api/student/equipment/return', 'student', async ({ env, student, body, actor }) => {
  const item = V.oneOf(body.item, 'Item', ITEMS);
  if (String(body.student_number || '').trim() !== String(student.student_id)) throw bad('That is not your student number. Check it and try again.');
  const r = await run(env,
    "UPDATE equipment_log SET returned_at = ?, status = 'returned', return_method = 'student' WHERE student_id = ? AND item = ? AND status = 'out'",
    new Date().toISOString(), student.student_id, item);
  if (!r.meta.changes) throw bad(`You do not have a ${item} checked out.`);
  await audit(env, actor, 'equipment.return', `item=${item}`);
  return { ok: true, out: await openItems(env, student.student_id) };
});

// ---- Staff report ---------------------------------------------------------------------
add('GET', '/api/equipment/report', 'staff', async ({ env, url }) => {
  const today = todayStr(env);
  const q = url.searchParams;
  const to = q.get('to') || today;
  const from = q.get('from') || `${schoolYearOf(today).slice(0, 4)}-08-01`;
  if (!isDate(from) || !isDate(to)) throw bad('Dates must look like 2026-03-17.');
  if (to < from) throw bad('The end date is before the start date.');
  const where = ['e.log_date BETWEEN ? AND ?'];
  const args = [from, to];
  if (q.get('grade')) { where.push('s.grade = ?'); args.push(V.int(q.get('grade'), 'Grade', { min: 6, max: 8 })); }
  if (q.get('item')) { where.push('e.item = ?'); args.push(V.oneOf(q.get('item'), 'Item', ITEMS)); }
  const W = where.join(' AND ');
  const totals = await one(env,
    `SELECT COUNT(*) AS total, COALESCE(SUM(e.item = 'charger'), 0) AS chargers, COALESCE(SUM(e.item = 'computer'), 0) AS computers,
            COUNT(DISTINCT e.student_id) AS students
       FROM equipment_log e JOIN students s ON s.student_id = e.student_id WHERE ${W}`, ...args);
  const students = await all(env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade, COUNT(*) AS total,
            SUM(e.item = 'charger') AS chargers, SUM(e.item = 'computer') AS computers, MAX(e.checked_out_at) AS last_at
       FROM equipment_log e JOIN students s ON s.student_id = e.student_id WHERE ${W}
      GROUP BY s.student_id ORDER BY total DESC, s.last_name, s.first_name LIMIT 1000`, ...args);
  const log = await all(env,
    `SELECT e.id, e.student_id, s.last_name, s.first_name, s.grade, e.item, e.log_date, e.checked_out_at, e.returned_at, e.status,
            e.return_method, u.name AS released_by
       FROM equipment_log e JOIN students s ON s.student_id = e.student_id LEFT JOIN users u ON u.id = e.released_by
      WHERE ${W} ORDER BY e.id DESC LIMIT 2000`, ...args);
  const out_now = await all(env,
    `SELECT e.id, e.student_id, s.last_name, s.first_name, s.grade, e.item, e.log_date, e.checked_out_at, u.name AS released_by
       FROM equipment_log e JOIN students s ON s.student_id = e.student_id LEFT JOIN users u ON u.id = e.released_by
      WHERE e.status = 'out' ORDER BY e.checked_out_at`);
  return { from, to, totals, students, log, out_now };
});

add('POST', '/api/equipment/:id/return', 'staff', async ({ env, params, actor }) => {
  const id = V.int(params.id, 'id', { min: 1 });
  const r = await run(env,
    "UPDATE equipment_log SET returned_at = ?, status = 'returned', return_method = 'staff' WHERE id = ? AND status = 'out'",
    new Date().toISOString(), id);
  if (!r.meta.changes) throw bad('That item is not checked out.');
  await audit(env, actor, 'equipment.staff_return', `id=${id}`);
  return { ok: true };
});
