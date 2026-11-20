// Weekly parent letters (drafts only; nothing is ever emailed by the site).
//  - Behavior steps: run by each teacher for the steps THEY gave in a week.
//  - Restroom / water: run by Office staff or Admins, counting every trip this school year across all teachers.
import { add } from '../router.js';
import { all, one, run, audit, getSettings } from '../lib/db.js';
import { V, bad, HttpError, todayStr, schoolYearOf, isDate, lastNameOf } from '../lib/util.js';
import { addDays, dayNum } from '../lib/steps.js';
import { bandLevel } from '../lib/bands.js';

const mondayOf = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const CONTACT = 's.guardian_name, s.guardian_email, s.guardian_email2, s.no_email';
const canRestroom = (u) => u.role === 'admin' || u.classification === 'office';

async function teacherFor(c) {
  const q = c.url.searchParams.get('teacher_id');
  if (!q || Number(q) === c.user.id) return c.user;
  if (c.user.role !== 'admin') throw new HttpError(403, 'You can only run this report for your own steps.');
  const t = await one(c.env, 'SELECT id, email, name, last_name FROM users WHERE id = ? AND active = 1', V.int(q, 'teacher_id', { min: 1 }));
  if (!t) throw new HttpError(404, 'Teacher not found.');
  return t;
}

add('GET', '/api/parent-reports/steps', 'staff', async (c) => {
  const { env } = c;
  const today = todayStr(env);
  const wk = c.url.searchParams.get('week') || today;
  if (!isDate(wk)) throw bad('Dates must look like 2026-03-17.');
  const min = V.int(c.url.searchParams.get('min') || 2, 'Minimum steps', { min: 1, max: 5 });
  const teacher = await teacherFor(c);
  const full = await one(env, 'SELECT id, email, name, last_name FROM users WHERE id = ?', teacher.id);
  const start = mondayOf(wk), end = addDays(start, 6);
  const key = (full.last_name || lastNameOf(full.name)).toLowerCase();
  const rows = await all(env,
    `SELECT st.student_id, st.step_level, st.step_date, st.notes, st.teacher, st.created_by, s.last_name, s.first_name, s.grade, ${CONTACT}
       FROM steps st JOIN students s ON s.student_id = st.student_id
      WHERE s.active = 1 AND st.step_date BETWEEN ? AND ? ORDER BY st.step_date, st.id`, start, end);
  const by = new Map();
  for (const r of rows) {
    if (!(r.created_by === full.email || (key && lastNameOf(r.teacher).toLowerCase() === key))) continue;
    if (!by.has(r.student_id)) by.set(r.student_id, { student_id: r.student_id, last_name: r.last_name, first_name: r.first_name, grade: r.grade,
      guardian_name: r.guardian_name, guardian_email: r.guardian_email, guardian_email2: r.guardian_email2, no_email: r.no_email, steps: [] });
    by.get(r.student_id).steps.push({ date: r.step_date, level: r.step_level, notes: r.notes });
  }
  const sent = new Set((await all(env, 'SELECT student_id FROM parent_notices WHERE kind = ? AND scope = ?', 'steps', `steps:${full.id}:${start}`)).map((r) => r.student_id));
  const students = [...by.values()].filter((s) => s.steps.length >= min)
    .map((s) => ({ ...s, count: s.steps.length, sent: sent.has(s.student_id) }))
    .sort((a, b) => b.count - a.count || a.last_name.localeCompare(b.last_name));
  return { week_start: start, week_end: end, min, teacher: { id: full.id, name: full.name, last_name: full.last_name }, students };
});

