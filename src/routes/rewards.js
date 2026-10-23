import { add } from '../router.js';
import { all, one, run, audit, getSettings } from '../lib/db.js';
import { V, bad, HttpError, todayStr } from '../lib/util.js';
import {
  getDay, dayOverview, placeStudent, cancelStudentBooking, autoAssign, closeDay, lockDay, nonqualList, isNonqual,
} from '../lib/rewards.js';

const DAY_SQL = `SELECT d.*, p.name AS period_name, p.start_date, p.end_date
                   FROM reward_days d JOIN reward_periods p ON p.id = d.reward_period_id`;

const activityRows = (env, dayId) => all(env,
  `SELECT a.*, (SELECT COUNT(*) FROM reward_bookings b WHERE b.activity_id = a.id AND b.status = 'confirmed') AS taken
     FROM reward_activities a WHERE a.reward_day_id = ? ORDER BY a.kind, a.name`, dayId);

function parseGrades(v) {
  if (v === undefined || v === null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((x) => Number(x));
  if (!list.length || list.some((g) => ![6, 7, 8].includes(g))) throw bad('Allowed grades must be 6, 7, and/or 8.');
  return [...new Set(list)].sort().join(',');
}

// ---- Rewards Days (staff) ----------------------------------------------------------

add('GET', '/api/reward-days', 'staff', async ({ env }) => ({
  days: await all(env, `${DAY_SQL} ORDER BY d.reward_date DESC, d.id DESC`),
}));

function dayFields(body, cur = {}) {
  const opens = V.iso(body.booking_opens_at ?? cur.booking_opens_at, 'Booking opens');
  const closes = V.iso(body.booking_closes_at ?? cur.booking_closes_at, 'Booking closes');
  if (closes <= opens) throw bad('Booking must close after it opens.');
  return {
    name: V.str(body.name ?? cur.name, 'Name', { max: 80 }),
    reward_date: V.date(body.reward_date ?? cur.reward_date, 'Rewards Day date'),
    reward_period_id: V.int(body.reward_period_id ?? cur.reward_period_id, 'Reward period', { min: 1 }),
    opens, closes,
  };
}

add('POST', '/api/reward-days', 'admin', async (c) => {
  const f = dayFields(c.body);
  if (!(await one(c.env, 'SELECT id FROM reward_periods WHERE id = ?', f.reward_period_id))) throw bad('Reward period not found.');
  await run(c.env, "INSERT INTO reward_days (name, reward_date, reward_period_id, booking_opens_at, booking_closes_at, status) VALUES (?,?,?,?,?, 'draft')",
    f.name, f.reward_date, f.reward_period_id, f.opens, f.closes);
  await audit(c.env, c.actor, 'rewards.day_create', f.name);
  return { ok: true };
});

add('PATCH', '/api/reward-days/:id', 'admin', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  const f = dayFields(c.body, day);
  if (c.body.status !== undefined) V.oneOf(c.body.status, 'status', ['draft', 'open']);
  if (day.status === 'closed' && c.body.status) throw bad('A closed Rewards Day cannot be reopened.');
  await run(c.env, 'UPDATE reward_days SET name=?, reward_date=?, reward_period_id=?, booking_opens_at=?, booking_closes_at=?, status=? WHERE id=?',
    f.name, f.reward_date, f.reward_period_id, f.opens, f.closes, c.body.status || day.status, day.id);
  await audit(c.env, c.actor, 'rewards.day_update', `id=${day.id} status=${c.body.status || day.status}`);
  return { ok: true };
});

add('GET', '/api/reward-days/:id', 'staff', async ({ env, params }) => {
  const day = await getDay(env, V.int(params.id, 'id', { min: 1 }));
  return { day, activities: await activityRows(env, day.id), overview: await dayOverview(env, day) };
});

add('POST', '/api/reward-days/:id/close', 'admin', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  if (day.status === 'closed') throw bad('This Rewards Day is already closed.');
  return { ok: true, ...(await closeDay(c.env, day, c.actor, todayStr(c.env))) };
});

