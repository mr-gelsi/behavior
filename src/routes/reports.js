import { add } from '../router.js';
import { all, one, getSettings } from '../lib/db.js';
import { V, bad, todayStr, schoolYearOf, shiftSchoolYear } from '../lib/util.js';
import { liveNonquals, dayOverview, getDay } from '../lib/rewards.js';

const MONTHS = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]; // August through June

add('GET', '/api/dashboard', 'staff', async ({ env, url }) => {
  const today = todayStr(env);
  const year = url.searchParams.get('year') || schoolYearOf(today);
  const from = url.searchParams.get('from') ? V.date(url.searchParams.get('from'), 'from') : null;
  const to = url.searchParams.get('to') ? V.date(url.searchParams.get('to'), 'to') : null;
  const where = ['t.school_year = ?', 's.active = 1'];
  const p = [year];
  if (from) { where.push('t.step_date >= ?'); p.push(from); }
  if (to) { where.push('t.step_date <= ?'); p.push(to); }
  const W = where.join(' AND ');

  const rows = await all(env,
    `SELECT t.step_level AS level, s.grade, COUNT(*) AS events, COUNT(DISTINCT t.student_id) AS students
       FROM steps t JOIN students s ON s.student_id = t.student_id WHERE ${W} GROUP BY t.step_level, s.grade`, ...p);
  const steps = {};
  for (let l = 1; l <= 5; l++) {
    steps[l] = { students: 0, events: 0, by_grade: { 6: 0, 7: 0, 8: 0 }, events_by_grade: { 6: 0, 7: 0, 8: 0 } };
  }
  for (const r of rows) {
    const x = steps[r.level];
    x.students += r.students;          // grades are disjoint, so unique students add up
    x.events += r.events;
    x.by_grade[r.grade] = r.students;
    x.events_by_grade[r.grade] = r.events;
  }

  // Steps by Rewards Period (matches the workbook: start and end dates inclusive).
  const periods = await all(env, 'SELECT id, name, start_date, end_date FROM reward_periods WHERE school_year = ? ORDER BY start_date, id', year);
  const pc = await all(env,
    `SELECT rp.id, s.grade, COUNT(*) AS n
       FROM reward_periods rp
       JOIN steps t ON t.step_date BETWEEN rp.start_date AND rp.end_date
       JOIN students s ON s.student_id = t.student_id AND s.active = 1
      WHERE rp.school_year = ? GROUP BY rp.id, s.grade`, year);
  const periodGrid = periods.map((pr) => ({
    ...pr,
    by_grade: { 6: 0, 7: 0, 8: 0, ...Object.fromEntries(pc.filter((x) => x.id === pr.id).map((x) => [x.grade, x.n])) },
  }));

  // P5 this month.
  const monthStart = today.slice(0, 7) + '-01';
  const p5 = await one(env,
    `SELECT COALESCE(SUM(CASE WHEN type = 'award' THEN amount END), 0) AS awarded,
            COALESCE(-SUM(CASE WHEN type = 'fine' THEN amount END), 0) AS fined,
            COALESCE(-SUM(CASE WHEN type IN ('purchase','seat','refund','seat_refund') THEN amount END), 0) AS spent
       FROM p5_transactions WHERE tx_date >= ?`, monthStart);
  const byCat = await all(env,
    `SELECT c.id, c.name, c.emoji, c.color, COALESCE(SUM(p.amount), 0) AS points, COUNT(p.id) AS awards
       FROM p5_categories c LEFT JOIN p5_transactions p
         ON p.category_id = c.id AND p.type = 'award' AND p.tx_date >= ?
      GROUP BY c.id ORDER BY c.sort`, monthStart);
  const top = [...byCat].sort((a, b) => b.points - a.points)[0];

  // Banners.
  const banners = [];
  const pending = (await one(env, "SELECT COUNT(*) AS c FROM store_orders WHERE status = 'pending'")).c;
  if (pending) banners.push({ kind: 'info', text: `${pending} store order${pending === 1 ? '' : 's'} waiting to be fulfilled.`, link: '#/store', link_text: 'View orders' });
  const upcoming = await all(env,
    `SELECT d.*, p.name AS period_name, p.start_date, p.end_date FROM reward_days d JOIN reward_periods p ON p.id = d.reward_period_id
      WHERE d.status <> 'closed' AND d.reward_date >= ? ORDER BY d.reward_date, d.id LIMIT 3`, today);
  let nextDay = null;
  for (const [i, d] of upcoming.entries()) {
    const ov = await dayOverview(env, d);
    if (i === 0) nextDay = { id: d.id, name: d.name, reward_date: d.reward_date, status: d.status, ...ov };
    if (ov.shortfall > 0) banners.push({ kind: 'danger', text: `${ov.shortfall} non-qualifier${ov.shortfall === 1 ? '' : 's'} won't have a room for ${d.name}. Add room capacity.`, link: '#/rewards', link_text: 'Open Rewards Day' });
    else if (ov.nonqualifiers_unassigned > 0) banners.push({ kind: 'warn', text: `${ov.nonqualifiers_unassigned} non-qualifier${ov.nonqualifiers_unassigned === 1 ? '' : 's'} not yet assigned a room for ${d.name}.`, link: '#/rewards', link_text: 'Assign rooms' });
    const low = await all(env,
      `SELECT a.name, a.capacity, (SELECT COUNT(*) FROM reward_bookings b WHERE b.activity_id = a.id AND b.status = 'confirmed') AS taken
         FROM reward_activities a WHERE a.reward_day_id = ? AND a.kind = 'regular'`, d.id);
    const nearlyFull = low.filter((a) => a.capacity - a.taken <= Math.ceil(a.capacity * 0.1) && a.capacity - a.taken > 0);
    if (nearlyFull.length) banners.push({ kind: 'info', text: `${nearlyFull.length} activit${nearlyFull.length === 1 ? 'y has' : 'ies have'} 10% or fewer seats left for ${d.name}.`, link: '#/rewards', link_text: 'See activities' });
  }

  const enrolled = await all(env, 'SELECT grade, COUNT(*) AS n FROM students WHERE active = 1 GROUP BY grade');
  return { year, from, to, steps, periods: periodGrid, p5: { ...p5, by_category: byCat, top_category: top && top.points > 0 ? top : null }, banners, next_day: nextDay, enrolled };
});

