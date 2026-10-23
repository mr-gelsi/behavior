// Rewards Day engine: qualification, booking, auto-assignment, reconciliation.
import { all, one, run, st, batch, chunked, audit, getSettings } from './db.js';
import { bad, fmtMD, todayStr } from './util.js';
import { cleanup } from './auth.js';

export async function getDay(env, id) {
  const d = await one(env,
    `SELECT d.*, p.name AS period_name, p.start_date, p.end_date
       FROM reward_days d JOIN reward_periods p ON p.id = d.reward_period_id WHERE d.id = ?`, id);
  if (!d) throw bad('Rewards Day not found.');
  return d;
}

function whyText(row, s) {
  if (row.hi_n >= 1) return `Step ${row.hi} on ${fmtMD(row.hi_date)}`;
  return `${row.s1} x Step 1`;
}

// Live calculation: students whose steps in [start,end] make them non-qualifiers.
export async function liveNonquals(env, start, end, settings) {
  const rows = await all(env,
    `SELECT s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, s.room,
            COUNT(*) AS n,
            SUM(CASE WHEN st.step_level = 1 THEN 1 ELSE 0 END) AS s1,
            SUM(CASE WHEN st.step_level >= ? THEN 1 ELSE 0 END) AS hi_n,
            MAX(st.step_level * 100000000 + CAST(REPLACE(st.step_date, '-', '') AS INTEGER)) AS hi_key
       FROM steps st JOIN students s ON s.student_id = st.student_id
      WHERE s.active = 1 AND st.step_date BETWEEN ? AND ?
      GROUP BY s.student_id
     HAVING hi_n >= 1 OR s1 >= ?
      ORDER BY s.grade, s.last_name, s.first_name`,
    settings.nonqual_min_step, start, end, settings.nonqual_step1_count);
  return rows.map((r) => {
    const hi = Math.floor(r.hi_key / 100000000);
    const d = String(r.hi_key % 100000000);
    const hi_date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const row = { ...r, hi, hi_date };
    row.why = whyText(row, settings);
    return row;
  });
}

// The non-qualifier list for a Rewards Day (frozen snapshot if locked, otherwise live).
export async function nonqualList(env, day, settings) {
  if (day.qualification_locked_at) {
    return all(env,
      `SELECT s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, s.room, n.why
         FROM reward_day_nonquals n JOIN students s ON s.student_id = n.student_id
        WHERE n.reward_day_id = ? AND s.active = 1
        ORDER BY s.grade, s.last_name, s.first_name`, day.id);
  }
  return liveNonquals(env, day.start_date, day.end_date, settings);
}

export async function isNonqual(env, day, settings, studentId) {
  if (day.qualification_locked_at) {
    return !!(await one(env, 'SELECT 1 AS x FROM reward_day_nonquals WHERE reward_day_id = ? AND student_id = ?', day.id, studentId));
  }
  const r = await one(env,
    `SELECT SUM(CASE WHEN step_level = 1 THEN 1 ELSE 0 END) AS s1,
            SUM(CASE WHEN step_level >= ? THEN 1 ELSE 0 END) AS hi_n
       FROM steps WHERE student_id = ? AND step_date BETWEEN ? AND ?`,
    settings.nonqual_min_step, studentId, day.start_date, day.end_date);
  return (r.hi_n || 0) >= 1 || (r.s1 || 0) >= settings.nonqual_step1_count;
}

export async function dayOverview(env, day, settings) {
  settings = settings || (await getSettings(env));
  const nq = await nonqualList(env, day, settings);
  const nqIds = new Set(nq.map((r) => r.student_id));
  const active = (await one(env, 'SELECT COUNT(*) AS c FROM students WHERE active = 1')).c;
  const bookings = await all(env,
    `SELECT b.student_id, a.kind FROM reward_bookings b JOIN reward_activities a ON a.id = b.activity_id
      WHERE b.reward_day_id = ? AND b.status = 'confirmed'`, day.id);
  const nqAssigned = new Set(bookings.filter((b) => b.kind === 'nonqual' && nqIds.has(b.student_id)).map((b) => b.student_id));
  const qualBooked = bookings.filter((b) => b.kind === 'regular' && !nqIds.has(b.student_id)).length;
  const roomLeft = (await one(env,
    `SELECT COALESCE(SUM(a.capacity - (SELECT COUNT(*) FROM reward_bookings b WHERE b.activity_id = a.id AND b.status = 'confirmed')), 0) AS left
       FROM reward_activities a WHERE a.reward_day_id = ? AND a.kind = 'nonqual'`, day.id)).left;
  const unassigned = nq.length - nqAssigned.size;
  return {
    qualifiers: active - nq.length,
    qualifiers_booked: qualBooked,
    qualifiers_unbooked: active - nq.length - qualBooked,
    nonqualifiers: nq.length,
    nonqualifiers_assigned: nqAssigned.size,
    nonqualifiers_unassigned: unassigned,
    nonqual_room_seats_left: roomLeft,
    shortfall: Math.max(0, unassigned - roomLeft),
    locked: !!day.qualification_locked_at,
  };
}