add('POST', '/api/reward-days/:id/auto-assign', 'staff', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  return { ok: true, ...(await autoAssign(c.env, day, c.actor)) };
});

add('POST', '/api/reward-days/:id/lock', 'admin', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  if (c.body.unlock) {
    await run(c.env, 'UPDATE reward_days SET qualification_locked_at = NULL WHERE id = ?', day.id);
    await run(c.env, 'DELETE FROM reward_day_nonquals WHERE reward_day_id = ?', day.id);
    await audit(c.env, c.actor, 'rewards.unlock', `day=${day.id}`);
    return { ok: true, locked: false };
  }
  return { ok: true, ...(await lockDay(c.env, day, c.actor)) };
});

// ---- Activities (staff) ------------------------------------------------------------

function activityFields(body, cur = {}) {
  const kind = V.oneOf(body.kind ?? cur.kind ?? 'regular', 'Type', ['regular', 'nonqual']);
  return {
    kind,
    name: V.str(body.name ?? cur.name, 'Name', { max: 80 }),
    description: V.str(body.description ?? cur.description, 'Description', { max: 300, optional: true }),
    location: V.str(body.location ?? cur.location, 'Room or location', { max: 80, optional: true }),
    capacity: V.int(body.capacity ?? cur.capacity, 'Number of spots', { min: 1, max: 1000 }),
    p5_cost: kind === 'nonqual' ? 0 : V.int(body.p5_cost ?? cur.p5_cost ?? 0, 'P5 cost', { min: 0, max: 100000 }),
    allowed_grades: kind === 'nonqual' ? null : parseGrades(body.allowed_grades === undefined ? cur.allowed_grades : body.allowed_grades),
  };
}
const canManage = (c, a) => c.user.role === 'admin' || a.created_by === c.user.email;

add('POST', '/api/reward-days/:id/activities', 'staff', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  if (day.status === 'closed') throw bad('This Rewards Day is closed.');
  const f = activityFields(c.body);
  await run(c.env,
    'INSERT INTO reward_activities (reward_day_id, name, description, location, capacity, p5_cost, kind, allowed_grades, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    day.id, f.name, f.description, f.location, f.capacity, f.p5_cost, f.kind, f.allowed_grades, c.user.email);
  await audit(c.env, c.actor, 'rewards.activity_create', `day=${day.id} name=${f.name} cap=${f.capacity}`);
  return { ok: true };
});

add('PATCH', '/api/reward-activities/:id', 'staff', async (c) => {
  const a = await one(c.env, 'SELECT * FROM reward_activities WHERE id = ?', V.int(c.params.id, 'id', { min: 1 }));
  if (!a) throw new HttpError(404, 'Activity not found.');
  if (!canManage(c, a)) throw new HttpError(403, 'You can only edit activities you created.');
  const f = activityFields(c.body, a);
  const taken = (await one(c.env, "SELECT COUNT(*) AS c FROM reward_bookings WHERE activity_id = ? AND status = 'confirmed'", a.id)).c;
  if (f.capacity < taken) throw bad(`${taken} students already have seats, so the number of spots can't go below ${taken}.`);
  await run(c.env, 'UPDATE reward_activities SET name=?, description=?, location=?, capacity=?, p5_cost=?, kind=?, allowed_grades=? WHERE id=?',
    f.name, f.description, f.location, f.capacity, f.p5_cost, f.kind, f.allowed_grades, a.id);
  await audit(c.env, c.actor, 'rewards.activity_update', `id=${a.id}`);
  return { ok: true };
});

add('DELETE', '/api/reward-activities/:id', 'staff', async (c) => {
  const a = await one(c.env, 'SELECT * FROM reward_activities WHERE id = ?', V.int(c.params.id, 'id', { min: 1 }));
  if (!a) throw new HttpError(404, 'Activity not found.');
  if (!canManage(c, a)) throw new HttpError(403, 'You can only delete activities you created.');
  const taken = (await one(c.env, "SELECT COUNT(*) AS c FROM reward_bookings WHERE activity_id = ? AND status = 'confirmed'", a.id)).c;
  if (taken) throw bad('This activity has booked students. Move or remove them first.');
  await run(c.env, 'DELETE FROM reward_bookings WHERE activity_id = ?', a.id); // only cancelled rows remain
  await run(c.env, 'DELETE FROM reward_activities WHERE id = ?', a.id);
  await audit(c.env, c.actor, 'rewards.activity_delete', `id=${a.id}`);
  return { ok: true };
});

