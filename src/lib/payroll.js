// Weekly class-job pay. Runs from the hourly job. Pay day is Friday; if the calendar marks that Friday as a day off,
// the previous school day that week is used. Each (hire, pay date) pays once, no matter how often this runs.
import { all, st, batch } from './db.js';
import { todayStr } from './util.js';
import { addDays } from './steps.js';
import { loadCalendar, isSchoolDay } from './calendar.js';

const dow = (d) => new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay(); // 0 = Sunday

// The pay date for the school week that contains `day`, or null if the whole week is off.
export async function payDateForWeek(env, day) {
  const monday = addDays(day, -((dow(day) + 6) % 7));
  const friday = addDays(monday, 4);
  const cal = await loadCalendar(env, monday, friday);
  for (let d = friday; d >= monday; d = addDays(d, -1)) if (isSchoolDay(d, cal)) return d;
  return null;
}

// Pays this week's and the previous week's pay dates that have arrived (catches up after downtime).
export async function runPayroll(env, asOf = null) {
  const today = asOf || todayStr(env);
  const dates = new Set();
  for (const day of [today, addDays(today, -7)]) {
    const pd = await payDateForWeek(env, day);
    if (pd && pd <= today) dates.add(pd);
  }
  let paid = 0;
  for (const payDate of [...dates].sort()) paid += await payFor(env, payDate);
  return { paid, dates: [...dates].sort() };
}

async function payFor(env, payDate) {
  // Anyone already paid for this calendar week (even on a different day, if the calendar changed) is skipped.
  const monday = addDays(payDate, -((dow(payDate) + 6) % 7));
  const sunday = addDays(monday, 6);
  const rows = await all(env,
    `SELECT a.id AS app_id, a.student_id, j.salary, j.title, c.name AS class_name
       FROM job_applications a
       JOIN class_jobs j ON j.id = a.job_id AND j.active = 1
       JOIN classes c ON c.id = a.class_id AND c.archived = 0
       JOIN students s ON s.student_id = a.student_id AND s.active = 1
       JOIN class_members m ON m.class_id = a.class_id AND m.student_id = a.student_id
      WHERE a.status = 'hired' AND a.hired_on <= ?
        AND NOT EXISTS (SELECT 1 FROM job_payments p WHERE p.application_id = a.id AND p.pay_date BETWEEN ? AND ?)`, payDate, monday, sunday);
  let n = 0;
  for (const r of rows) {
    const note = `Class job pay: ${r.title} (${r.class_name})`.slice(0, 200);
    const res = await batch(env, [
      st(env, 'INSERT OR IGNORE INTO job_payments (application_id, pay_date, amount) VALUES (?,?,?)', r.app_id, payDate, r.salary),
      st(env,
        `INSERT INTO p5_transactions (student_id, type, amount, note, created_by, tx_date, related_id)
         SELECT ?, 'award', ?, ?, 'system:payroll', ?, (SELECT id FROM job_payments WHERE application_id = ? AND pay_date = ?)
          WHERE changes() = 1`, r.student_id, r.salary, note, payDate, r.app_id, payDate),
    ]);
    if (res[0].meta.changes) n++;
  }
  return n;
}
