// Trophies (top P5 earners in each Rewards period) and accomplishment badges.
import { all, one } from './db.js';
import { schoolYearOf } from './util.js';
import { addDays } from './steps.js';
import { countSchoolDays } from './calendar.js';

const GOLD_PCT = 10, SILVER_PCT = 20, BRONZE_PCT = 30;
export const tierForPercent = (pct) => (pct < GOLD_PCT ? 'gold' : pct < SILVER_PCT ? 'silver' : pct < BRONZE_PCT ? 'bronze' : null);

// Everyone's tickets earned in one period (awards only, not ones that were taken back).
// Trophies are won against students in the SAME grade.
async function earnedByStudent(env, period, grade) {
  return all(env,
    `SELECT p.student_id, SUM(p.amount) AS earned FROM p5_transactions p JOIN students s ON s.student_id = p.student_id
      WHERE p.type = 'award' AND p.reversed_by IS NULL AND s.active = 1 AND s.grade = ? AND p.tx_date BETWEEN ? AND ?
      GROUP BY p.student_id HAVING earned > 0`, grade, period.start_date, period.end_date);
}

export async function trophiesFor(env, studentId, today) {
  const periods = await all(env,
    'SELECT id, name, start_date, end_date FROM reward_periods WHERE school_year = ? AND start_date <= ? ORDER BY start_date', schoolYearOf(today), today);
  const out = [];
  const grade = (await one(env, 'SELECT grade FROM students WHERE student_id = ?', studentId))?.grade;
  for (const p of periods) {
    const rows = await earnedByStudent(env, p, grade);
    const me = rows.find((r) => r.student_id === studentId);
    const final = p.end_date < today;
    if (!me) { out.push({ period_id: p.id, name: p.name, tier: null, earned: 0, top_percent: null, final, current: !final }); continue; }
    const ahead = rows.filter((r) => r.earned > me.earned).length;
    const pct = (ahead / rows.length) * 100;
    out.push({
      period_id: p.id, name: p.name, tier: tierForPercent(pct), earned: me.earned,
      top_percent: Math.max(1, Math.ceil(((ahead + 1) / rows.length) * 100)), final, current: !final,
    });
  }
  return out;
}

const LEVELS = {
  steps: [[5, 'Bronze'], [10, 'Silver'], [20, 'Gold'], [40, 'Platinum']],
  breaks: [[1, 'Bronze'], [5, 'Silver'], [15, 'Gold'], [30, 'Platinum']],
};
function level(kind, n) {
  const L = LEVELS[kind];
  let cur = null, next = null;
  for (const [min, name] of L) { if (n >= min) cur = { name, min }; else if (!next) next = { name, min }; }
  return { tier: cur ? cur.name.toLowerCase() : null, next: next ? { name: next.name, need: next.min - n } : null };
}

// Both badges count SCHOOL days from the school calendar (weekends, holidays and breaks are skipped), not counting today.
export async function badgesFor(env, studentId, today) {
  const yearStart = (await one(env, 'SELECT MIN(start_date) AS d FROM reward_periods WHERE school_year = ?', schoolYearOf(today)))?.d
    || `${schoolYearOf(today).slice(0, 4)}-08-01`;
  const lastStep = (await one(env, 'SELECT MAX(step_date) AS d FROM steps WHERE student_id = ? AND step_date <= ?', studentId, today))?.d;
  const lastBreak = (await one(env, 'SELECT MAX(break_date) AS d FROM break_log WHERE student_id = ? AND break_date <= ?', studentId, today))?.d;
  const startAfter = (last) => (last && last >= yearStart ? addDays(last, 1) : yearStart);
  const free = await countSchoolDays(env, startAfter(lastStep), today);
  const stay = await countSchoolDays(env, startAfter(lastBreak), today);
  return {
    step_free_days: { count: free, last_step: lastStep || null, ...level('steps', free) },
    no_leave_days: { count: stay, last_break: lastBreak || null, ...level('breaks', stay) },
  };
}
