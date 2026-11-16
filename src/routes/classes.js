// Classes, join codes, and seating charts.
import { add } from '../router.js';
import { all, one, run, st, batch, chunked, audit } from '../lib/db.js';
import { V, bad, HttpError, todayStr, schoolYearOf } from '../lib/util.js';
import { randomCode } from '../lib/crypto.js';
import { assertNotLocked, recordFailure, clearFailures } from '../lib/auth.js';

const MAX_DESKS = 80;
const MAX_ACTIVE_CLASSES = 40;

async function newCode(env) {
  for (let i = 0; i < 12; i++) {
    const code = randomCode(6);
    if (!(await one(env, 'SELECT 1 AS x FROM classes WHERE code = ?', code))) return code;
  }
  throw new Error('Could not generate a unique class code.');
}

// A teacher can open their own classes; an Admin can open any. Others get "not found".
async function ownClass(c, idParam) {
  const id = V.int(idParam, 'class id', { min: 1 });
  const cls = await one(c.env, 'SELECT * FROM classes WHERE id = ?', id);
  if (!cls || (c.user.role !== 'admin' && cls.owner_id !== c.user.id)) throw new HttpError(404, 'Class not found.');
  return cls;
}

const publicClass = (cls, ownerName) => ({
  id: cls.id, name: cls.name, period: cls.period, school_year: cls.school_year, code: cls.code,
  join_open: !!cls.join_open, archived: !!cls.archived, grid_cols: cls.grid_cols, grid_rows: cls.grid_rows,
  owner_id: cls.owner_id, owner_name: ownerName,
});

// ---- Staff: classes ---------------------------------------------------------------------

// ?owner=me (default for everyone) | all | <teacher id>. Only Admins can look at other teachers' classes.
// Teachers always get their own, whatever they ask for. Join codes are never shown across teachers.
add('GET', '/api/classes', 'staff', async ({ env, user, url }) => {
  const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
  const admin = user.role === 'admin';
  const want = url.searchParams.get('owner') || 'me';
  let everyone = 0;
  let ownerId = user.id;
  if (admin && want === 'all') everyone = 1;
  else if (admin && /^\d+$/.test(want)) ownerId = Number(want);
  const classes = await all(env,
    `SELECT c.id, c.name, c.period, c.school_year, c.code, c.join_open, c.archived, c.owner_id,
            u.name AS owner_name, u.last_name AS owner_last_name,
            (SELECT COUNT(*) FROM class_members m JOIN students s ON s.student_id = m.student_id
              WHERE m.class_id = c.id AND s.active = 1) AS members
       FROM classes c JOIN users u ON u.id = c.owner_id
      WHERE (? = 1 OR c.owner_id = ?) AND (? = 1 OR c.archived = 0)
      ORDER BY c.archived, lower(COALESCE(u.last_name, u.name)), lower(u.name), c.school_year DESC, c.period, c.name`,
    everyone, ownerId, archived);
  const out = { classes: classes.map((x) => ({ ...x, join_open: !!x.join_open, archived: !!x.archived })) };
  if (admin) {
    out.teachers = await all(env,
      `SELECT u.id, u.name, u.last_name FROM users u
        WHERE u.active = 1 AND (u.id = ? OR EXISTS (SELECT 1 FROM classes c WHERE c.owner_id = u.id))
        ORDER BY lower(COALESCE(u.last_name, u.name)), lower(u.name)`, user.id);
  }
  return out;
});

add('POST', '/api/classes', 'staff', async (c) => {
  const name = V.str(c.body.name, 'Class name', { max: 60 });
  const period = V.str(c.body.period, 'Period', { max: 20, optional: true });
  const active = (await one(c.env, 'SELECT COUNT(*) AS n FROM classes WHERE owner_id = ? AND archived = 0', c.user.id)).n;
  if (active >= MAX_ACTIVE_CLASSES) throw bad('You have a lot of active classes. Archive some you no longer need first.');
  const code = await newCode(c.env);
  const r = await c.env.DB.prepare('INSERT INTO classes (owner_id, name, period, school_year, code) VALUES (?,?,?,?,?)')
    .bind(c.user.id, name, period, schoolYearOf(todayStr(c.env)), code).run();
  await audit(c.env, c.actor, 'class.create', `id=${r.meta.last_row_id}`);
  return { ok: true, id: r.meta.last_row_id, code };
});