add('GET', '/api/reward-activities/:id/roster', 'staff', async ({ env, params }) => {
  const id = V.int(params.id, 'id', { min: 1 });
  const activity = await one(env, 'SELECT * FROM reward_activities WHERE id = ?', id);
  if (!activity) throw new HttpError(404, 'Activity not found.');
  const students = await all(env,
    `SELECT b.id AS booking_id, s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, b.assignment
       FROM reward_bookings b JOIN students s ON s.student_id = b.student_id
      WHERE b.activity_id = ? AND b.status = 'confirmed' ORDER BY s.last_name, s.first_name`, id);
  return { activity, students };
});

// Qualifiers who have not booked yet, and non-qualifiers without a room (for manual placement).
add('GET', '/api/reward-days/:id/unplaced', 'staff', async ({ env, params }) => {
  const day = await getDay(env, V.int(params.id, 'id', { min: 1 }));
  const settings = await getSettings(env);
  const nq = new Map((await nonqualList(env, day, settings)).map((r) => [r.student_id, r.why]));
  const booked = new Set((await all(env, "SELECT student_id FROM reward_bookings WHERE reward_day_id = ? AND status = 'confirmed'", day.id)).map((r) => r.student_id));
  const students = (await all(env, 'SELECT student_id, last_name, first_name, grade, homeroom_teacher FROM students WHERE active = 1 ORDER BY grade, last_name, first_name'))
    .filter((s) => !booked.has(s.student_id))
    .map((s) => ({ ...s, nonqualifier: nq.has(s.student_id) }));
  return { students };
});

add('POST', '/api/reward-days/:id/place', 'staff', async (c) => {
  const day = await getDay(c.env, V.int(c.params.id, 'id', { min: 1 }));
  const activity = await one(c.env, 'SELECT * FROM reward_activities WHERE id = ? AND reward_day_id = ?', V.int(c.body.activity_id, 'Activity', { min: 1 }), day.id);
  if (!activity) throw bad('Activity not found for this Rewards Day.');
  const studentId = V.int(c.body.student_id, 'Student', { min: 1 });
  if (!(await one(c.env, 'SELECT 1 AS x FROM students WHERE student_id = ? AND active = 1', studentId))) throw bad('Student not found.');
  await placeStudent(c.env, { day, activity, studentId, assignment: 'manual', enforceBalance: false, actor: c.actor, today: todayStr(c.env) });
  await audit(c.env, c.actor, 'rewards.place', `day=${day.id} student=${studentId} activity=${activity.id}`);
  return { ok: true };
});

add('DELETE', '/api/reward-bookings/:id', 'staff', async (c) => {
  const b = await one(c.env, "SELECT id, student_id, p5_cost_paid FROM reward_bookings WHERE id = ? AND status = 'confirmed'", V.int(c.params.id, 'id', { min: 1 }));
  if (!b) throw new HttpError(404, 'Booking not found.');
  await cancelStudentBooking(c.env, b, c.actor, todayStr(c.env));
  await audit(c.env, c.actor, 'rewards.remove', `booking=${b.id} student=${b.student_id}`);
  return { ok: true };
});

// ---- Student portal: Reserve a Seat -------------------------------------------------

async function studentDay(env) {
  const today = todayStr(env);
  return (await one(env, `${DAY_SQL} WHERE d.status <> 'draft' AND d.reward_date >= ? ORDER BY d.reward_date, d.id LIMIT 1`, today)) || null;
}

