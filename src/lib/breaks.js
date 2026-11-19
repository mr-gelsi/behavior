import { one, run } from './db.js';
import { schoolYearOf } from './util.js';

export async function breakCounts(env, studentId, today, period) {
  const year = schoolYearOf(today);
  const row = await one(env,
    `SELECT COUNT(*) AS total, COALESCE(SUM(reason = 'restroom'), 0) AS restroom, COALESCE(SUM(reason = 'water'), 0) AS water,
            COALESCE(SUM(break_date = ?), 0) AS today
       FROM break_log WHERE student_id = ? AND school_year = ?`, today, studentId, year);
  let inPeriod = null;
  if (period) {
    inPeriod = await one(env,
      `SELECT COUNT(*) AS total, COALESCE(SUM(reason = 'restroom'), 0) AS restroom, COALESCE(SUM(reason = 'water'), 0) AS water
         FROM break_log WHERE student_id = ? AND break_date BETWEEN ? AND ?`, studentId, period.start_date, period.end_date);
  }
  return { year: { total: row.total, restroom: row.restroom, water: row.water }, today: row.today, period: inPeriod };
}

// Called from the hourly job: a break still open after 3 hours was forgotten, so close it and mark it as auto-closed.
export async function closeStaleBreaks(env) {
  await run(env,
    "UPDATE break_log SET returned_at = left_at, status = 'returned', return_method = 'auto' WHERE status = 'out' AND left_at < ?",
    new Date(Date.now() - 3 * 3600 * 1000).toISOString());
}
