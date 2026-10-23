// Local test server: the real Worker + a SQLite-backed D1 shim + the public/ folder.
// Seeds FAKE data so the screens can be exercised in a browser. Not used in production.
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Shim } from './d1shim.mjs';
import worker from '../src/worker.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const db = new D1Shim();
for (const f of readdirSync(join(root, 'migrations')).sort()) db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain', '.svg': 'image/svg+xml' };
const PUB = join(root, 'public');
const env = {
  DB: db, PEPPER: 'e2e-pepper-e2e-pepper-e2e-pepper-123456', SETUP_TOKEN: 'e2e-setup-token-123456', TIMEZONE: 'America/Los_Angeles', PBKDF2_ITERATIONS: '10000',
  ASSETS: {
    async fetch(req) {
      let p = new URL(req.url).pathname;
      if (p === '/') p = '/index.html';
      const full = resolve(PUB, '.' + p);
      if (!full.startsWith(PUB + sep) || !existsSync(full) || !statSync(full).isFile()) return new Response('Not found', { status: 404 });
      return new Response(readFileSync(full), { headers: { 'content-type': TYPES[extname(full)] || 'application/octet-stream' } });
    },
  },
};

const base = `http://localhost:${PORT}`;
async function call(cookie, method, path, body) {
  const headers = { origin: base };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await worker.fetch(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const t = await res.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${t}`);
  return { data: d, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

// ---- seed ----
const ADMIN = { email: 'admin@example.org', password: 'admin-password-123' };
await call(null, 'POST', '/api/setup', { token: env.SETUP_TOKEN, email: ADMIN.email, name: 'Alex Admin', password: ADMIN.password });
const admin = await call(null, 'POST', '/api/login', { kind: 'staff', email: ADMIN.email, password: ADMIN.password });
const A = admin.cookie;
await call(A, 'POST', '/api/admin/users', { email: 'teacher@example.org', name: 'Tina Teacher', role: 'teacher', password: 'teacher-password-123' });
await call(A, 'PUT', '/api/admin/settings', { school_name: 'Example Middle School', nonqual_min_step: 2, nonqual_step1_count: 2, teacher_max_p5: 10, allow_negative_balance: true, code_label: 'Code' });

const first = ['Ava', 'Ben', 'Cal', 'Dia', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai', 'Lia', 'Max', 'Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol', 'Tia'];
const last = ['Adams', 'Brooks', 'Cruz', 'Diaz', 'Ellis', 'Ford', 'Gray', 'Hill', 'Ito', 'Jones', 'Khan', 'Lopez', 'Mills', 'Ng', 'Ortiz', 'Park', 'Quinn', 'Reed', 'Shah', 'Tran'];
const rows = [];
for (const g of [6, 7, 8]) for (let i = 0; i < 20; i++) rows.push({ student_id: g * 1000 + i + 1, last_name: last[(i * 7 + g) % 20] + (i > 9 ? 'son' : ''), first_name: first[i], grade: g, homeroom_teacher: ['Hoskins', 'Garcia', 'Avila'][g - 6], room: String(10 + g) });
await call(A, 'POST', '/api/admin/students/import', { rows });
const pins = (await call(A, 'POST', '/api/admin/pins', { scope: 'missing' })).data.pins;

const rnd = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const stepRows = [];
const dates = { '2024-25': ['2024-09-10', '2024-10-08', '2024-11-12', '2025-01-21', '2025-02-11', '2025-03-18', '2025-04-15'], '2025-26': ['2025-09-09', '2025-10-14', '2025-11-11', '2025-12-09', '2026-01-20', '2026-02-10', '2026-03-17', '2026-04-14'], '2026-27': ['2026-08-20', '2026-09-08', '2026-09-22', '2026-10-06', '2026-10-13', '2026-10-20'] };
for (const [sy, ds] of Object.entries(dates)) {
  const mult = sy === '2026-27' ? 0.9 : sy === '2025-26' ? 1.3 : 1.0;
  for (const r of rows) for (const d of ds) if (rnd() < 0.16 * mult) { const lvl = rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : rnd() < 0.7 ? 3 : 4; stepRows.push({ student_id: r.student_id, step_level: lvl, step_date: d, teacher: 'Hoskins', code: String(1 + Math.floor(rnd() * 5)) }); }
}
await call(A, 'POST', '/api/admin/steps/import', { rows: stepRows });
await call(A, 'POST', '/api/reward-periods', { name: 'Rewards 1', start_date: '2026-08-12', end_date: '2026-09-25' });
await call(A, 'POST', '/api/reward-periods', { name: 'Rewards 2', start_date: '2026-09-28', end_date: '2026-11-06' });
const periods = (await call(A, 'GET', '/api/reward-periods?year=2026-27')).data.periods;
const ids = rows.map((r) => r.student_id);
for (const n of [5, 3, 8]) await call(A, 'POST', '/api/p5', { mode: 'award', student_ids: ids, category_id: 1 + (n % 5), amount: n });
await call(A, 'POST', '/api/p5', { mode: 'award', student_ids: ids.slice(0, 30), category_id: 3, amount: 25 });
const now = Date.now();
await call(A, 'POST', '/api/reward-days', { name: 'Fall Rewards Day', reward_date: '2026-11-13', reward_period_id: periods.find((p) => p.name === 'Rewards 2').id, booking_opens_at: new Date(now - 36e5).toISOString(), booking_closes_at: new Date(now + 5 * 864e5).toISOString() });
const days = (await call(A, 'GET', '/api/reward-days')).data.days;
const dayId = days[0].id;
for (const a of [{ name: 'Movie in the gym', location: 'Gym', capacity: 40, p5_cost: 10, description: 'Popcorn and a PG movie.' }, { name: 'Coloring', location: 'Room 5', capacity: 20, p5_cost: 0, description: 'Calm music and coloring pages.' }, { name: 'Board games', location: 'Library', capacity: 12, p5_cost: 5, allowed_grades: [6, 7] }]) await call(A, 'POST', `/api/reward-days/${dayId}/activities`, { ...a, kind: 'regular' });
for (const a of [{ name: 'Study hall A', location: 'Room 12', capacity: 15 }, { name: 'Study hall B', location: 'Room 13', capacity: 15 }]) await call(A, 'POST', `/api/reward-days/${dayId}/activities`, { ...a, kind: 'nonqual' });
await call(A, 'PATCH', `/api/reward-days/${dayId}`, { status: 'open' });
await call(A, 'POST', `/api/reward-days/${dayId}/auto-assign`, {});

writeFileSync('/tmp/e2e.json', JSON.stringify({ base, admin: ADMIN, teacher: { email: 'teacher@example.org', password: 'teacher-password-123' }, pins, firstStudent: rows[0].student_id }));

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request(base + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const out = await worker.fetch(request, env);
  const headers = {};
  out.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const sc = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
  if (sc.length) headers['set-cookie'] = sc;
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => console.log('ready ' + base));
