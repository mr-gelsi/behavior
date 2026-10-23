import { add } from '../router.js';
import { all, one, st, batch, audit, balanceOf } from '../lib/db.js';
import { V, bad, HttpError, todayStr, schoolYearOf } from '../lib/util.js';
import { reconcileOpenDays } from '../lib/rewards.js';

const likeEsc = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

add('GET', '/api/students/search', 'staff', async ({ env, url }) => {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  if (q.length < 1) return { students: [] };
  const like = `%${likeEsc(q)}%`;
  const students = await all(env,
    `SELECT student_id, last_name, first_name, grade, homeroom_teacher FROM students
      WHERE active = 1 AND (CAST(student_id AS TEXT) LIKE ? ESCAPE '\\'
         OR last_name LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\'
         OR (first_name || ' ' || last_name) LIKE ? ESCAPE '\\'
         OR (last_name || ', ' || first_name) LIKE ? ESCAPE '\\')
      ORDER BY last_name, first_name LIMIT 15`, like, like, like, like, like);
  return { students };
});

add('GET', '/api/homerooms', 'staff', async ({ env }) => ({
  homerooms: await all(env,
    `SELECT grade, homeroom_teacher, COUNT(*) AS n FROM students
      WHERE active = 1 AND homeroom_teacher IS NOT NULL AND homeroom_teacher <> ''
      GROUP BY grade, homeroom_teacher ORDER BY grade, homeroom_teacher`),
}));

add('GET', '/api/homerooms/students', 'staff', async ({ env, url }) => {
  const grade = V.int(url.searchParams.get('grade'), 'grade', { min: 6, max: 8 });
  const hr = V.str(url.searchParams.get('homeroom'), 'homeroom', { max: 80 });
  return {
    students: await all(env,
      `SELECT student_id, last_name, first_name, grade, homeroom_teacher FROM students
        WHERE active = 1 AND grade = ? AND homeroom_teacher = ? ORDER BY last_name, first_name`, grade, hr),
  };
});