add('GET', '/api/parent-reports/restroom', 'staff', async (c) => {
  if (!canRestroom(c.user)) throw new HttpError(403, 'The restroom report is for Office staff and Admins.');
  const { env } = c;
  const sy = schoolYearOf(todayStr(env));
  const bands = (await getSettings(env)).break_bands;
  const rows = await all(env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade, s.restroom_exempt, ${CONTACT}, COUNT(*) AS trips
       FROM break_log b JOIN students s ON s.student_id = b.student_id
      WHERE s.active = 1 AND b.school_year = ? GROUP BY s.student_id`, sy);
  const notices = await all(env, 'SELECT student_id, MAX(level) AS level, MAX(created_at) AS at FROM parent_notices WHERE kind = ? AND scope = ? GROUP BY student_id', 'restroom', `restroom:${sy}`);
  const nmap = new Map(notices.map((n) => [n.student_id, n]));
  const pending = [], done = [];
  let exempt = 0;
  for (const r of rows) {
    const level = bandLevel(r.trips, bands);
    if (level < 1) continue;
    if (r.restroom_exempt) { exempt++; continue; }
    const n = nmap.get(r.student_id);
    const item = { student_id: r.student_id, last_name: r.last_name, first_name: r.first_name, grade: r.grade, guardian_name: r.guardian_name,
      guardian_email: r.guardian_email, guardian_email2: r.guardian_email2, no_email: r.no_email, trips: r.trips, level, notified_level: n ? n.level : null, notified_at: n ? n.at : null };
    (n && n.level >= level ? done : pending).push(item);
  }
  const ord = (a, b) => b.level - a.level || b.trips - a.trips || a.last_name.localeCompare(b.last_name);
  return { school_year: sy, bands, pending: pending.sort(ord), done: done.sort(ord), exempt_count: exempt };
});

// Mark a letter as sent (or undo). Steps: one per student per teacher per week. Restroom: one per level per school year.
async function noticeTarget(c) {
  const b = c.body;
  const kind = V.oneOf(b.kind, 'Kind', ['steps', 'restroom']);
  const sid = V.int(b.student_id, 'Student', { min: 1 });
  if (!(await one(c.env, 'SELECT 1 AS x FROM students WHERE student_id = ?', sid))) throw new HttpError(404, 'Student not found.');
  if (kind === 'steps') {
    let tid = c.user.id;
    if (b.teacher_id && Number(b.teacher_id) !== c.user.id) { if (c.user.role !== 'admin') throw new HttpError(403, 'Not allowed.'); tid = V.int(b.teacher_id, 'Teacher', { min: 1 }); }
    if (!isDate(b.week)) throw bad('Week is missing.');
    return { kind, sid, scope: `steps:${tid}:${mondayOf(b.week)}`, level: 0 };
  }
  if (!canRestroom(c.user)) throw new HttpError(403, 'The restroom report is for Office staff and Admins.');
  const sy = schoolYearOf(todayStr(c.env));
  const bands = (await getSettings(c.env)).break_bands;
  const trips = (await one(c.env, 'SELECT COUNT(*) AS n FROM break_log WHERE student_id = ? AND school_year = ?', sid, sy)).n;
  const level = bandLevel(trips, bands);
  if (level < 1) throw bad('That student is not at a warning level.');
  return { kind, sid, scope: `restroom:${sy}`, level };
}
add('POST', '/api/parent-reports/sent', 'staff', async (c) => {
  const t = await noticeTarget(c);
  await run(c.env, 'INSERT OR IGNORE INTO parent_notices (kind, scope, student_id, level, sent_by) VALUES (?,?,?,?,?)', t.kind, t.scope, t.sid, t.level, c.user.id);
  await audit(c.env, c.actor, 'parent_report.sent', `${t.kind} student=${t.sid} ${t.scope} level=${t.level}`);
  return { ok: true };
});
add('POST', '/api/parent-reports/unsent', 'staff', async (c) => {
  const t = await noticeTarget(c);
  if (t.kind === 'restroom') await run(c.env, 'DELETE FROM parent_notices WHERE kind = ? AND scope = ? AND student_id = ? AND level >= ?', t.kind, t.scope, t.sid, t.level);
  else await run(c.env, 'DELETE FROM parent_notices WHERE kind = ? AND scope = ? AND student_id = ?', t.kind, t.scope, t.sid);
  await audit(c.env, c.actor, 'parent_report.unsent', `${t.kind} student=${t.sid}`);
  return { ok: true };
});
