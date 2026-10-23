import { add } from '../router.js';
import { all, one, run, st, batch, chunked, audit, getSettings } from '../lib/db.js';
import { V, bad, HttpError, isDate, schoolYearOf, toCsv, json } from '../lib/util.js';
import { hashPassword, hashPin, randomPin } from '../lib/crypto.js';
import { endAllSessions, clearFailures } from '../lib/auth.js';

// ---- Reward periods ------------------------------------------------------------------

add('GET', '/api/reward-periods', 'staff', async ({ env, url }) => {
  const year = url.searchParams.get('year');
  return {
    periods: year
      ? await all(env, 'SELECT * FROM reward_periods WHERE school_year = ? ORDER BY start_date, id', year)
      : await all(env, 'SELECT * FROM reward_periods ORDER BY school_year DESC, start_date, id'),
  };
});

function periodFields(body, cur = {}) {
  const start = V.date(body.start_date ?? cur.start_date, 'Start date');
  const end = V.date(body.end_date ?? cur.end_date, 'End date');
  if (end < start) throw bad('End date must be on or after the start date.');
  return { name: V.str(body.name ?? cur.name, 'Name', { max: 40 }), start, end, year: schoolYearOf(start) };
}
add('POST', '/api/reward-periods', 'admin', async (c) => {
  const f = periodFields(c.body);
  try {
    await run(c.env, 'INSERT INTO reward_periods (school_year, name, start_date, end_date) VALUES (?,?,?,?)', f.year, f.name, f.start, f.end);
  } catch {
    throw bad('A period with that name already exists for that school year.');
  }
  await audit(c.env, c.actor, 'period.create', `${f.year} ${f.name}`);
  return { ok: true };
});
add('PATCH', '/api/reward-periods/:id', 'admin', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const cur = await one(c.env, 'SELECT * FROM reward_periods WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Period not found.');
  const f = periodFields(c.body, cur);
  try {
    await run(c.env, 'UPDATE reward_periods SET school_year=?, name=?, start_date=?, end_date=? WHERE id=?', f.year, f.name, f.start, f.end, id);
  } catch {
    throw bad('A period with that name already exists for that school year.');
  }
  await audit(c.env, c.actor, 'period.update', `id=${id}`);
  return { ok: true };
});
add('DELETE', '/api/reward-periods/:id', 'admin', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  if (await one(c.env, 'SELECT 1 AS x FROM reward_days WHERE reward_period_id = ?', id)) throw bad('A Rewards Day uses this period, so it can\u2019t be deleted.');
  await run(c.env, 'DELETE FROM reward_periods WHERE id = ?', id);
  await audit(c.env, c.actor, 'period.delete', `id=${id}`);
  return { ok: true };
});

// ---- Settings -------------------------------------------------------------------------

add('GET', '/api/admin/settings', 'admin', async ({ env }) => ({ settings: await getSettings(env) }));
add('PUT', '/api/admin/settings', 'admin', async (c) => {
  const b = c.body;
  const next = {
    school_name: V.str(b.school_name, 'School name', { max: 80 }),
    nonqual_min_step: String(V.int(b.nonqual_min_step, 'Step level that disqualifies', { min: 1, max: 5 })),
    nonqual_step1_count: String(V.int(b.nonqual_step1_count, 'Number of Step 1s that disqualify', { min: 2, max: 20 })),
    teacher_max_p5: String(V.int(b.teacher_max_p5, 'Teacher maximum per transaction', { min: 1, max: 1000 })),
    allow_negative_balance: b.allow_negative_balance ? '1' : '0',
    code_label: V.str(b.code_label, 'Label for the Code field', { max: 30 }),
  };
  await batch(c.env, Object.entries(next).map(([k, v]) =>
    st(c.env, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v)));
  await audit(c.env, c.actor, 'settings.update', Object.keys(next).join(','));
  return { ok: true };
});

// ---- Staff users ------------------------------------------------------------------------