add('GET', '/api/classes/:id', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const owner = await one(c.env, 'SELECT name FROM users WHERE id = ?', cls.owner_id);
  const members = await all(c.env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, m.source, m.joined_at,
            (SELECT COALESCE(SUM(amount), 0) FROM p5_transactions p WHERE p.student_id = s.student_id) AS balance
       FROM class_members m JOIN students s ON s.student_id = m.student_id
      WHERE m.class_id = ? AND s.active = 1 ORDER BY s.last_name, s.first_name`, cls.id);
  const desks = await all(c.env, 'SELECT id, x, y, kind, student_id FROM class_desks WHERE class_id = ? ORDER BY y, x', cls.id);
  return { class: publicClass(cls, owner && owner.name), members, desks };
});

add('PATCH', '/api/classes/:id', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const b = c.body;
  const name = V.str(b.name ?? cls.name, 'Class name', { max: 60 });
  const period = V.str(b.period === undefined ? cls.period : b.period, 'Period', { max: 20, optional: true });
  const joinOpen = (b.join_open ?? cls.join_open) ? 1 : 0;
  const archived = (b.archived ?? cls.archived) ? 1 : 0;
  await run(c.env, 'UPDATE classes SET name = ?, period = ?, join_open = ?, archived = ? WHERE id = ?', name, period, joinOpen, archived, cls.id);
  await audit(c.env, c.actor, 'class.update', `id=${cls.id} join_open=${joinOpen} archived=${archived}`);
  return { ok: true };
});

add('POST', '/api/classes/:id/regenerate-code', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const code = await newCode(c.env);
  await run(c.env, 'UPDATE classes SET code = ? WHERE id = ?', code, cls.id);
  await audit(c.env, c.actor, 'class.new_code', `id=${cls.id}`);
  return { ok: true, code };
});

// ---- Staff: members ---------------------------------------------------------------------

add('POST', '/api/classes/:id/members', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  if (!Array.isArray(c.body.student_ids) || !c.body.student_ids.length) throw bad('Choose at least one student.');
  if (c.body.student_ids.length > 200) throw bad('Add 200 students or fewer at a time.');
  const ids = [...new Set(c.body.student_ids.map((x) => V.int(x, 'Student', { min: 1 })))];
  const found = await all(c.env, `SELECT student_id FROM students WHERE active = 1 AND student_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (found.length !== ids.length) throw bad('One or more students were not found.');
  const res = await chunked(c.env, ids.map((id) =>
    st(c.env, "INSERT OR IGNORE INTO class_members (class_id, student_id, source) VALUES (?, ?, 'teacher')", cls.id, id)), 40);
  const added = res.reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
  await audit(c.env, c.actor, 'class.add_members', `id=${cls.id} added=${added}`);
  return { ok: true, added };
});

add('DELETE', '/api/classes/:id/members/:sid', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const sid = V.int(c.params.sid, 'Student', { min: 1 });
  await removeMember(c.env, cls.id, sid);
  await audit(c.env, c.actor, 'class.remove_member', `id=${cls.id} student=${sid}`);
  return { ok: true };
});

async function removeMember(env, classId, studentId) {
  await batch(env, [
    st(env, 'UPDATE class_desks SET student_id = NULL WHERE class_id = ? AND student_id = ?', classId, studentId),
    st(env, 'DELETE FROM class_members WHERE class_id = ? AND student_id = ?', classId, studentId),
  ]);
}

// ---- Staff: seating layout ----------------------------------------------------------------