add('GET', '/api/student/reward-day', 'student', async ({ env, student }) => {
  const day = await studentDay(env);
  const balance = (await one(env, 'SELECT COALESCE(SUM(amount),0) AS b FROM p5_transactions WHERE student_id = ?', student.student_id)).b;
  if (!day) return { day: null, balance };
  const settings = await getSettings(env);
  const nonqual = await isNonqual(env, day, settings, student.student_id);
  const now = new Date().toISOString();
  const window = day.status === 'closed' || now >= day.booking_closes_at ? 'closed' : now < day.booking_opens_at ? 'before' : 'open';
  const mine = await one(env,
    `SELECT b.id, b.p5_cost_paid, a.id AS activity_id, a.name, a.location, a.kind, b.assignment
       FROM reward_bookings b JOIN reward_activities a ON a.id = b.activity_id
      WHERE b.reward_day_id = ? AND b.student_id = ? AND b.status = 'confirmed'`, day.id, student.student_id);
  const out = {
    day: { id: day.id, name: day.name, reward_date: day.reward_date, booking_opens_at: day.booking_opens_at, booking_closes_at: day.booking_closes_at, window },
    balance,
    qualified: !nonqual,
    booking: mine && { activity_id: mine.activity_id, name: mine.name, location: mine.location, p5_cost_paid: mine.p5_cost_paid },
  };
  // Non-qualifiers only ever see their assigned room. Never the reason, never other activities.
  if (!nonqual) {
    out.activities = (await activityRows(env, day.id)).filter((a) => a.kind === 'regular').map((a) => ({
      id: a.id, name: a.name, description: a.description, location: a.location, capacity: a.capacity,
      left: Math.max(0, a.capacity - a.taken), p5_cost: a.p5_cost,
      grade_ok: !a.allowed_grades || a.allowed_grades.split(',').includes(String(student.grade)),
      allowed_grades: a.allowed_grades,
    }));
  }
  return out;
});

add('POST', '/api/student/reward-day/book', 'student', async (c) => {
  const { env, student, body } = c;
  const day = await studentDay(env);
  if (!day) throw bad('There is no Rewards Day open for booking.');
  const now = new Date().toISOString();
  if (day.status !== 'open' || now < day.booking_opens_at || now >= day.booking_closes_at) throw bad('Booking is not open right now.');
  const settings = await getSettings(env);
  if (await isNonqual(env, day, settings, student.student_id)) throw new HttpError(403, 'You have been assigned a room for Rewards Day, so you can\u2019t book an activity.');
  const activity = await one(env, "SELECT * FROM reward_activities WHERE id = ? AND reward_day_id = ? AND kind = 'regular'", V.int(body.activity_id, 'Activity', { min: 1 }), day.id);
  if (!activity) throw bad('That activity was not found.');
  if (activity.allowed_grades && !activity.allowed_grades.split(',').includes(String(student.grade))) throw bad('That activity is not open to your grade.');
  await placeStudent(env, { day, activity, studentId: student.student_id, assignment: 'self', enforceBalance: true, actor: c.actor, today: todayStr(env) });
  await audit(env, c.actor, 'rewards.book', `day=${day.id} activity=${activity.id}`);
  return { ok: true };
});

add('DELETE', '/api/student/reward-day/booking', 'student', async (c) => {
  const { env, student } = c;
  const day = await studentDay(env);
  if (!day) throw bad('There is no Rewards Day open for booking.');
  const now = new Date().toISOString();
  if (day.status !== 'open' || now >= day.booking_closes_at) throw bad('Booking has closed, so seats can\u2019t be cancelled.');
  const b = await one(env,
    `SELECT b.id, b.student_id, b.p5_cost_paid, a.kind FROM reward_bookings b JOIN reward_activities a ON a.id = b.activity_id
      WHERE b.reward_day_id = ? AND b.student_id = ? AND b.status = 'confirmed'`, day.id, student.student_id);
  if (!b || b.kind !== 'regular') throw bad('You don\u2019t have a seat to cancel.');
  await cancelStudentBooking(env, b, c.actor, todayStr(env));
  await audit(env, c.actor, 'rewards.cancel_own', `day=${day.id}`);
  return { ok: true };
});
