// The school calendar: Monday-Friday are school days unless the admin marked them "off" (holidays, breaks, teacher days),
// and a day marked "school" counts even on a weekend (for example a make-up Saturday).
import { all } from './db.js';
import { addDays } from './steps.js';

export async function loadCalendar(env, from, to) {
  const rows = await all(env, 'SELECT date, kind FROM school_calendar WHERE date BETWEEN ? AND ?', from, to);
  return new Map(rows.map((r) => [r.date, r.kind]));
}
export function isSchoolDay(date, cal) {
  const k = cal.get(date);
  if (k === 'off') return false;
  if (k === 'school') return true;
  const wd = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
  return wd !== 0 && wd !== 6;
}
// School days from `from` up to but not including `until` (today is not finished yet).
export async function countSchoolDays(env, from, until) {
  if (from >= until) return 0;
  const cal = await loadCalendar(env, from, until);
  let n = 0;
  for (let d = from; d < until; d = addDays(d, 1)) if (isSchoolDay(d, cal)) n++;
  return n;
}