add('GET', '/api/admin/users', 'admin', async ({ env }) => ({
  users: await all(env, 'SELECT id, email, name, role, active, created_at FROM users ORDER BY active DESC, name'),
}));
add('POST', '/api/admin/users', 'admin', async (c) => {
  const email = V.str(c.body.email, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
  const name = V.str(c.body.name, 'Name', { max: 80 });
  const role = V.oneOf(c.body.role, 'Role', ['admin', 'teacher']);
  const password = V.str(c.body.password, 'Password', { max: 200 });
  if (password.length < 12) throw bad('Password must be at least 12 characters.');
  if (await one(c.env, 'SELECT 1 AS x FROM users WHERE email = ?', email)) throw bad('A user with that email already exists.');
  await run(c.env, 'INSERT INTO users (email, name, role, pw_hash) VALUES (?,?,?,?)', email, name, role, await hashPassword(password, c.env));
  await audit(c.env, c.actor, 'user.create', `${email} ${role}`);
  return { ok: true };
});
add('PATCH', '/api/admin/users/:id', 'admin', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const u = await one(c.env, 'SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'User not found.');
  const name = V.str(c.body.name ?? u.name, 'Name', { max: 80 });
  const role = V.oneOf(c.body.role ?? u.role, 'Role', ['admin', 'teacher']);
  const active = (c.body.active ?? u.active) ? 1 : 0;
  if ((u.role === 'admin' && (role !== 'admin' || !active)) ) {
    const others = (await one(c.env, "SELECT COUNT(*) AS c FROM users WHERE role='admin' AND active=1 AND id <> ?", id)).c;
    if (!others) throw bad('There must be at least one active Admin.');
  }
  let hash = u.pw_hash;
  if (c.body.password) {
    const pw = V.str(c.body.password, 'Password', { max: 200 });
    if (pw.length < 12) throw bad('Password must be at least 12 characters.');
    hash = await hashPassword(pw, c.env);
  }
  await run(c.env, 'UPDATE users SET name=?, role=?, active=?, pw_hash=? WHERE id=?', name, role, active, hash, id);
  if (!active || c.body.password || role !== u.role) {
    await endAllSessions(c.env, 'staff', id);
    await clearFailures(c.env, `staff:${u.email}`);
  }
  await audit(c.env, c.actor, 'user.update', `id=${id}`);
  return { ok: true };
});

// ---- Students: roster import, edit, PINs ---------------------------------------------------

add('GET', '/api/admin/students', 'admin', async ({ env, url }) => {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40).replace(/[\\%_]/g, (m) => '\\' + m);
  const like = `%${q}%`;
  const inactive = url.searchParams.get('inactive') === '1';
  return {
    students: await all(env,
      `SELECT student_id, last_name, first_name, grade, homeroom_teacher, room, active, (pin_hash IS NOT NULL) AS has_pin
         FROM students WHERE (? = 1 OR active = 1) AND (? = '%%' OR CAST(student_id AS TEXT) LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\')
        ORDER BY last_name, first_name LIMIT 200`, inactive ? 1 : 0, like, like, like, like),
    counts: await all(env, 'SELECT grade, COUNT(*) AS n, SUM(pin_hash IS NOT NULL) AS with_pin FROM students WHERE active = 1 GROUP BY grade ORDER BY grade'),
  };
});

add('PATCH', '/api/admin/students/:id', 'admin', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const s = await one(c.env, 'SELECT * FROM students WHERE student_id = ?', id);
  if (!s) throw new HttpError(404, 'Student not found.');
  const b = c.body;
  await run(c.env, 'UPDATE students SET last_name=?, first_name=?, grade=?, homeroom_teacher=?, room=?, active=? WHERE student_id=?',
    V.str(b.last_name ?? s.last_name, 'Last name', { max: 60 }),
    V.str(b.first_name ?? s.first_name, 'First name', { max: 60 }),
    V.int(b.grade ?? s.grade, 'Grade', { min: 6, max: 8 }),
    V.str(b.homeroom_teacher === undefined ? s.homeroom_teacher : b.homeroom_teacher, 'Homeroom teacher', { max: 80, optional: true }),
    V.str(b.room === undefined ? s.room : b.room, 'Room', { max: 20, optional: true }),
    (b.active ?? s.active) ? 1 : 0, id);
  if (b.active === false || b.active === 0) await endAllSessions(c.env, 'student', id);
  await audit(c.env, c.actor, 'student.update', `id=${id}`);
  return { ok: true };
});