add('GET', '/api/grade/:grade', 'staff', async ({ env, params, url }) => {
  const grade = V.int(params.grade, 'grade', { min: 6, max: 8 });
  const year = url.searchParams.get('year') || schoolYearOf(todayStr(env));
  const rows = await all(env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade,
            COALESCE(SUM(CASE WHEN t.step_level = 1 THEN 1 END), 0) AS s1,
            COALESCE(SUM(CASE WHEN t.step_level = 2 THEN 1 END), 0) AS s2,
            COALESCE(SUM(CASE WHEN t.step_level = 3 THEN 1 END), 0) AS s3,
            COALESCE(SUM(CASE WHEN t.step_level = 4 THEN 1 END), 0) AS s4,
            COALESCE(SUM(CASE WHEN t.step_level = 5 THEN 1 END), 0) AS s5,
            COUNT(t.id) AS total,
            (SELECT COALESCE(SUM(amount), 0) FROM p5_transactions p WHERE p.student_id = s.student_id) AS balance
       FROM students s LEFT JOIN steps t ON t.student_id = s.student_id AND t.school_year = ?
      WHERE s.grade = ? AND s.active = 1
      GROUP BY s.student_id ORDER BY s.last_name, s.first_name`, year, grade);
  const totals = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, total: 0 };
  for (const r of rows) for (const k of Object.keys(totals)) totals[k] += r[k];
  return { year, grade, totals, students: rows };
});

add('GET', '/api/students/:id', 'staff', async ({ env, params }) => {
  const id = V.int(params.id, 'student id', { min: 1 });
  const student = await one(env, 'SELECT student_id, last_name, first_name, grade, homeroom_teacher, room, active FROM students WHERE student_id = ?', id);
  if (!student) throw new HttpError(404, 'Student not found.');
  const steps = await all(env,
    'SELECT id, step_level, step_date, teacher, period, code, notes, source, school_year FROM steps WHERE student_id = ? ORDER BY step_date DESC, id DESC', id);
  const ledger = await all(env,
    `SELECT p.id, p.type, p.amount, p.note, p.teacher, p.tx_date, p.reversed_by, c.name AS category
       FROM p5_transactions p LEFT JOIN p5_categories c ON c.id = p.category_id
      WHERE p.student_id = ? ORDER BY p.id DESC LIMIT 100`, id);
  return { student, steps, ledger, balance: await balanceOf(env, id) };
});

// ---- Steps -------------------------------------------------------------------------

const canEdit = (c, row) => {
  if (c.user.role === 'admin') return true;
  if (row.created_by !== c.user.email) return false;
  return Date.now() - Date.parse(row.created_at) < 7 * 24 * 3600 * 1000;
};

add('GET', '/api/steps/recent', 'staff', async ({ env, url }) => {
  const where = [];
  const p = [];
  const teacher = url.searchParams.get('teacher');
  const grade = url.searchParams.get('grade');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (teacher) { where.push('t.teacher = ?'); p.push(teacher); }
  if (grade) { where.push('s.grade = ?'); p.push(V.int(grade, 'grade', { min: 6, max: 8 })); }
  if (from) { where.push('t.step_date >= ?'); p.push(V.date(from, 'from')); }
  if (to) { where.push('t.step_date <= ?'); p.push(V.date(to, 'to')); }
  const rows = await all(env,
    `SELECT t.id, t.student_id, s.last_name, s.first_name, s.grade, t.step_level, t.step_date, t.teacher, t.period, t.code, t.notes,
            t.source, t.created_by, t.created_at
       FROM steps t JOIN students s ON s.student_id = t.student_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.id DESC LIMIT 50`, ...p);
  return { steps: rows };
});

add('POST', '/api/steps', 'staff', async (c) => {
  const { env, body, user } = c;
  const studentId = V.int(body.student_id, 'Student', { min: 1 });
  const level = V.int(body.step_level, 'Step level', { min: 1, max: 5 });
  const date = V.date(body.step_date || todayStr(env), 'Date');
  const teacher = V.str(body.teacher || user.name, 'Teacher', { max: 80 });
  const period = V.str(body.period, 'Period', { max: 10, optional: true });
  const notes = V.str(body.notes, 'Notes', { max: 300, optional: true });
  const code = V.str(body.code, 'Code', { max: 20, optional: true });
  const s = await one(env, 'SELECT student_id FROM students WHERE student_id = ? AND active = 1', studentId);
  if (!s) throw bad('That student was not found.');
  if (!body.force) {
    const dup = await one(env, 'SELECT id FROM steps WHERE student_id = ? AND step_level = ? AND step_date = ?', studentId, level, date);
    if (dup) throw new HttpError(409, 'This student already has this step on this date.', { duplicate: true });
  }
  await env.DB.prepare(
    `INSERT INTO steps (student_id, step_level, step_date, teacher, period, code, notes, source, created_by, school_year)
     VALUES (?,?,?,?,?,?,?, 'manual', ?, ?)`)
    .bind(studentId, level, date, teacher, period, code, notes, user.email, schoolYearOf(date)).run();
  await audit(env, c.actor, 'step.create', `student=${studentId} level=${level} date=${date}`);
  await afterStepChange(c);
  return { ok: true };
});

add('PATCH', '/api/steps/:id', 'staff', async (c) => {
  const { env, params, body } = c;
  const id = V.int(params.id, 'id', { min: 1 });
  const row = await one(env, 'SELECT * FROM steps WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Step not found.');
  if (!canEdit(c, row)) throw new HttpError(403, 'You can only edit your own steps from the past 7 days.');
  const level = V.int(body.step_level ?? row.step_level, 'Step level', { min: 1, max: 5 });
  const date = V.date(body.step_date ?? row.step_date, 'Date');
  const teacher = V.str(body.teacher ?? row.teacher, 'Teacher', { max: 80, optional: true });
  const period = V.str(body.period ?? row.period, 'Period', { max: 10, optional: true });
  const notes = V.str(body.notes ?? row.notes, 'Notes', { max: 300, optional: true });
  await env.DB.prepare('UPDATE steps SET step_level=?, step_date=?, teacher=?, period=?, notes=?, school_year=? WHERE id=?')
    .bind(level, date, teacher, period, notes, schoolYearOf(date), id).run();
  await audit(env, c.actor, 'step.update', `id=${id} student=${row.student_id}`);
  await afterStepChange(c);
  return { ok: true };
});

add('DELETE', '/api/steps/:id', 'staff', async (c) => {
  const { env, params } = c;
  const id = V.int(params.id, 'id', { min: 1 });
  const row = await one(env, 'SELECT * FROM steps WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Step not found.');
  if (!canEdit(c, row)) throw new HttpError(403, 'You can only delete your own steps from the past 7 days.');
  await batch(env, [
    st(env, 'UPDATE p5_transactions SET linked_step_id = NULL WHERE linked_step_id = ?', id),
    st(env, 'DELETE FROM steps WHERE id = ?', id),
  ]);
  await audit(env, c.actor, 'step.delete', `id=${id} student=${row.student_id} level=${row.step_level} date=${row.step_date}`);
  return { ok: true };
});

// If a new step makes a booked student a non-qualifier, move them to a non-qual room.
export async function afterStepChange(c) {
  try {
    await reconcileOpenDays(c.env, c.actor, todayStr(c.env));
  } catch (e) {
    console.error('reconcile failed:', e && e.message);
  }
}