// ---- Booking primitives (all capacity/balance checks happen inside the SQL) ---------------

export function cancelBookingStmts(env, b, actor, today) {
  const s = [st(env, "UPDATE reward_bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'", b.id)];
  if (b.p5_cost_paid > 0) {
    s.push(st(env,
      `INSERT INTO p5_transactions (student_id, type, amount, note, created_by, tx_date, related_id)
       SELECT ?, 'seat_refund', ?, 'Refund: Rewards Day seat', ?, ?, ? WHERE changes() = 1`,
      b.student_id, b.p5_cost_paid, actor, today, b.id));
  }
  return s;
}

function insertBookingStmts(env, { day, activity, studentId, assignment, cost, enforceBalance, actor, today }) {
  const out = [];
  out.push(st(env,
    `INSERT INTO reward_bookings (activity_id, reward_day_id, student_id, assignment, p5_cost_paid, status)
     SELECT ?, ?, ?, ?, ?, 'confirmed'
      WHERE (SELECT COUNT(*) FROM reward_bookings WHERE activity_id = ? AND status = 'confirmed')
            < (SELECT capacity FROM reward_activities WHERE id = ?)
        AND (? = 0 OR (SELECT COALESCE(SUM(amount), 0) FROM p5_transactions WHERE student_id = ?) >= ?)`,
    activity.id, day.id, studentId, assignment, cost, activity.id, activity.id, enforceBalance ? 1 : 0, studentId, cost));
  if (cost > 0) {
    out.push(st(env,
      `INSERT INTO p5_transactions (student_id, type, amount, note, created_by, tx_date, related_id)
       SELECT ?, 'seat', ?, ?, ?, ?, (SELECT id FROM reward_bookings WHERE reward_day_id = ? AND student_id = ? AND status = 'confirmed')
        WHERE changes() = 1`,
      studentId, -cost, `Rewards Day: ${activity.name}`.slice(0, 120), actor, today, day.id, studentId));
  }
  return out;
}

// Put a student into an activity, replacing any existing seat. Never overbooks.
export async function placeStudent(env, { day, activity, studentId, assignment, enforceBalance, actor, today }) {
  const existing = await one(env,
    "SELECT id, activity_id, student_id, p5_cost_paid FROM reward_bookings WHERE reward_day_id = ? AND student_id = ? AND status = 'confirmed'",
    day.id, studentId);
  if (existing && existing.activity_id === activity.id) throw bad('That student already has a seat in this activity.');
  const cost = activity.kind === 'regular' ? activity.p5_cost : 0;
  const stmts = [];
  if (existing) stmts.push(...cancelBookingStmts(env, existing, actor, today));
  const insertAt = stmts.length;
  stmts.push(...insertBookingStmts(env, { day, activity, studentId, assignment, cost, enforceBalance, actor, today }));
  const res = await batch(env, stmts);
  const inserted = (res[insertAt].meta && res[insertAt].meta.changes) === 1;
  if (inserted) return { ok: true };

  // The new seat was refused (full, or not enough points). Put the old seat back.
  const count = (await one(env, "SELECT COUNT(*) AS c FROM reward_bookings WHERE activity_id = ? AND status = 'confirmed'", activity.id)).c;
  const full = count >= activity.capacity;
  if (existing) {
    const oldAct = await one(env, 'SELECT * FROM reward_activities WHERE id = ?', existing.activity_id);
    await batch(env, insertBookingStmts(env, { day, activity: oldAct, studentId, assignment, cost: existing.p5_cost_paid, enforceBalance: false, actor, today }));
  }
  throw bad(full
    ? 'Sorry, that activity just filled up.' + (existing ? ' Your original seat was kept.' : '')
    : 'Not enough P5 points for that activity.' + (existing ? ' Your original seat was kept.' : ''));
}

export async function cancelStudentBooking(env, booking, actor, today) {
  const res = await batch(env, cancelBookingStmts(env, booking, actor, today));
  if (!(res[0].meta && res[0].meta.changes === 1)) throw bad('That seat was already cancelled.');
}

// ---- Auto-assignment and reconciliation -----------------------------------------------------