add('GET', '/api/reports/monthly', 'staff', async ({ env, url }) => {
  const today = todayStr(env);
  const current = schoolYearOf(today);
  const year = url.searchParams.get('year') || current;
  const years = [shiftSchoolYear(year, -2), shiftSchoolYear(year, -1), year];
  const grade = url.searchParams.get('grade') ? V.int(url.searchParams.get('grade'), 'grade', { min: 6, max: 8 }) : null;
  const step = url.searchParams.get('step') ? V.int(url.searchParams.get('step'), 'step', { min: 1, max: 5 }) : null;
  const metric = V.oneOf(url.searchParams.get('metric') || 'events', 'metric', ['events', 'students']);
  const where = [`t.school_year IN (?,?,?)`];
  const p = [...years];
  if (grade) { where.push('s.grade = ?'); p.push(grade); }
  if (step) { where.push('t.step_level = ?'); p.push(step); }
  const rows = await all(env,
    `SELECT t.school_year AS sy, CAST(substr(t.step_date, 6, 2) AS INTEGER) AS m,
            COUNT(*) AS events, COUNT(DISTINCT t.student_id) AS students
       FROM steps t JOIN students s ON s.student_id = t.student_id
      WHERE ${where.join(' AND ')} GROUP BY sy, m`, ...p);
  const todayMonth = Number(today.slice(5, 7));
  const data = {};
  const has = {};
  for (const y of years) {
    data[y] = {};
    has[y] = rows.some((r) => r.sy === y);
    for (const m of MONTHS) {
      const hit = rows.find((r) => r.sy === y && r.m === m);
      let v = hit ? hit[metric] : 0;
      if (y === current) {
        // Months that haven't happened yet in the current year stay blank.
        const idx = MONTHS.indexOf(m), nowIdx = MONTHS.indexOf(todayMonth);
        if (nowIdx >= 0 && idx > nowIdx) v = null;
        else if (nowIdx < 0 && m !== 8) v = idx > MONTHS.indexOf(6) ? null : v; // July: show everything so far
      }
      data[y][m] = v;
    }
  }
  const totals = Object.fromEntries(years.map((y) => [y, rows.filter((r) => r.sy === y).reduce((n, r) => n + r.events, 0)]));
  return { years, months: MONTHS, data, has_data: has, totals, metric, grade, step };
});

add('GET', '/api/reports/reward-day', 'staff', async ({ env, url }) => {
  const settings = await getSettings(env);
  let start, end, period = null;
  if (url.searchParams.get('period_id')) {
    period = await one(env, 'SELECT * FROM reward_periods WHERE id = ?', V.int(url.searchParams.get('period_id'), 'period', { min: 1 }));
    if (!period) throw bad('Reward period not found.');
    start = period.start_date; end = period.end_date;
  } else {
    start = V.date(url.searchParams.get('start'), 'Start date');
    end = V.date(url.searchParams.get('end'), 'End date');
    if (end < start) throw bad('End date must be on or after the start date.');
  }
  const list = await liveNonquals(env, start, end, settings);
  let day = null;
  const assigned = new Map();
  if (period) {
    day = await one(env, 'SELECT id, name, reward_date, status, qualification_locked_at FROM reward_days WHERE reward_period_id = ? ORDER BY reward_date DESC LIMIT 1', period.id);
    if (day) {
      for (const r of await all(env,
        `SELECT b.student_id, a.name, a.location FROM reward_bookings b JOIN reward_activities a ON a.id = b.activity_id
          WHERE b.reward_day_id = ? AND b.status = 'confirmed' AND a.kind = 'nonqual'`, day.id)) {
        assigned.set(r.student_id, r.location ? `${r.name} (${r.location})` : r.name);
      }
    }
  }
  const grades = { 6: [], 7: [], 8: [] };
  for (const r of list) {
    grades[r.grade].push({
      student_id: r.student_id, last_name: r.last_name, first_name: r.first_name,
      homeroom_teacher: r.homeroom_teacher, room: r.room, why: r.why,
      highest_step: r.hi, step_count: r.n, assigned_room: assigned.get(r.student_id) || null,
    });
  }
  return {
    start, end, period: period && { id: period.id, name: period.name }, reward_day: day,
    rule: { min_step: settings.nonqual_min_step, step1_count: settings.nonqual_step1_count },
    counts: { 6: grades[6].length, 7: grades[7].length, 8: grades[8].length, total: list.length },
    grades,
  };
});
