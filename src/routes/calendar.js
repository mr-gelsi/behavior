// School calendar (admin): which days are NOT school days (holidays, breaks, teacher days) and any extra school days.
import { add } from '../router.js';
import { all, one, run, st, chunked, audit } from '../lib/db.js';
import { V, bad, HttpError, todayStr, schoolYearOf, isDate } from '../lib/util.js';
import { addDays, dayNum } from '../lib/steps.js';
import { countSchoolDays } from '../lib/calendar.js';

add('GET', '/api/admin/calendar', 'admin', async ({ env, url }) => {
  const today = todayStr(env);
  const year = url.searchParams.get('year') || schoolYearOf(today);
  if (!/^\d{4}-\d{2}$/.test(year)) throw bad('School year must look like 2026-27.');
  const days = await all(env, 'SELECT date, kind, label FROM school_calendar WHERE school_year = ? ORDER BY date', year);
  const years = await all(env, 'SELECT DISTINCT school_year FROM school_calendar ORDER BY school_year DESC');
  const yearStart = (await one(env, 'SELECT MIN(start_date) AS d FROM reward_periods WHERE school_year = ?', year))?.d || `${year.slice(0, 4)}-08-01`;
  const end = year === schoolYearOf(today) ? today : `${Number(year.slice(0, 4)) + 1}-07-01`;
  return {
    year, days, years: years.map((y) => y.school_year), year_start: yearStart,
    school_days_so_far: await countSchoolDays(env, yearStart, end),
  };
});

// rows: [{ date, end_date?, label?, kind? }]. A row with end_date covers every day from date to end_date.
add('POST', '/api/admin/calendar/import', 'admin', async ({ env, body, actor }) => {
  if (!Array.isArray(body.rows) || !body.rows.length) throw bad('That file has no dates in it.');
  if (body.rows.length > 1500) throw bad('Please upload 1,500 rows or fewer at a time.');
  const map = new Map();
  for (const [i, r] of body.rows.entries()) {
    const where = `Row ${i + 1}`;
    if (!isDate(r.date)) throw bad(`${where}: "${r.date}" is not a date (use 2026-11-26 or 11/26/2026).`);
    const end = r.end_date ? r.end_date : r.date;
    if (!isDate(end) || end < r.date) throw bad(`${where}: the end date "${r.end_date}" is not a date on or after the start date.`);
    if (dayNum(end) - dayNum(r.date) > 120) throw bad(`${where}: a range can be at most 120 days.`);
    const kind = V.oneOf(r.kind || 'off', `${where} type`, ['off', 'school']);
    const label = V.str(r.label, `${where} label`, { max: 80, optional: true });
    for (let d = r.date; d <= end; d = addDays(d, 1)) map.set(d, { kind, label });
  }
  const years = [...new Set([...map.keys()].map(schoolYearOf))];
  const stmts = [];
  if (body.replace) for (const y of years) stmts.push(st(env, 'DELETE FROM school_calendar WHERE school_year = ?', y));
  for (const [d, v] of map) stmts.push(st(env, 'INSERT OR REPLACE INTO school_calendar (date, kind, label, school_year) VALUES (?,?,?,?)', d, v.kind, v.label, schoolYearOf(d)));
  await chunked(env, stmts, 40);
  await audit(env, actor, 'calendar.import', `days=${map.size} replace=${!!body.replace} years=${years.join(',')}`);
  return { ok: true, days: map.size, years };
});

add('DELETE', '/api/admin/calendar/:date', 'admin', async ({ env, params, actor }) => {
  if (!isDate(params.date)) throw new HttpError(404, 'Not found.');
  await run(env, 'DELETE FROM school_calendar WHERE date = ?', params.date);
  await audit(env, actor, 'calendar.delete', params.date);
  return { ok: true };
});