function validateLayout(body, memberIds) {
  const cols = V.int(body.cols, 'Columns', { min: 2, max: 16 });
  const rows = V.int(body.rows, 'Rows', { min: 2, max: 12 });
  if (!Array.isArray(body.desks)) throw bad('Layout is missing its desks.');
  if (body.desks.length > MAX_DESKS) throw bad(`A layout can have at most ${MAX_DESKS} desks.`);
  const cells = new Set();
  const seated = new Set();
  const desks = body.desks.map((d, i) => {
    const x = V.int(d.x, `Desk ${i + 1} column`, { min: 0, max: cols - 1 });
    const y = V.int(d.y, `Desk ${i + 1} row`, { min: 0, max: rows - 1 });
    const kind = V.oneOf(d.kind || 'desk', 'Desk type', ['desk', 'teacher']);
    const key = `${x},${y}`;
    if (cells.has(key)) throw bad('Two desks are in the same spot.');
    cells.add(key);
    let studentId = null;
    if (d.student_id !== null && d.student_id !== undefined) {
      if (kind === 'teacher') throw bad('A teacher desk can\u2019t have a student.');
      studentId = V.int(d.student_id, 'Student', { min: 1 });
      if (!memberIds.has(studentId)) throw bad('Only students in this class can be seated.');
      if (seated.has(studentId)) throw bad('A student can only have one desk.');
      seated.add(studentId);
    }
    return { x, y, kind, student_id: studentId };
  });
  return { cols, rows, desks };
}

// Replace the whole layout in one atomic batch.
async function saveLayout(env, classId, layout) {
  const stmts = [
    st(env, 'DELETE FROM class_desks WHERE class_id = ?', classId),
    st(env, 'UPDATE classes SET grid_cols = ?, grid_rows = ? WHERE id = ?', layout.cols, layout.rows, classId),
    ...layout.desks.map((d) => st(env, 'INSERT INTO class_desks (class_id, x, y, kind, student_id) VALUES (?,?,?,?,?)',
      classId, d.x, d.y, d.kind, d.student_id)),
  ];
  await batch(env, stmts);
}

const memberSet = async (env, classId) =>
  new Set((await all(env,
    'SELECT m.student_id FROM class_members m JOIN students s ON s.student_id = m.student_id WHERE m.class_id = ? AND s.active = 1', classId))
    .map((r) => r.student_id));

add('PUT', '/api/classes/:id/layout', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const layout = validateLayout(c.body, await memberSet(c.env, cls.id));
  await saveLayout(c.env, cls.id, layout);
  await audit(c.env, c.actor, 'class.save_layout', `id=${cls.id} desks=${layout.desks.length}`);
  return { ok: true, desks: layout.desks.length };
});

add('POST', '/api/classes/:id/copy-layout', 'staff', async (c) => {
  const dest = await ownClass(c, c.params.id);
  const src = await ownClass(c, c.body.from_class_id);
  if (src.id === dest.id) throw bad('Choose a different class to copy from.');
  const withStudents = !!c.body.with_students;
  const srcDesks = await all(c.env, 'SELECT x, y, kind, student_id FROM class_desks WHERE class_id = ? ORDER BY y, x', src.id);
  if (!srcDesks.length) throw bad('That class doesn\u2019t have a seating layout to copy yet.');
  const members = await memberSet(c.env, dest.id);
  let seated = 0, skipped = 0;
  const desks = srcDesks.map((d) => {
    let sid = null;
    if (withStudents && d.kind === 'desk' && d.student_id) {
      if (members.has(d.student_id)) { sid = d.student_id; seated++; } else skipped++;
    }
    return { x: d.x, y: d.y, kind: d.kind, student_id: sid };
  });
  await saveLayout(c.env, dest.id, { cols: src.grid_cols, rows: src.grid_rows, desks });
  await audit(c.env, c.actor, 'class.copy_layout', `from=${src.id} to=${dest.id} desks=${desks.length} seated=${seated}`);
  return { ok: true, desks: desks.length, seated, skipped };
});

// ---- Staff: which rewards a class offers ---------------------------------------------------
// Until a teacher chooses, a class uses the default: every school reward.

async function offerableItems(env, cls) {
  const rows = await all(env,
    `SELECT id, name, description, emoji, price, stock, max_per_student, owner_id FROM store_items
      WHERE active = 1 AND (owner_id IS NULL OR owner_id = ?) ORDER BY owner_id IS NOT NULL, price, name`, cls.owner_id);
  return rows.map((i) => ({ ...i, scope: i.owner_id === null ? 'school' : 'custom' }));
}

