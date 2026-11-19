// Steps compound within a 7-day window from the SAME teacher: the first step starts a window,
// and any further step from that teacher inside the next 7 days must be higher than the highest one so far.
// When the 7 days are over the chain resets and the next step can be Step 1 again.
import { all } from './db.js';
import { lastNameOf } from './util.js';

const DAY = 864e5;
export const dayNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

// Returns { [student_id]: { min, last, start, end } }. min = lowest step level allowed now (1 = no limit; 6 = already at Step 5).
export async function stepFloors(env, studentIds, teacher, email, date) {
  const ids = [...new Set(studentIds)];
  const out = Object.fromEntries(ids.map((id) => [id, { min: 1, last: 0, start: null, end: null }]));
  if (!ids.length) return out;
  const key = lastNameOf(teacher).toLowerCase();
  const rows = await all(env,
    `SELECT student_id, step_level, step_date, teacher, created_by FROM steps
      WHERE student_id IN (${ids.map(() => '?').join(',')}) AND step_date <= ? AND step_date >= ?
      ORDER BY step_date, id`, ...ids, date, addDays(date, -400));
  const chains = new Map();
  for (const r of rows) {
    const same = (email && r.created_by === email) || (key && lastNameOf(r.teacher).toLowerCase() === key);
    if (!same) continue;
    const c = chains.get(r.student_id);
    if (c && dayNum(r.step_date) - dayNum(c.start) < 7) c.max = Math.max(c.max, r.step_level);
    else chains.set(r.student_id, { start: r.step_date, max: r.step_level });
  }
  for (const [id, c] of chains) {
    if (dayNum(date) - dayNum(c.start) < 7) out[id] = { min: c.max + 1, last: c.max, start: c.start, end: addDays(c.start, 6) };
  }
  return out;
}

export function floorMessage(name, teacher, f) {
  if (f.min > 5) return `${name} already has a Step 5 from ${teacher} this week, so no higher step can be given until ${addDays(f.end, 1)}.`;
  return `${name} already has a Step ${f.last} from ${teacher} in the last 7 days (until ${f.end}), so the next step must be Step ${f.min} or higher.`;
}