function normRosterRow(r, i) {
  try {
    return {
      ok: true,
      row: {
        student_id: V.int(r.student_id, 'Student ID', { min: 1, max: 999999999 }),
        last_name: V.str(r.last_name, 'Last name', { max: 60 }),
        first_name: V.str(r.first_name, 'First name', { max: 60 }),
        grade: V.int(r.grade, 'Grade', { min: 6, max: 8 }),
        homeroom_teacher: V.str(r.homeroom_teacher, 'Homeroom teacher', { max: 80, optional: true }),
        room: V.str(r.room, 'Room', { max: 20, optional: true }),
      },
    };
  } catch (e) {
    return { ok: false, error: { row: i + 1, message: e.message } };
  }
}

add('POST', '/api/admin/students/import', 'admin', async (c) => {
  const { env, body } = c;
  if (!Array.isArray(body.rows) || !body.rows.length) throw bad('No rows to import.');
  if (body.rows.length > 3000) throw bad('Import 3,000 rows or fewer at a time.');
  const seen = new Set();
  const good = [];
  const errors = [];
  let duplicates = 0;
  body.rows.forEach((r, i) => {
    const n = normRosterRow(r, i);
    if (!n.ok) return errors.push(n.error);
    if (seen.has(n.row.student_id)) return duplicates++;
    seen.add(n.row.student_id);
    good.push(n.row);
  });
  const existing = new Set((await all(env, 'SELECT student_id FROM students')).map((r) => r.student_id));
  const updated = good.filter((r) => existing.has(r.student_id)).length;
  const summary = { total: body.rows.length, new_students: good.length - updated, updated, duplicates_skipped: duplicates, errors: errors.slice(0, 50), error_count: errors.length };
  if (body.dry_run) return { dry_run: true, ...summary };
  if (errors.length) throw bad('Fix the errors in the file before importing.', { ...summary });
  const stmts = good.map((r) => st(env,
    `INSERT INTO students (student_id, last_name, first_name, grade, homeroom_teacher, room) VALUES (?,?,?,?,?,?)
     ON CONFLICT(student_id) DO UPDATE SET last_name = excluded.last_name, first_name = excluded.first_name, grade = excluded.grade,
       homeroom_teacher = COALESCE(excluded.homeroom_teacher, students.homeroom_teacher),
       room = COALESCE(excluded.room, students.room), active = 1`,
    r.student_id, r.last_name, r.first_name, r.grade, r.homeroom_teacher, r.room));
  await chunked(env, stmts, 40);
  let deactivated = 0;
  if (body.deactivate_missing) {
    const keep = new Set(good.map((r) => r.student_id));
    const drop = (await all(env, 'SELECT student_id FROM students WHERE active = 1')).filter((r) => !keep.has(r.student_id));
    await chunked(env, drop.map((r) => st(env, 'UPDATE students SET active = 0 WHERE student_id = ?', r.student_id)), 40);
    for (const r of drop) await endAllSessions(env, 'student', r.student_id);
    deactivated = drop.length;
  }
  await audit(env, c.actor, 'roster.import', `rows=${good.length} new=${summary.new_students} deactivated=${deactivated}`);
  return { ...summary, imported: good.length, deactivated };
}, { maxBytes: 3_000_000 });