add('GET', '/api/classes/:id/rewards', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const items = await offerableItems(c.env, cls);
  const selected = (await all(c.env, 'SELECT item_id FROM class_rewards WHERE class_id = ?', cls.id)).map((r) => r.item_id);
  return { configured: !!cls.rewards_configured, selected, items };
});

add('PUT', '/api/classes/:id/rewards', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  if (!Array.isArray(c.body.item_ids)) throw bad('Choose which rewards to offer.');
  if (c.body.item_ids.length > 300) throw bad('That is too many rewards.');
  const ids = [...new Set(c.body.item_ids.map((x) => V.int(x, 'Reward', { min: 1 })))];
  const allowed = new Set((await offerableItems(c.env, cls)).map((i) => i.id));
  if (ids.some((i) => !allowed.has(i))) throw bad('One of those rewards isn\u2019t available to this class.');
  await chunked(c.env, [
    st(c.env, 'DELETE FROM class_rewards WHERE class_id = ?', cls.id),
    st(c.env, 'UPDATE classes SET rewards_configured = 1 WHERE id = ?', cls.id),
    ...ids.map((i) => st(c.env, 'INSERT INTO class_rewards (class_id, item_id) VALUES (?, ?)', cls.id, i)),
  ], 60);
  await audit(c.env, c.actor, 'class.set_rewards', `id=${cls.id} rewards=${ids.length}`);
  return { ok: true, selected: ids.length };
});

add('DELETE', '/api/classes/:id/rewards', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  await batch(c.env, [
    st(c.env, 'DELETE FROM class_rewards WHERE class_id = ?', cls.id),
    st(c.env, 'UPDATE classes SET rewards_configured = 0 WHERE id = ?', cls.id),
  ]);
  await audit(c.env, c.actor, 'class.reset_rewards', `id=${cls.id}`);
  return { ok: true };
});

// ---- Students: join with a code -------------------------------------------------------------

add('POST', '/api/student/classes/join', 'student', async (c) => {
  const { env, student } = c;
  const key = `join:${student.student_id}`;
  await assertNotLocked(env, [key], [10], 'Too many wrong class codes. Wait 15 minutes and try again, or ask your teacher.');
  const code = String(c.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fail = async () => {
    await recordFailure(env, [key]);
    throw bad('That code didn\u2019t work. Check it with your teacher and try again.');
  };
  if (code.length !== 6) return fail();
  const cls = await one(env,
    `SELECT c.id, c.name, c.period, c.join_open, c.archived, u.name AS teacher
       FROM classes c JOIN users u ON u.id = c.owner_id WHERE c.code = ?`, code);
  if (!cls || cls.archived || !cls.join_open) return fail();
  const r = await run(env, "INSERT OR IGNORE INTO class_members (class_id, student_id, source) VALUES (?, ?, 'code')", cls.id, student.student_id);
  await clearFailures(env, key);
  await audit(env, c.actor, 'class.join', `class=${cls.id}`);
  return { ok: true, already: !(r.meta && r.meta.changes), class: { id: cls.id, name: cls.name, period: cls.period, teacher: cls.teacher } };
});

add('GET', '/api/student/classes', 'student', async ({ env, student }) => ({
  classes: await all(env,
    `SELECT c.id, c.name, c.period, u.name AS teacher
       FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users u ON u.id = c.owner_id
      WHERE m.student_id = ? AND c.archived = 0 ORDER BY c.period, c.name`, student.student_id),
}));

// A student can only act on a class they have joined. Anything else looks like "not found".
add('DELETE', '/api/student/classes/:id', 'student', async (c) => {
  const id = V.int(c.params.id, 'class', { min: 1 });
  const joined = await one(c.env, 'SELECT 1 AS x FROM class_members WHERE class_id = ? AND student_id = ?', id, c.student.student_id);
  if (!joined) throw new HttpError(404, 'Class not found.');
  await removeMember(c.env, id, c.student.student_id);
  await audit(c.env, c.actor, 'class.leave', `class=${id}`);
  return { ok: true };
});