export async function autoAssign(env, day, actor) {
  const settings = await getSettings(env);
  const nq = await nonqualList(env, day, settings);
  const booked = new Set((await all(env,
    "SELECT student_id FROM reward_bookings WHERE reward_day_id = ? AND status = 'confirmed'", day.id)).map((r) => r.student_id));
  const todo = nq.filter((r) => !booked.has(r.student_id));
  const rooms = await all(env,
    `SELECT a.id, a.capacity - (SELECT COUNT(*) FROM reward_bookings b WHERE b.activity_id = a.id AND b.status = 'confirmed') AS room_left
       FROM reward_activities a WHERE a.reward_day_id = ? AND a.kind = 'nonqual' ORDER BY a.id`, day.id);
  const stmts = [];
  let ri = 0;
  for (const s of todo) {
    while (ri < rooms.length && rooms[ri].room_left <= 0) ri++;
    if (ri >= rooms.length) break;
    rooms[ri].room_left--;
    const aid = rooms[ri].id;
    stmts.push(st(env,
      `INSERT INTO reward_bookings (activity_id, reward_day_id, student_id, assignment, p5_cost_paid, status)
       SELECT ?, ?, ?, 'auto', 0, 'confirmed'
        WHERE (SELECT COUNT(*) FROM reward_bookings WHERE activity_id = ? AND status = 'confirmed')
              < (SELECT capacity FROM reward_activities WHERE id = ?)
          AND NOT EXISTS (SELECT 1 FROM reward_bookings WHERE reward_day_id = ? AND student_id = ? AND status = 'confirmed')`,
      aid, day.id, s.student_id, aid, aid, day.id, s.student_id));
  }
  const res = await chunked(env, stmts, 40);
  const assigned = res.reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
  const unassigned = todo.length - assigned;
  await audit(env, actor, 'rewards.auto_assign', `day=${day.id} assigned=${assigned} unassigned=${unassigned}`);
  return { assigned, unassigned, shortfall: unassigned };
}

// Move students who became non-qualifiers after booking a regular activity.
export async function reconcileDay(env, day, actor, today) {
  if (day.qualification_locked_at) return { moved: 0 };
  const settings = await getSettings(env);
  const nq = new Set((await liveNonquals(env, day.start_date, day.end_date, settings)).map((r) => r.student_id));
  if (!nq.size) return { moved: 0 };
  const rows = (await all(env,
    `SELECT b.id, b.student_id, b.p5_cost_paid FROM reward_bookings b JOIN reward_activities a ON a.id = b.activity_id
      WHERE b.reward_day_id = ? AND b.status = 'confirmed' AND a.kind = 'regular' AND b.assignment = 'self'`, day.id))
    .filter((b) => nq.has(b.student_id));
  const stmts = rows.flatMap((b) => cancelBookingStmts(env, b, actor, today));
  await chunked(env, stmts, 40);
  if (rows.length) await audit(env, actor, 'rewards.reconcile', `day=${day.id} moved=${rows.length}`);
  return { moved: rows.length };
}

export async function reconcileOpenDays(env, actor, today) {
  const days = await all(env,
    `SELECT d.*, p.name AS period_name, p.start_date, p.end_date
       FROM reward_days d JOIN reward_periods p ON p.id = d.reward_period_id WHERE d.status = 'open'`);
  for (const d of days) {
    const r = await reconcileDay(env, d, actor, today);
    if (r.moved) await autoAssign(env, d, actor);
  }
}

export async function closeDay(env, day, actor, today) {
  await run(env, "UPDATE reward_days SET status = 'closed' WHERE id = ?", day.id);
  const rec = await reconcileDay(env, day, actor, today);
  const asg = await autoAssign(env, day, actor);
  await audit(env, actor, 'rewards.close', `day=${day.id}`);
  return { ...rec, ...asg };
}

export async function lockDay(env, day, actor) {
  const settings = await getSettings(env);
  const rows = await liveNonquals(env, day.start_date, day.end_date, settings);
  const stmts = [st(env, 'DELETE FROM reward_day_nonquals WHERE reward_day_id = ?', day.id)];
  for (const r of rows) {
    stmts.push(st(env, 'INSERT INTO reward_day_nonquals (reward_day_id, student_id, why) VALUES (?,?,?)', day.id, r.student_id, r.why));
  }
  await chunked(env, stmts, 40);
  await run(env, 'UPDATE reward_days SET qualification_locked_at = ? WHERE id = ?', new Date().toISOString(), day.id);
  await audit(env, actor, 'rewards.lock', `day=${day.id} nonqualifiers=${rows.length}`);
  return { locked: true, nonqualifiers: rows.length };
}

export async function runScheduled(env) {
  await cleanup(env);
  const now = new Date().toISOString();
  const today = todayStr(env);
  const due = await all(env,
    `SELECT d.*, p.name AS period_name, p.start_date, p.end_date
       FROM reward_days d JOIN reward_periods p ON p.id = d.reward_period_id
      WHERE d.status = 'open' AND d.booking_closes_at <= ?`, now);
  for (const d of due) await closeDay(env, d, 'system:cron', today);
}