// Generate PINs in pages. The plain PIN is returned ONCE and never stored.
async function makePins(env, rows) {
  const out = [];
  const stmts = [];
  for (const s of rows) {
    const pin = randomPin();
    stmts.push(st(env, 'UPDATE students SET pin_hash = ? WHERE student_id = ?', await hashPin(pin, s.student_id, env), s.student_id));
    out.push({ student_id: s.student_id, last_name: s.last_name, first_name: s.first_name, grade: s.grade, homeroom_teacher: s.homeroom_teacher, pin });
  }
  await chunked(env, stmts, 40);
  for (const s of rows) {
    await endAllSessions(env, 'student', s.student_id);
    await clearFailures(env, `student:${s.student_id}`);
  }
  return out;
}

add('POST', '/api/admin/pins', 'admin', async (c) => {
  const scope = V.oneOf(c.body.scope || 'missing', 'scope', ['missing', 'all']);
  const after = V.int(c.body.after ?? 0, 'after', { min: 0 });
  const rows = await all(c.env,
    `SELECT student_id, last_name, first_name, grade, homeroom_teacher FROM students
      WHERE active = 1 AND student_id > ? ${scope === 'missing' ? 'AND pin_hash IS NULL' : ''}
      ORDER BY student_id LIMIT 150`, after);
  const pins = await makePins(c.env, rows);
  await audit(c.env, c.actor, 'pins.generate', `scope=${scope} count=${pins.length}`);
  return { pins, next_after: rows.length ? rows[rows.length - 1].student_id : after, done: rows.length < 150 };
});

add('POST', '/api/admin/students/:id/pin', 'admin', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const s = await one(c.env, 'SELECT student_id, last_name, first_name, grade, homeroom_teacher FROM students WHERE student_id = ? AND active = 1', id);
  if (!s) throw new HttpError(404, 'Student not found.');
  const [r] = await makePins(c.env, [s]);
  await audit(c.env, c.actor, 'pin.reset', `student=${id}`);
  return { pin: r.pin, student: r };
});

// ---- Steps import (long layout; the browser converts the workbook's wide layout) ------------------

function parseTeacher(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return { teacher: null, period: null, extra: null };
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t);
  if (!m) return { teacher: t.slice(0, 80), period: null, extra: null };
  const inner = m[2].trim();
  const per = /^per(?:iod)?\.?\s*(\w+)$/i.exec(inner);
  return { teacher: (m[1].trim() || t).slice(0, 80), period: per ? per[1].slice(0, 10) : null, extra: per ? null : inner };
}

add('POST', '/api/admin/steps/import', 'admin', async (c) => {
  const { env, body } = c;
  if (!Array.isArray(body.rows) || !body.rows.length) throw bad('No rows to import.');
  if (body.rows.length > 25000) throw bad('Import 25,000 rows or fewer at a time.');
  const yearLock = body.school_year ? V.str(body.school_year, 'School year', { max: 7 }) : null;
  if (yearLock && !/^\d{4}-\d{2}$/.test(yearLock)) throw bad('School year must look like 2024-25.');
  const students = new Map((await all(env, 'SELECT student_id FROM students')).map((r) => [r.student_id, true]));
  const keys = new Set((await all(env, "SELECT student_id || '|' || step_level || '|' || step_date AS k FROM steps")).map((r) => r.k));
  const errors = [];
  const unmatched = new Map();
  const good = [];
  let duplicates = 0;
  body.rows.forEach((r, i) => {
    try {
      const sid = V.int(r.student_id, 'Student ID', { min: 1, max: 999999999 });
      const level = V.int(r.step_level, 'Step level', { min: 1, max: 5 });
      const date = V.date(r.step_date, 'Date');
      if (yearLock && schoolYearOf(date) !== yearLock) throw bad(`Date ${date} is outside school year ${yearLock}.`);
      const t = parseTeacher(r.teacher);
      const period = V.str(r.period ?? t.period, 'Period', { max: 10, optional: true });
      const code = V.str(r.code, 'Code', { max: 20, optional: true });
      let notes = V.str(r.notes, 'Notes', { max: 300, optional: true });
      if (t.extra) notes = [notes, `Teacher field: (${t.extra})`].filter(Boolean).join(' ').slice(0, 300);
      if (!students.has(sid)) {
        const grade = Number(r.grade);
        if (body.create_missing && [6, 7, 8].includes(grade)) unmatched.set(sid, { grade, created: true });
        else { unmatched.set(sid, { grade: null, created: false }); return; }
      }
      const key = `${sid}|${level}|${date}`;
      if (keys.has(key)) { duplicates++; return; }
      keys.add(key);
      good.push({ sid, level, date, teacher: t.teacher, period, code, notes });
    } catch (e) {
      errors.push({ row: i + 1, message: e.message });
    }
  });
  const unmatchedIds = [...unmatched.entries()].filter(([, v]) => !v.created).map(([k]) => k);
  const toCreate = [...unmatched.entries()].filter(([, v]) => v.created);
  const summary = {
    total: body.rows.length, importable: good.length, duplicates_skipped: duplicates,
    unmatched_count: unmatchedIds.length, unmatched_ids: unmatchedIds.slice(0, 50),
    placeholder_students: toCreate.length, errors: errors.slice(0, 50), error_count: errors.length,
  };
  if (body.dry_run) return { dry_run: true, ...summary };
  const stmts = toCreate.map(([sid, v]) => st(env,
    "INSERT OR IGNORE INTO students (student_id, last_name, first_name, grade, active) VALUES (?, 'Former student', ?, ?, 0)", sid, `#${sid}`, v.grade));
  for (const g of good) {
    stmts.push(st(env,
      `INSERT INTO steps (student_id, step_level, step_date, teacher, period, code, notes, source, created_by, school_year)
       VALUES (?,?,?,?,?,?,?, 'import', ?, ?)`, g.sid, g.level, g.date, g.teacher, g.period, g.code, g.notes, c.user.email, schoolYearOf(g.date)));
  }
  await chunked(env, stmts, 40);
  await audit(env, c.actor, 'steps.import', `imported=${good.length} duplicates=${duplicates} placeholders=${toCreate.length}`);
  return { ...summary, imported: good.length };
}, { maxBytes: 4_000_000 });

// ---- Audit log and export -------------------------------------------------------------------------

add('GET', '/api/admin/audit', 'admin', async ({ env, url }) => {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  return { entries: await all(env, 'SELECT id, ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?', limit) };
});

const EXPORTS = {
  students: ['student_id', 'last_name', 'first_name', 'grade', 'homeroom_teacher', 'room', 'active'],
  steps: ['id', 'student_id', 'step_level', 'step_date', 'teacher', 'period', 'code', 'notes', 'source', 'created_by', 'created_at', 'school_year'],
  p5_transactions: ['id', 'student_id', 'type', 'category_id', 'amount', 'note', 'teacher', 'created_by', 'created_at', 'tx_date', 'linked_step_id', 'related_id', 'reversed_by'],
  store_orders: ['id', 'student_id', 'item_id', 'price_paid', 'status', 'created_at', 'fulfilled_by', 'fulfilled_at'],
  reward_bookings: ['id', 'activity_id', 'reward_day_id', 'student_id', 'assignment', 'p5_cost_paid', 'status', 'created_at'],
  audit_log: ['id', 'ts', 'actor', 'action', 'detail'],
};
add('GET', '/api/admin/export', 'admin', async (c) => {
  const table = V.oneOf(c.url.searchParams.get('table'), 'table', Object.keys(EXPORTS));
  const cols = EXPORTS[table];
  const rows = await all(c.env, `SELECT ${cols.join(', ')} FROM ${table} ORDER BY 1`);
  await audit(c.env, c.actor, 'export', `table=${table} rows=${rows.length}`);
  return new Response(toCsv(rows, cols), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
