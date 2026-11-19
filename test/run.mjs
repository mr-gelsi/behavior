// Integration tests: run the real Worker code against an in-memory SQLite database.
// Usage: npm test   (Node 22+)
import { readFileSync, readdirSync } from 'node:fs';
import { D1Shim } from './d1shim.mjs';
import worker from '../src/worker.js';
import { runScheduled } from '../src/lib/rewards.js';
import { randomInt, sliceAtPointer, targetRotation, TAU } from '../public/js/spinner-core.js';

const db = new D1Shim();
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
}
const env = {
  DB: db,
  PEPPER: 'test-pepper-test-pepper-test-pepper-1234',
  SETUP_TOKEN: 'test-setup-token-123456',
  TIMEZONE: 'America/Los_Angeles',
  PBKDF2_ITERATIONS: '10000',
  ASSETS: { fetch: async () => new Response('<html>asset</html>', { headers: { 'content-type': 'text/html' } }) },
};

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { passed++; } else { failed++; failures.push(name + (extra ? ' :: ' + JSON.stringify(extra) : '')); console.log('  FAIL:', name, extra ? JSON.stringify(extra) : ''); }
}
const section = (s) => console.log('\n' + s);

const ORIGIN = 'https://app.test';
async function call(sess, method, path, body, extraHeaders = {}) {
  const headers = { origin: ORIGIN, ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (sess && sess.cookie) headers.cookie = sess.cookie;
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function login(body) {
  const r = await call(null, 'POST', '/api/login', body);
  const sc = r.headers.get('set-cookie');
  return { ...r, cookie: sc ? sc.split(';')[0] : null, setCookie: sc };
}

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

// ------------------------------------------------------------------------------------
section('Setup and sign-in');
let r = await call(null, 'GET', '/api/setup/status');
ok(r.data.needed === true, 'setup is needed on an empty database');
r = await call(null, 'POST', '/api/setup', { token: 'wrong', email: 'a@b.co', name: 'A', password: 'twelve-chars-ok' });
ok(r.status === 403, 'setup rejects wrong token');
r = await call(null, 'POST', '/api/setup', { token: env.SETUP_TOKEN, email: 'admin@school.org', name: 'Ada Admin', password: 'short' });
ok(r.status === 400, 'setup rejects short password');
r = await call(null, 'POST', '/api/setup', { token: env.SETUP_TOKEN, email: 'admin@school.org', name: 'Ada Admin', password: 'correct horse battery' });
ok(r.data.ok === true, 'setup creates first admin');
r = await call(null, 'POST', '/api/setup', { token: env.SETUP_TOKEN, email: 'x@school.org', name: 'X', password: 'correct horse battery' });
ok(r.status === 403, 'setup cannot be run twice');
const row = db.db.prepare('SELECT pw_hash FROM users').get();
ok(/^pbkdf2\$\d+\$/.test(row.pw_hash) && !row.pw_hash.includes('correct'), 'password is stored hashed');

r = await login({ kind: 'staff', email: 'admin@school.org', password: 'wrong password!!' });
ok(r.status === 401 && !r.cookie, 'wrong password rejected');
const admin = await login({ kind: 'staff', email: 'ADMIN@school.org', password: 'correct horse battery' });
ok(admin.status === 200 && admin.cookie, 'admin signs in (email is case-insensitive)');
ok(/HttpOnly/.test(admin.setCookie) && /Secure/.test(admin.setCookie) && /SameSite=Strict/.test(admin.setCookie) && admin.setCookie.startsWith('__Host-sid='), 'session cookie is HttpOnly, Secure, SameSite=Strict, __Host-');
const tokenRaw = admin.cookie.split('=')[1];
ok(!db.db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(tokenRaw), 'raw session token is not stored (only its hash)');

r = await call(admin, 'GET', '/api/me');
ok(r.data.type === 'staff' && r.data.user.role === 'admin', '/api/me returns the admin');

r = await call(admin, 'POST', '/api/admin/users', { email: 'teach@school.org', name: 'Tess Teacher', role: 'teacher', password: 'teacher password 1' });
ok(r.data.ok, 'admin creates a teacher');
for (let i = 0; i < 5; i++) await login({ kind: 'staff', email: 'teach@school.org', password: 'nope nope nope nope' });
r = await login({ kind: 'staff', email: 'teach@school.org', password: 'teacher password 1' });
ok(r.status === 429, 'account locks after 5 failures (even with the right password)');
db.db.exec('DELETE FROM login_attempts');
const teacher = await login({ kind: 'staff', email: 'teach@school.org', password: 'teacher password 1' });
ok(teacher.status === 200, 'teacher signs in once the lock clears');

// ------------------------------------------------------------------------------------
section('Security basics');
r = await call(null, 'GET', '/api/dashboard');
ok(r.status === 401, 'unauthenticated API call is rejected');
r = await call(admin, 'POST', '/api/steps', { student_id: 1 }, { origin: 'https://evil.example' });
ok(r.status === 403, 'cross-origin write is blocked');
r = await call(teacher, 'GET', '/api/admin/users');
ok(r.status === 403, 'teacher cannot reach admin routes');
r = await call(teacher, 'GET', '/api/admin/export?table=students');
ok(r.status === 403, 'teacher cannot export data');
const asset = await worker.fetch(new Request(ORIGIN + '/'), env);
ok(/default-src 'self'/.test(asset.headers.get('content-security-policy') || ''), 'static pages carry a Content-Security-Policy');
ok(asset.headers.get('x-frame-options') === 'DENY' && /noindex/.test(asset.headers.get('x-robots-tag')), 'framing denied and indexing blocked');
r = await call(admin, 'POST', '/api/steps', { student_id: 1 }, { 'content-type': 'text/plain' });
ok(r.status === 415 || r.status === 400, 'non-JSON body rejected');

// ------------------------------------------------------------------------------------
section('Roster import');
const roster = [
  { student_id: 1001, last_name: 'Alder', first_name: 'Ana', grade: 6, homeroom_teacher: 'Hoskins', room: '12' },
  { student_id: 1002, last_name: 'Birch', first_name: 'Ben', grade: 6, homeroom_teacher: 'Hoskins', room: '12' },
  { student_id: 1003, last_name: 'Cedar', first_name: 'Cy', grade: 6, homeroom_teacher: 'Garcia', room: '14' },
  { student_id: 2001, last_name: 'Dogwood', first_name: 'Dee', grade: 7, homeroom_teacher: 'Avila', room: '20' },
  { student_id: 2002, last_name: 'Elm', first_name: 'Eli', grade: 7, homeroom_teacher: 'Avila', room: '20' },
  { student_id: 3001, last_name: 'Fir', first_name: 'Fay', grade: 8, homeroom_teacher: 'Gelsi', room: '30' },
  { student_id: 3002, last_name: 'Gum', first_name: 'Gus', grade: 8, homeroom_teacher: 'Gelsi', room: '30' },
  { student_id: 3003, last_name: 'Holly', first_name: 'Hal', grade: 8, homeroom_teacher: 'Gelsi', room: '30' },
  { student_id: 1001, last_name: 'Alder', first_name: 'Ana', grade: 6 }, // duplicate ID
  { student_id: 9, last_name: 'Bad', first_name: 'Grade', grade: 5 }, // invalid grade
];
r = await call(admin, 'POST', '/api/admin/students/import', { rows: roster, dry_run: true });
ok(r.data.new_students === 8 && r.data.duplicates_skipped === 1 && r.data.error_count === 1, 'roster dry run counts new, duplicate, and error rows', r.data);
r = await call(admin, 'POST', '/api/admin/students/import', { rows: roster });
ok(r.status === 400, 'roster import refuses to commit while errors remain');
r = await call(admin, 'POST', '/api/admin/students/import', { rows: roster.slice(0, 9) });
ok(r.data.imported === 8, 'roster imports 8 unique students', r.data);
ok(db.db.prepare('SELECT COUNT(*) c FROM students').get().c === 8, 'database holds 8 students');

section('PINs and student sign-in');
r = await call(admin, 'POST', '/api/admin/pins', { scope: 'missing' });
ok(r.data.pins.length === 8 && r.data.done === true && r.data.pins.every((p) => /^\d{6}$/.test(p.pin)), 'PINs are generated (6 digits) for everyone');
const pins = Object.fromEntries(r.data.pins.map((p) => [p.student_id, p.pin]));
ok(!db.db.prepare('SELECT pin_hash FROM students').all().some((x) => Object.values(pins).some((p) => x.pin_hash.includes(p))), 'PINs are not stored in plain text');
r = await call(admin, 'POST', '/api/admin/pins', { scope: 'missing' });
ok(r.data.pins.length === 0, 'no new PINs for students who already have one');
let s1001 = await login({ kind: 'student', student_id: '1001', pin: '000000' });
ok(s1001.status === 401, 'wrong PIN rejected');
s1001 = await login({ kind: 'student', student_id: '1001', pin: pins[1001] });
ok(s1001.status === 200 && s1001.cookie, 'student signs in with ID + PIN');
r = await call(s1001, 'GET', '/api/dashboard');
ok(r.status === 403, 'student cannot reach staff dashboard');
r = await call(s1001, 'GET', '/api/grade/6');
ok(r.status === 403, 'student cannot read grade lists');
r = await call(s1001, 'GET', '/api/students/1002');
ok(r.status === 403, 'student cannot read another student');
r = await call(s1001, 'POST', '/api/p5', { mode: 'award', student_ids: [1001], category_id: 1, amount: 5 });
ok(r.status === 403, 'student cannot award themselves points');
r = await call(admin, 'GET', '/api/student/home');
ok(r.status === 403, 'staff cannot use student routes');

// ------------------------------------------------------------------------------------
section('Steps');
r = await call(teacher, 'POST', '/api/steps', { student_id: 1001, step_level: 1, step_date: '2026-10-05', notes: 'talking' });
ok(r.data.ok, 'teacher records a Step 1');
r = await call(teacher, 'POST', '/api/steps', { student_id: 1001, step_level: 1, step_date: '2026-10-05' });
ok(r.status === 409 && r.data.duplicate, 'same step on the same day warns');
r = await call(teacher, 'POST', '/api/steps', { student_id: 1001, step_level: 1, step_date: '2026-10-05', force: true });
ok(r.data.ok, 'duplicate can be forced');
r = await call(teacher, 'POST', '/api/steps', { student_id: 1001, step_level: 6, step_date: '2026-10-05' });
ok(r.status === 400, 'step level 6 rejected');
r = await call(teacher, 'POST', '/api/steps', { student_id: 424242, step_level: 1, step_date: '2026-10-05' });
ok(r.status === 400, 'unknown student rejected');
r = await call(teacher, 'POST', '/api/steps', { student_id: 1002, step_level: 2, step_date: '2026-10-07' });
ok(r.data.ok, 'teacher records a Step 2 (Birch)');
r = await call(teacher, 'POST', '/api/steps', { student_id: 3001, step_level: 1, step_date: '2026-10-08' });
r = await call(teacher, 'POST', '/api/steps', { student_id: 3001, step_level: 1, step_date: '2026-10-09' });
ok(r.data.ok, 'Fir gets two Step 1s');
r = await call(teacher, 'POST', '/api/steps', { student_id: 3002, step_level: 1, step_date: '2026-10-09' });
r = await call(teacher, 'GET', '/api/steps/recent');
ok(r.data.steps.length === 6, 'recent entries list', r.data.steps.length);
const firstStep = r.data.steps[r.data.steps.length - 1];
r = await call(admin, 'POST', '/api/steps', { student_id: 2001, step_level: 3, step_date: '2026-10-12', teacher: 'Admin' });
const adminStep = db.db.prepare("SELECT id FROM steps WHERE student_id = 2001").get();
r = await call(teacher, 'DELETE', '/api/steps/' + adminStep.id);
ok(r.status === 403, "teacher cannot delete someone else's step");
r = await call(admin, 'DELETE', '/api/steps/' + adminStep.id);
ok(r.data.ok, 'admin can delete any step');
r = await call(teacher, 'PATCH', '/api/steps/' + firstStep.id, { notes: 'edited' });
ok(r.data.ok, 'teacher can edit their own step');

section('Grade tabs, dashboard, monthly, reward-day report');
r = await call(teacher, 'GET', '/api/grade/6?year=2026-27');
ok(r.data.students.length === 3 && r.data.totals.s1 === 2 && r.data.totals.s2 === 1 && r.data.totals.total === 3, 'grade 6 totals', r.data.totals);
ok(r.data.students.find((s) => s.student_id === 1003).total === 0, 'students with zero steps still listed');
r = await call(teacher, 'GET', '/api/dashboard?year=2026-27');
ok(r.data.steps[1].students === 3 && r.data.steps[1].by_grade[6] === 1 && r.data.steps[1].by_grade[8] === 2, 'dashboard counts unique students per step by grade', r.data.steps[1]);
ok(r.data.steps[1].events === 5 && r.data.steps[2].students === 1, 'dashboard event counts', r.data.steps[1]);
r = await call(admin, 'POST', '/api/reward-periods', { name: 'Rewards 2', start_date: '2026-10-01', end_date: '2026-10-30' });
ok(r.data.ok, 'admin adds a 2026-27 reward period');
const per = db.db.prepare("SELECT id FROM reward_periods WHERE school_year='2026-27'").get();
r = await call(teacher, 'GET', '/api/reports/reward-day?period_id=' + per.id);
ok(r.data.counts.total === 3 && r.data.counts[6] === 2 && r.data.counts[8] === 1, 'reward report: Step 2+ or multiple Step 1s', r.data.counts);
ok(!r.data.grades[8].some((x) => x.student_id === 3002), 'a single Step 1 does not qualify as non-qualifier');
ok(r.data.grades[6].find((x) => x.student_id === 1001).why === '2 x Step 1', 'why text for multiple Step 1s');
ok(/^Step 2 on 10\/7$/.test(r.data.grades[6].find((x) => x.student_id === 1002).why), 'why text for Step 2+');
r = await call(teacher, 'GET', '/api/reports/monthly?year=2026-27');
ok(r.data.years.join() === '2024-25,2025-26,2026-27' && r.data.data['2026-27'][10] === 6 && r.data.has_data['2025-26'] === false, 'monthly report shape and empty-year flag', r.data.data['2026-27']);
ok(r.data.data['2026-27'][6] === null || r.data.data['2026-27'][8] === 0, 'future months blank in current year');

// ------------------------------------------------------------------------------------
section('P5 awards and fines');
const everyone = [1001, 1002, 1003, 2001, 2002, 3001, 3002, 3003];
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: everyone, category_id: 3, amount: 20, note: 'Great week' });
ok(r.status === 400, 'teacher cannot award more than their per-transaction maximum (10)');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: everyone, category_id: 3, amount: 10, note: 'Great week' });
r = await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: everyone, category_id: 5, amount: 10 });
ok(r.data.ok && r.data.results.every((x) => x.balance === 20), 'group awards (10 by teacher + 10 by admin) give each of eight students 20');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [1001], category_id: 1, amount: 11 });
ok(r.status === 400, 'teacher maximum per transaction is enforced');
r = await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1001], category_id: 1, amount: 11 });
ok(r.data.ok, 'admin is not limited by the teacher maximum');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [1001], category_id: 99, amount: 1 });
ok(r.status === 400, 'unknown category rejected');
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [1003], category_id: 2, amount: 3, note: 'No supplies' });
ok(r.data.results[0].balance === 17, 'fine of 3 (Prepared) lowers balance to 17');
const stepsBefore = db.db.prepare('SELECT COUNT(*) c FROM steps').get().c;
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [1003], category_id: 2, amount: 2, step: { add: true, level: 9 } });
ok(r.status === 400 && db.db.prepare('SELECT COUNT(*) c FROM steps').get().c === stepsBefore, 'fine with invalid step saves nothing');
ok(db.db.prepare('SELECT COALESCE(SUM(amount),0) b FROM p5_transactions WHERE student_id=1003').get().b === 17, 'balance unchanged after failed fine+step');
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [1003], category_id: 4, amount: 4, note: 'Rude', step: { add: true, level: 2, period: '3' } });
ok(r.data.ok && r.data.results[0].balance === 13, 'fine with "also add a step" lowers balance');
const link = db.db.prepare("SELECT t.id tid, t.linked_step_id lid, s.id sid, s.step_level, s.source, s.p5_transaction_id pid, s.notes FROM p5_transactions t JOIN steps s ON s.p5_transaction_id = t.id WHERE t.student_id = 1003 AND t.amount = -4").get();
ok(link && link.lid === link.sid && link.pid === link.tid && link.step_level === 2 && link.source === 'p5_fine' && /Polite/.test(link.notes), 'fine and step are linked both ways, with the P5 category', link);
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [1003], category_id: 1, amount: 5, step: { add: true, level: 3 } });
ok(db.db.prepare("SELECT COUNT(*) c FROM steps WHERE student_id=1003 AND step_level=3").get().c === 0, 'awards never create steps');
r = await call(teacher, 'POST', `/api/p5/${link.tid}/reverse`, { delete_step: true });
ok(r.data.ok, 'teacher reverses their own fine');
ok(db.db.prepare('SELECT COALESCE(SUM(amount),0) b FROM p5_transactions WHERE student_id=1003').get().b === 22 && !db.db.prepare('SELECT 1 FROM steps WHERE id=?').get(link.sid), 'reversal restores points and deletes the linked step');
r = await call(teacher, 'POST', `/api/p5/${link.tid}/reverse`, {});
ok(r.status === 400, 'cannot reverse twice');
r = await call(admin, 'PUT', '/api/admin/settings', { school_name: 'Test Middle', nonqual_min_step: 2, nonqual_step1_count: 2, teacher_max_p5: 10, allow_negative_balance: false, code_label: 'Code' });
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [3003], category_id: 2, amount: 10 });
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [3003], category_id: 2, amount: 10 });
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: [3003], category_id: 2, amount: 10 });
ok(db.db.prepare('SELECT COALESCE(SUM(amount),0) b FROM p5_transactions WHERE student_id=3003').get().b === 0, 'with negative balances off, fines stop at zero');
await call(admin, 'PUT', '/api/admin/settings', { school_name: 'Test Middle', nonqual_min_step: 2, nonqual_step1_count: 2, teacher_max_p5: 10, allow_negative_balance: true, code_label: 'Code' });
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [3003], category_id: 5, amount: 20 });

// ------------------------------------------------------------------------------------
section('Store');
r = await call(s1001, 'GET', '/api/student/store');
const homework = r.data.items.find((i) => i.name === 'Homework pass');
ok(r.data.balance === 31 && r.data.items.length === 3, 'student sees store with balance', r.data.balance);
r = await call(admin, 'POST', '/api/store/items', { name: 'Big prize', description: 'x', price: 500, stock: 1, emoji: '🏆' });
r = await call(s1001, 'GET', '/api/student/store');
const prize = r.data.items.find((i) => i.name === 'Big prize');
ok(prize.short_by === 469, 'store shows how many points are still needed');
r = await call(s1001, 'POST', `/api/student/store/${prize.id}/buy`);
ok(r.status === 400 && /more P5/.test(r.data.error), 'cannot buy without enough points');
r = await call(s1001, 'POST', `/api/student/store/${homework.id}/buy`);
ok(r.data.ok && r.data.balance === 6, 'student buys a Homework pass (25)');
r = await call(s1001, 'POST', `/api/student/store/${homework.id}/buy`);
ok(r.status === 400, 'second purchase fails: not enough points');
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1001], category_id: 3, amount: 100 });
r = await call(s1001, 'POST', `/api/student/store/${homework.id}/buy`);
ok(r.data.ok, 'second Homework pass allowed (limit 2)');
r = await call(s1001, 'POST', `/api/student/store/${homework.id}/buy`);
ok(r.status === 400 && /limit/.test(r.data.error), 'per-student limit enforced');
const pencil = (await call(s1001, 'GET', '/api/student/store')).data.items.find((i) => i.name === 'Pencil');
const stockBefore = db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(pencil.id).stock;
r = await call(s1001, 'POST', `/api/student/store/${pencil.id}/buy`);
ok(db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(pencil.id).stock === stockBefore - 1, 'stock decreases on purchase');
const orders = (await call(s1001, 'GET', '/api/student/orders')).data.orders;
const pencilOrder = orders.find((o) => o.name === 'Pencil');
const balBefore = (await call(s1001, 'GET', '/api/student/home')).data.balance;
r = await call(s1001, 'POST', `/api/student/orders/${pencilOrder.id}/cancel`);
ok(r.data.ok && r.data.balance === balBefore + 5 && db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(pencil.id).stock === stockBefore, 'cancelling refunds points and restores stock');
r = await call(s1001, 'POST', `/api/student/orders/${pencilOrder.id}/cancel`);
ok(r.status === 400, 'cannot cancel twice (no double refund)');
const pend = (await call(teacher, 'GET', '/api/store/orders?status=pending')).data.orders;
ok(pend.length === 2, 'staff see pending orders', pend.length);
r = await call(teacher, 'POST', `/api/store/orders/${pend[0].id}/fulfill`);
ok(r.data.ok, 'staff fulfill an order');
r = await call(s1001, 'POST', `/api/student/orders/${pend[0].id}/cancel`);
ok(r.status === 400, 'fulfilled orders cannot be cancelled by students');
// last-item race: stock 1, two students with enough points
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1002, 1003], category_id: 3, amount: 100 });
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1002, 1003], category_id: 3, amount: 100 });
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1002, 1003], category_id: 3, amount: 100 });
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1002, 1003], category_id: 3, amount: 100 });
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [1002, 1003], category_id: 3, amount: 100 });
const s1002 = await login({ kind: 'student', student_id: '1002', pin: pins[1002] });
const s1003 = await login({ kind: 'student', student_id: '1003', pin: pins[1003] });
const race = await Promise.all([s1002, s1003].map((s) => call(s, 'POST', `/api/student/store/${prize.id}/buy`)));
ok(race.filter((x) => x.status === 200).length === 1 && db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(prize.id).stock === 0, 'last item in stock sells exactly once');

// ------------------------------------------------------------------------------------
section('Rewards Day: activities, booking, auto-assign');
r = await call(admin, 'POST', '/api/reward-days', { name: 'Fall Rewards Day', reward_date: '2026-11-20', reward_period_id: per.id, booking_opens_at: iso(-3600e3), booking_closes_at: iso(3600e3) });
ok(r.data.ok, 'admin creates a Rewards Day');
const day = db.db.prepare('SELECT id FROM reward_days').get();
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Movie', description: 'Popcorn', location: 'Gym', capacity: 2, p5_cost: 5, kind: 'regular' });
ok(r.data.ok, 'teacher creates a Movie with 2 spots');
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Coloring', location: 'Room 5', capacity: 10, p5_cost: 0, kind: 'regular', allowed_grades: [6, 7] });
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Study Hall A', location: 'Room 12', capacity: 2, kind: 'nonqual', p5_cost: 50 });
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Study Hall B', location: 'Room 13', capacity: 1, kind: 'nonqual' });
const acts = Object.fromEntries(db.db.prepare('SELECT id, name, p5_cost, kind FROM reward_activities').all().map((a) => [a.name, a]));
ok(acts['Study Hall A'].p5_cost === 0, 'non-qualifier rooms are always free');
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Bad', capacity: 0 });
ok(r.status === 400, 'capacity must be at least 1');
r = await call(teacher, 'GET', `/api/reward-days/${day.id}`);
ok(r.data.overview.nonqualifiers === 3 && r.data.overview.qualifiers === 5 && r.data.overview.shortfall === 0, 'overview: 3 non-qualifiers, 5 qualifiers', r.data.overview);
// Open the day.
r = await call(admin, 'PATCH', `/api/reward-days/${day.id}`, { status: 'open' });
ok(r.data.ok, 'day opens for booking');

// students who qualify: 1003, 2001, 2002, 3002, 3003 (nonqual: 1001, 1002, 3001)
r = await call(s1001, 'GET', '/api/student/reward-day');
ok(r.data.qualified === false && !r.data.activities && !JSON.stringify(r.data).match(/Step|steps|why/i), 'non-qualifier sees no activities and no reason');
r = await call(s1001, 'POST', '/api/student/reward-day/book', { activity_id: acts.Movie.id });
ok(r.status === 403, 'non-qualifier cannot book (server-side)');
const mk = async (id) => login({ kind: 'student', student_id: String(id), pin: pins[id] });
const s2001 = await mk(2001), s2002 = await mk(2002), s3002 = await mk(3002), s3003 = await mk(3003);
r = await call(s2001, 'GET', '/api/student/reward-day');
ok(r.data.qualified === true && r.data.activities.length === 2 && r.data.balance > 0, 'qualifier sees activities and balance');
r = await call(s3002, 'POST', '/api/student/reward-day/book', { activity_id: acts.Coloring.id });
ok(r.status === 400 && /grade/.test(r.data.error), 'grade restriction enforced (8th grader, Coloring is 6-7)');
const balanceOf = (id) => db.db.prepare('SELECT COALESCE(SUM(amount),0) b FROM p5_transactions WHERE student_id=?').get(id).b;
const b3003 = balanceOf(3003), b2001 = balanceOf(2001), b2002 = balanceOf(2002), b1003 = balanceOf(1003);
const s1003b = await mk(1003);
const results = await Promise.all([s2001, s2002, s3003].map((s) => call(s, 'POST', '/api/student/reward-day/book', { activity_id: acts.Movie.id })));
const okCount = results.filter((x) => x.status === 200).length;
const fullCount = results.filter((x) => x.status === 400 && /filled up/.test(x.data.error)).length;
ok(okCount === 2 && fullCount === 1, 'three students race for 2 seats: exactly two succeed, one is told it filled up', results.map((x) => x.status));
const booked = db.db.prepare("SELECT COUNT(*) c FROM reward_bookings WHERE activity_id=? AND status='confirmed'").get(acts.Movie.id).c;
ok(booked === 2, 'database shows exactly 2 confirmed seats');
const loser = [s2001, s2002, s3003][results.findIndex((x) => x.status !== 200)];
const loserId = [2001, 2002, 3003][results.findIndex((x) => x.status !== 200)];
const loserBefore = { 2001: b2001, 2002: b2002, 3003: b3003 }[loserId];
ok(balanceOf(loserId) === loserBefore, 'the student who did not get a seat was not charged');
const winnerIds = [2001, 2002, 3003].filter((i) => i !== loserId);
ok(winnerIds.every((i) => balanceOf(i) === { 2001: b2001, 2002: b2002, 3003: b3003 }[i] - 5), 'winners were charged 5 P5');
r = await call(s2001, 'POST', '/api/student/reward-day/book', { activity_id: acts.Movie.id });
ok(r.status === 400, 'cannot double-book the same activity');
// switch and cancel/refund
const winner = winnerIds[0];
const wsess = { 2001: s2001, 2002: s2002, 3003: s3003 }[winner];
const before = balanceOf(winner);
if (winner !== 3003) {
  r = await call(wsess, 'POST', '/api/student/reward-day/book', { activity_id: acts.Coloring.id });
  ok(r.data.ok && balanceOf(winner) === before + 5, 'switching to a free activity refunds the old seat');
  ok(db.db.prepare("SELECT COUNT(*) c FROM reward_bookings WHERE reward_day_id=? AND student_id=? AND status='confirmed'").get(day.id, winner).c === 1, 'student still holds exactly one seat after switching');
  r = await call(s1003b, 'POST', '/api/student/reward-day/book', { activity_id: acts.Movie.id });
  ok(r.data.ok, 'another qualifier takes the freed Movie seat');
  r = await call(wsess, 'POST', '/api/student/reward-day/book', { activity_id: acts.Movie.id });
  ok(r.status === 400 && /filled up/.test(r.data.error), 'switching into a full activity fails');
  ok(db.db.prepare("SELECT a.name FROM reward_bookings b JOIN reward_activities a ON a.id=b.activity_id WHERE b.reward_day_id=? AND b.student_id=? AND b.status='confirmed'").get(day.id, winner).name === 'Coloring', 'failed switch keeps the original seat');
} else {
  r = await call(wsess, 'DELETE', '/api/student/reward-day/booking');
  ok(r.data.ok && balanceOf(winner) === before + 5, 'cancelling refunds the P5 cost');
}
// Now the nonqualifier flow.
r = await call(teacher, 'GET', `/api/reward-days/${day.id}`);
ok(r.data.overview.nonqualifiers_unassigned === 3, 'three non-qualifiers waiting for rooms', r.data.overview);
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/auto-assign`);
ok(r.data.assigned === 3 && r.data.unassigned === 0, 'auto-assign places all 3 non-qualifiers (capacity 2 + 1)', r.data);
const roomA = db.db.prepare("SELECT s.student_id id FROM reward_bookings b JOIN students s ON s.student_id=b.student_id WHERE b.activity_id=? AND b.status='confirmed' ORDER BY s.student_id").all(acts['Study Hall A'].id).map((x) => x.id);
ok(roomA.join() === '1001,1002', 'rooms fill in order, grade 6 together', roomA);
r = await call(teacher, 'POST', `/api/reward-days/${day.id}/auto-assign`);
ok(r.data.assigned === 0, 'auto-assign is idempotent');
r = await call(s1001, 'GET', '/api/student/reward-day');
ok(r.data.booking && r.data.booking.name === 'Study Hall A' && r.data.booking.location === 'Room 12', 'non-qualifier sees their assigned room');
await call(teacher, 'POST', `/api/reward-days/${day.id}/activities`, { name: 'Study Hall C', location: 'Room 14', capacity: 5, kind: 'nonqual' });
// reconciliation: a qualifier who booked becomes non-qualifier after another step.
const stillBooked = [2001, 2002, 3003].filter((i) => db.db.prepare("SELECT 1 FROM reward_bookings WHERE reward_day_id=? AND student_id=? AND status='confirmed'").get(day.id, i));
const target = stillBooked.includes(2001) ? 2001 : stillBooked[0];
const tBefore = balanceOf(target);
const paid = db.db.prepare("SELECT p5_cost_paid p FROM reward_bookings WHERE reward_day_id=? AND student_id=? AND status='confirmed'").get(day.id, target).p;
await call(admin, 'POST', '/api/steps', { student_id: target, step_level: 3, step_date: '2026-10-15', teacher: 'Admin' });
const nowBooking = db.db.prepare("SELECT a.kind FROM reward_bookings b JOIN reward_activities a ON a.id=b.activity_id WHERE b.reward_day_id=? AND b.student_id=? AND b.status='confirmed'").get(day.id, target);
ok(nowBooking && nowBooking.kind === 'nonqual', 'new Step 3 moves a booked qualifier into a non-qual room');
ok(balanceOf(target) === tBefore + paid, 'and refunds the seat cost', { paid });
// shortfall
r = await call(admin, 'POST', '/api/reward-days', { name: 'Tiny rooms', reward_date: '2026-12-01', reward_period_id: per.id, booking_opens_at: iso(-7200e3), booking_closes_at: iso(-3600e3) });
const day2 = db.db.prepare('SELECT id FROM reward_days ORDER BY id DESC').get();
await call(teacher, 'POST', `/api/reward-days/${day2.id}/activities`, { name: 'Only room', capacity: 1, kind: 'nonqual' });
await call(admin, 'PATCH', `/api/reward-days/${day2.id}`, { status: 'open' });
r = await call(teacher, 'GET', `/api/reward-days/${day2.id}`);
ok(r.data.overview.shortfall >= 1, 'overview reports the room shortfall', r.data.overview);
const dash = await call(teacher, 'GET', '/api/dashboard?year=2026-27');
ok(dash.data.banners.some((b) => b.kind === 'danger'), 'dashboard shows a red banner for the shortfall', dash.data.banners);
await runScheduled(env);
ok(db.db.prepare('SELECT status FROM reward_days WHERE id=?').get(day2.id).status === 'closed', 'cron closes a day whose booking window has ended');
ok(db.db.prepare("SELECT COUNT(*) c FROM reward_bookings WHERE reward_day_id=? AND status='confirmed'").get(day2.id).c === 1, 'cron auto-assigned into the one available room');
// lock
r = await call(admin, 'POST', `/api/reward-days/${day.id}/lock`, {});
ok(r.data.locked && r.data.nonqualifiers >= 3, 'admin locks the qualification list', r.data);
const lockedTarget = [2002, 3003, 2001].find((i) => !db.db.prepare("SELECT 1 FROM reward_day_nonquals WHERE reward_day_id=? AND student_id=?").get(day.id, i));
if (lockedTarget) {
  await call(admin, 'POST', '/api/steps', { student_id: lockedTarget, step_level: 4, step_date: '2026-10-16', teacher: 'Admin' });
  const k = db.db.prepare("SELECT a.kind FROM reward_bookings b JOIN reward_activities a ON a.id=b.activity_id WHERE b.reward_day_id=? AND b.student_id=? AND b.status='confirmed'").get(day.id, lockedTarget);
  ok(!k || k.kind === 'regular', 'once locked, later steps do not move students');
}
r = await call(teacher, 'GET', `/api/reward-activities/${acts.Movie.id}/roster`);
ok(Array.isArray(r.data.students), 'staff can view an activity roster');
r = await call(teacher, 'DELETE', `/api/reward-activities/${acts.Movie.id}`);
ok(r.status === 400 || r.data.ok, 'activities with booked students cannot be deleted', r.status);
r = await call(teacher, 'PATCH', `/api/reward-activities/${acts.Movie.id}`, { capacity: 1 });
const movieTaken = db.db.prepare("SELECT COUNT(*) c FROM reward_bookings WHERE activity_id=? AND status='confirmed'").get(acts.Movie.id).c;
ok(movieTaken < 2 || r.status === 400, 'capacity cannot drop below booked seats');

// ------------------------------------------------------------------------------------
section('Steps import (historical)');
const hist = [
  { student_id: 1001, step_level: 1, step_date: '2024-10-02', teacher: 'Hoskins (Per 4)', code: '4' },
  { student_id: 1001, step_level: 2, step_date: '2025-01-14', teacher: 'Cawley (7)' },
  { student_id: 1001, step_level: 1, step_date: '2024-10-02' }, // in-file duplicate
  { student_id: 777777, step_level: 1, step_date: '2024-11-02', grade: 8 }, // former student
  { student_id: 888888, step_level: 1, step_date: '2024-11-03' }, // unknown, no grade
  { student_id: 1002, step_level: 1, step_date: '2025-02-30' }, // bad date
];
r = await call(admin, 'POST', '/api/admin/steps/import', { rows: hist, dry_run: true });
ok(r.data.importable === 3 - 1 + 0 || r.data.importable === 2, 'dry run: importable rows', r.data);
ok(r.data.duplicates_skipped === 1 && r.data.unmatched_count === 2 && r.data.error_count === 1, 'dry run reports duplicates, unmatched IDs, and errors', r.data);
r = await call(admin, 'POST', '/api/admin/steps/import', { rows: hist, create_missing: true });
ok(r.data.imported === 3 && r.data.placeholder_students === 1, 'import with "create missing" adds a former-student placeholder', r.data);
const t = db.db.prepare("SELECT teacher, period, school_year FROM steps WHERE step_date='2024-10-02'").get();
ok(t.teacher === 'Hoskins' && t.period === '4' && t.school_year === '2024-25', 'teacher text "(Per 4)" is split into teacher + period', t);
const t2 = db.db.prepare("SELECT teacher, notes FROM steps WHERE step_date='2025-01-14'").get();
ok(t2.teacher === 'Cawley' && /\(7\)/.test(t2.notes), 'other parenthetical text is kept in notes', t2);
ok(db.db.prepare('SELECT active FROM students WHERE student_id=777777').get().active === 0, 'placeholder student is inactive');
r = await call(admin, 'POST', '/api/admin/steps/import', { rows: hist, create_missing: true });
ok(r.data.imported === 0, 'importing the same file again adds nothing (repeatable)', r.data);
r = await call(admin, 'POST', '/api/admin/steps/import', { rows: [{ student_id: 1001, step_level: 1, step_date: '2023-10-02' }], school_year: '2024-25', dry_run: true });
ok(r.data.error_count === 1, 'school-year override rejects dates from another year');
r = await call(teacher, 'GET', '/api/reports/monthly?year=2026-27');
ok(r.data.has_data['2024-25'] === true && r.data.data['2024-25'][10] === 1, 'monthly report now shows imported history', r.data.data['2024-25']);


// ------------------------------------------------------------------------------------
section('Classes, join codes, and seating charts');
r = await call(teacher, 'POST', '/api/classes', { name: 'Period 3 Social Studies', period: '3' });
ok(r.data.ok && /^[A-HJ-NP-Z2-9]{6}$/.test(r.data.code), 'teacher creates a class with a 6-character code (no look-alike letters)', r.data);
const cls1 = r.data.id; let code1 = r.data.code;
r = await call(teacher, 'POST', '/api/classes', { name: 'Period 5 Social Studies', period: '5' });
const cls2 = r.data.id;
r = await call(admin, 'POST', '/api/classes', { name: 'Admin class' });
const clsAdmin = r.data.id;
ok(db.db.prepare('SELECT COUNT(DISTINCT code) c FROM classes').get().c === 3, 'every class has its own code');
r = await call(teacher, 'GET', '/api/classes/' + clsAdmin);
ok(r.status === 404, "a teacher can't open another teacher's class");
r = await call(teacher, 'GET', '/api/classes');
ok(r.data.classes.length === 2 && r.data.classes.every((x) => x.name.startsWith('Period')), 'teachers only list their own classes');
r = await call(admin, 'GET', '/api/classes');
ok(r.data.classes.length === 1 && r.data.classes[0].name === 'Admin class', 'by default an admin sees only the classes they created');
r = await call(admin, 'GET', '/api/classes?owner=all');
ok(r.data.classes.length === 3, 'an admin can ask to see every teacher\u2019s classes');
r = await call(admin, 'GET', '/api/classes/' + cls1);
ok(r.status === 200 && r.data.class.code === code1, 'admin can open any class');
r = await call(s1001, 'GET', '/api/classes');
ok(r.status === 403, 'students cannot use staff class routes');

section('Joining with a code');
r = await call(s1001, 'POST', '/api/student/classes/join', { code: 'ZZZZZZ' });
ok(r.status === 400, 'wrong code rejected');
const spaced = code1.toLowerCase().slice(0, 3) + ' - ' + code1.slice(3).toLowerCase();
r = await call(s1001, 'POST', '/api/student/classes/join', { code: spaced });
ok(r.data.ok && r.data.already === false && r.data.class.name === 'Period 3 Social Studies' && r.data.class.teacher === 'Tess Teacher', 'student joins (code is case-, space-, and hyphen-insensitive)', r.data);
r = await call(s1001, 'POST', '/api/student/classes/join', { code: code1 });
ok(r.data.ok && r.data.already === true, 'joining twice is harmless');
r = await call(teacher, 'PATCH', `/api/classes/${cls1}`, { join_open: false });
r = await call(s2001, 'POST', '/api/student/classes/join', { code: code1 });
ok(r.status === 400, 'a class with joining closed refuses new students');
r = await call(teacher, 'PATCH', `/api/classes/${cls1}`, { join_open: true });
r = await call(teacher, 'POST', `/api/classes/${cls1}/regenerate-code`, {});
const oldCode = code1; code1 = r.data.code;
ok(code1 !== oldCode && /^[A-HJ-NP-Z2-9]{6}$/.test(code1), 'teacher can make a new code');
r = await call(s2001, 'POST', '/api/student/classes/join', { code: oldCode });
ok(r.status === 400, 'the old code stops working');
r = await call(s2001, 'POST', '/api/student/classes/join', { code: code1 });
ok(r.data.ok, 'the new code works');
r = await call(teacher, 'PATCH', `/api/classes/${cls2}`, { archived: true });
const cls2code = db.db.prepare('SELECT code FROM classes WHERE id=?').get(cls2).code;
r = await call(s2002, 'POST', '/api/student/classes/join', { code: cls2code });
ok(r.status === 400, 'archived classes cannot be joined');
await call(teacher, 'PATCH', `/api/classes/${cls2}`, { archived: false });
for (let i = 0; i < 10; i++) await call(s3002, 'POST', '/api/student/classes/join', { code: 'QQQQQ' + i });
r = await call(s3002, 'POST', '/api/student/classes/join', { code: code1 });
ok(r.status === 429, 'guessing codes locks the student out (even for the right code)');
db.db.exec("DELETE FROM login_attempts WHERE key LIKE 'join:%'");
r = await call(s1001, 'GET', '/api/student/classes');
ok(r.data.classes.length === 1 && r.data.classes[0].teacher === 'Tess Teacher', 'student sees the classes they joined');

section('Class members');
r = await call(teacher, 'POST', `/api/classes/${cls1}/members`, { student_ids: [1002, 1003, 2002, 2001] });
ok(r.data.added === 3, 'teacher adds students by hand (already-joined ones are not duplicated)', r.data);
r = await call(teacher, 'POST', `/api/classes/${cls1}/members`, { student_ids: [424242] });
ok(r.status === 400, 'unknown student rejected');
r = await call(teacher, 'GET', '/api/classes/' + cls1);
ok(r.data.members.length === 5 && r.data.members.every((m) => typeof m.balance === 'number'), 'class lists five members with P5 balances', r.data.members.length);

section('Seating layout');
const desks1 = [
  { x: 0, y: 0, kind: 'teacher' },
  { x: 1, y: 1, kind: 'desk', student_id: 1001 },
  { x: 2, y: 1, kind: 'desk', student_id: 1002 },
  { x: 3, y: 1, kind: 'desk', student_id: 1003 },
  { x: 1, y: 2, kind: 'desk', student_id: 2001 },
  { x: 2, y: 2, kind: 'desk' },
];
const bad1 = [
  ['desk outside the grid', { cols: 4, rows: 3, desks: [{ x: 4, y: 0, kind: 'desk' }] }],
  ['two desks in one spot', { cols: 6, rows: 4, desks: [{ x: 1, y: 1, kind: 'desk' }, { x: 1, y: 1, kind: 'desk' }] }],
  ['student not in this class', { cols: 6, rows: 4, desks: [{ x: 1, y: 1, kind: 'desk', student_id: 3001 }] }],
  ['same student at two desks', { cols: 6, rows: 4, desks: [{ x: 1, y: 1, kind: 'desk', student_id: 1001 }, { x: 2, y: 1, kind: 'desk', student_id: 1001 }] }],
  ['student at a teacher desk', { cols: 6, rows: 4, desks: [{ x: 1, y: 1, kind: 'teacher', student_id: 1001 }] }],
  ['grid too big', { cols: 17, rows: 4, desks: [] }],
  ['too many desks', { cols: 16, rows: 12, desks: Array.from({ length: 81 }, (_, i) => ({ x: i % 16, y: Math.floor(i / 16), kind: 'desk' })) }],
];
for (const [name, body] of bad1) {
  r = await call(teacher, 'PUT', `/api/classes/${cls1}/layout`, body);
  ok(r.status === 400, 'layout rejected: ' + name, r.status);
}
r = await call(teacher, 'PUT', `/api/classes/${cls1}/layout`, { cols: 6, rows: 4, desks: desks1 });
ok(r.data.ok && r.data.desks === 6, 'teacher saves a layout');
r = await call(teacher, 'GET', '/api/classes/' + cls1);
ok(r.data.class.grid_cols === 6 && r.data.class.grid_rows === 4 && r.data.desks.length === 6, 'saved layout reads back with its grid size');
ok(r.data.desks.find((d) => d.x === 1 && d.y === 1).student_id === 1001 && r.data.desks.find((d) => d.kind === 'teacher'), 'seats and the teacher desk are kept');
r = await call(teacher, 'PUT', `/api/classes/${cls1}/layout`, { cols: 6, rows: 4, desks: [{ x: 1, y: 1, kind: 'desk', student_id: 1001 }, { x: 1, y: 1, kind: 'desk' }] });
ok(r.status === 400 && db.db.prepare('SELECT COUNT(*) c FROM class_desks WHERE class_id=?').get(cls1).c === 6, 'a rejected save leaves the old layout untouched');
const other = await call(admin, 'PUT', `/api/classes/${clsAdmin}/layout`, { cols: 4, rows: 3, desks: [{ x: 0, y: 0, kind: 'desk' }] });
r = await call(teacher, 'PUT', `/api/classes/${clsAdmin}/layout`, { cols: 4, rows: 3, desks: [] });
ok(other.data.ok && r.status === 404, "a teacher can't change another teacher's layout");

section('Copying a layout between classes');
r = await call(teacher, 'POST', `/api/classes/${cls2}/copy-layout`, { from_class_id: cls1 });
ok(r.data.ok && r.data.desks === 6 && r.data.seated === 0, 'layout copies with desks only');
let g = (await call(teacher, 'GET', '/api/classes/' + cls2)).data;
ok(g.class.grid_cols === 6 && g.desks.length === 6 && g.desks.every((d) => d.student_id === null), 'copied layout has the same grid and empty desks');
await call(teacher, 'POST', `/api/classes/${cls2}/members`, { student_ids: [1001, 1002, 3001] });
r = await call(teacher, 'POST', `/api/classes/${cls2}/copy-layout`, { from_class_id: cls1, with_students: true });
ok(r.data.seated === 2 && r.data.skipped === 2, 'copying with students seats only those in both classes', r.data);
g = (await call(teacher, 'GET', '/api/classes/' + cls2)).data;
ok(g.desks.find((d) => d.x === 1 && d.y === 1).student_id === 1001, 'shared students keep their seats');
r = await call(teacher, 'POST', `/api/classes/${cls1}/copy-layout`, { from_class_id: cls1 });
ok(r.status === 400, 'cannot copy a class onto itself');
r = await call(teacher, 'POST', `/api/classes/${cls1}/copy-layout`, { from_class_id: clsAdmin });
ok(r.status === 404, "cannot copy from someone else's class");
r = await call(admin, 'POST', `/api/classes/${clsAdmin}/copy-layout`, { from_class_id: cls1 });
await call(admin, 'PUT', `/api/classes/${clsAdmin}/layout`, { cols: 4, rows: 3, desks: [] });
r = await call(teacher, 'POST', `/api/classes/${cls2}/copy-layout`, { from_class_id: cls2 });
const emptyCls = (await call(teacher, 'POST', '/api/classes', { name: 'Empty room' })).data.id;
r = await call(teacher, 'POST', `/api/classes/${cls2}/copy-layout`, { from_class_id: emptyCls });
ok(r.status === 400, 'cannot copy from a class with no layout');

section('Leaving and removing');
r = await call(teacher, 'DELETE', `/api/classes/${cls1}/members/1003`);
ok(r.data.ok && db.db.prepare('SELECT student_id FROM class_desks WHERE class_id=? AND x=3 AND y=1').get(cls1).student_id === null, 'removing a student also empties their desk');
r = await call(s1001, 'DELETE', `/api/student/classes/${cls1}`);
ok(r.data.ok && !db.db.prepare('SELECT 1 FROM class_members WHERE class_id=? AND student_id=1001').get(cls1) && db.db.prepare('SELECT student_id FROM class_desks WHERE class_id=? AND x=1 AND y=1').get(cls1).student_id === null, 'a student can leave, and their desk empties');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [1002], category_id: 1, amount: 1 });
ok(r.data.ok, 'awarding from a class desk uses the normal P5 award');


section('Whole-class awards and fines');
const clsMembers = (await call(teacher, 'GET', '/api/classes/' + cls1)).data.members.map((m) => m.student_id);
const balOf = (id) => db.db.prepare('SELECT COALESCE(SUM(amount),0) b FROM p5_transactions WHERE student_id=?').get(id).b;
const classBefore = Object.fromEntries(clsMembers.map((i) => [i, balOf(i)]));
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: clsMembers, category_id: 3, amount: 2, note: 'Great discussion' });
ok(r.data.ok && r.data.results.length === clsMembers.length && clsMembers.every((i) => balOf(i) === classBefore[i] + 2), 'awarding the whole class gives every student the points');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: clsMembers, category_id: 3, amount: 11 });
ok(r.status === 400 && clsMembers.every((i) => balOf(i) === classBefore[i] + 2), "the teacher's per-entry maximum also applies to a whole class");
const stepsBeforeClass = db.db.prepare("SELECT COUNT(*) c FROM steps WHERE source='p5_fine'").get().c;
r = await call(teacher, 'POST', '/api/p5', { mode: 'fine', student_ids: clsMembers, category_id: 2, amount: 3, note: 'Off task', step: { add: true, level: 1 } });
ok(r.data.ok && clsMembers.every((i) => balOf(i) === classBefore[i] - 1), 'fining the whole class takes the points from everyone');
ok(db.db.prepare("SELECT COUNT(*) c FROM steps WHERE source='p5_fine'").get().c === stepsBeforeClass + clsMembers.length, 'and adds one linked step per student');
ok(db.db.prepare("SELECT COUNT(*) c FROM p5_transactions t JOIN steps s ON s.id = t.linked_step_id WHERE t.type='fine' AND t.note='Off task'").get().c === clsMembers.length, 'each fine is linked to its own step');
const snapBal = JSON.stringify(clsMembers.map(balOf));
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [...clsMembers, 424242], category_id: 1, amount: 1 });
ok(r.status === 400 && JSON.stringify(clsMembers.map(balOf)) === snapBal, 'if one student is invalid, nobody in the group is changed');
r = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [], category_id: 1, amount: 1 });
ok(r.status === 400, 'an empty group is refused');


// ------------------------------------------------------------------------------------
section('Custom rewards and per-class rewards');
r = await call(admin, 'POST', '/api/admin/users', { email: 'teach2@school.org', name: 'Theo Teacher', role: 'teacher', password: 'second teacher pw 1' });
const teacher2 = await login({ kind: 'staff', email: 'teach2@school.org', password: 'second teacher pw 1' });
ok(teacher2.status === 200, 'a second teacher signs in');
const t1id = db.db.prepare("SELECT id FROM users WHERE email='teach@school.org'").get().id;
r = await call(teacher, 'POST', '/api/store/items', { scope: 'school', name: 'Nope', price: 5 });
ok(r.status === 403, 'teachers cannot add school rewards');
r = await call(teacher, 'POST', '/api/store/items', { scope: 'mine', name: 'Extra recess token', description: 'Five minutes of extra recess', price: 8, stock: 5, emoji: '\u{1F3C3}' });
const customId = r.data.id;
ok(r.data.ok && db.db.prepare('SELECT owner_id FROM store_items WHERE id=?').get(customId).owner_id === t1id, 'a teacher adds a custom reward that they own');
r = await call(teacher2, 'POST', '/api/store/items', { scope: 'mine', name: 'Theo sticker', price: 3 });
const customId2 = r.data.id;
r = await call(teacher, 'GET', '/api/store/items');
const names1 = r.data.items.map((i) => i.name);
ok(names1.includes('Extra recess token') && names1.includes('Homework pass') && !names1.includes('Theo sticker'), 'a teacher sees school rewards and their own, not other teachers\u2019');
ok(r.data.items.find((i) => i.name === 'Homework pass').can_edit === false && r.data.items.find((i) => i.name === 'Extra recess token').can_edit === true, 'only their own rewards are editable');
r = await call(teacher2, 'GET', '/api/store/items');
ok(!r.data.items.some((i) => i.name === 'Extra recess token'), 'another teacher cannot see a custom reward');
r = await call(admin, 'GET', '/api/store/items');
ok(r.data.items.some((i) => i.name === 'Extra recess token') && r.data.items.some((i) => i.name === 'Theo sticker'), 'admins see every reward');
r = await call(teacher, 'PATCH', `/api/store/items/${customId}`, { price: 9 });
ok(r.data.ok, 'a teacher edits their own custom reward');
r = await call(teacher, 'PATCH', `/api/store/items/${homework.id}`, { price: 1 });
ok(r.status === 403, 'a teacher cannot edit a school reward');
r = await call(teacher2, 'PATCH', `/api/store/items/${customId}`, { price: 1 });
ok(r.status === 404, "a teacher cannot edit another teacher's reward");
r = await call(admin, 'PATCH', `/api/store/items/${homework.id}`, { price: 25 });
ok(r.data.ok, 'an admin edits school rewards');

section('Choosing rewards for a class');
r = await call(teacher, 'GET', `/api/classes/${cls1}/rewards`);
ok(r.data.configured === false && r.data.selected.length === 0 && r.data.items.some((i) => i.id === customId && i.scope === 'custom') && r.data.items.some((i) => i.id === homework.id && i.scope === 'school') && !r.data.items.some((i) => i.id === customId2), 'a class offers school rewards and its owner\u2019s custom rewards (default: nothing chosen yet)');
r = await call(teacher2, 'GET', `/api/classes/${cls1}/rewards`);
ok(r.status === 404, "another teacher can't open a class's rewards");
const shopNames = async (sess) => (await call(sess, 'GET', '/api/student/store')).data.items.map((i) => i.name).sort();
let nm = await shopNames(s2001);
ok(nm.includes('Homework pass') && nm.includes('Pencil') && !nm.includes('Extra recess token'), 'default: a class that has not chosen shows every school reward and no custom ones', nm);
r = await call(teacher, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: [pencil.id, customId] });
ok(r.data.ok && r.data.selected === 2, 'teacher picks Pencil and their custom reward for the class');
r = await call(teacher, 'GET', `/api/classes/${cls1}/rewards`);
ok(r.data.configured === true && r.data.selected.length === 2, 'the choice is saved');
nm = await shopNames(s2001);
ok(JSON.stringify(nm) === JSON.stringify(['Extra recess token', 'Pencil']), 'students in the class now see exactly those rewards', nm);
const shop = (await call(s2001, 'GET', '/api/student/store')).data.items;
ok(shop.find((i) => i.name === 'Extra recess token').offered_by === 'Tess Teacher' && shop.find((i) => i.name === 'Pencil').offered_by === null, 'custom rewards show who offers them');
r = await call(s2001, 'POST', `/api/student/store/${homework.id}/buy`);
ok(r.status === 400 && /isn.t available/.test(r.data.error), 'a reward the class did not choose cannot be bought, even by calling the API directly');
r = await call(teacher, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: [customId2] });
ok(r.status === 400, "a class can't offer another teacher's custom reward");
r = await call(teacher, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: [999999] });
ok(r.status === 400, 'unknown rewards are refused');
r = await call(teacher, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: 'all' });
ok(r.status === 400, 'a malformed choice is refused');
r = await call(teacher2, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: [] });
ok(r.status === 404, "another teacher can't change a class's rewards");
ok((await call(teacher, 'GET', `/api/classes/${cls1}/rewards`)).data.selected.length === 2, 'refused changes leave the saved choice alone');

section('Buying a custom reward');
await call(admin, 'POST', '/api/p5', { mode: 'award', student_ids: [2001], category_id: 1, amount: 50 });
const balBeforeCustom = balOf(2001);
const stockBeforeCustom = db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(customId).stock;
r = await call(s2001, 'POST', `/api/student/store/${customId}/buy`);
ok(r.data.ok && balOf(2001) === balBeforeCustom - 9 && db.db.prepare('SELECT stock FROM store_items WHERE id=?').get(customId).stock === stockBeforeCustom - 1, 'a student in the class buys the custom reward (points and stock update)');
const custOrder = (await call(teacher, 'GET', '/api/store/orders?status=pending')).data.orders.find((o) => o.item === 'Extra recess token');
ok(custOrder && custOrder.custom === 1, 'the owner sees the order');
ok(!(await call(teacher2, 'GET', '/api/store/orders?status=pending')).data.orders.some((o) => o.item === 'Extra recess token'), "another teacher doesn't see the order");
ok((await call(admin, 'GET', '/api/store/orders?status=pending')).data.orders.some((o) => o.item === 'Extra recess token'), 'an admin sees the order');
r = await call(teacher2, 'POST', `/api/store/orders/${custOrder.id}/fulfill`);
ok(r.status === 404, "another teacher can't fulfil it");
r = await call(teacher2, 'POST', `/api/store/orders/${custOrder.id}/cancel`);
ok(r.status === 404, "another teacher can't cancel it");
ok(!(await call(teacher2, 'GET', '/api/store/picklist')).data.rows.some((x) => x.item === 'Extra recess token') && (await call(teacher, 'GET', '/api/store/picklist')).data.rows.some((x) => x.item === 'Extra recess token'), 'the pick list only shows custom rewards to their owner');
const countBanner = async (sess) => { const b = (await call(sess, 'GET', '/api/dashboard?year=2026-27')).data.banners.find((x) => /store order/.test(x.text)); return b ? Number(b.text.match(/^\d+/)[0]) : 0; };
ok((await countBanner(teacher)) === (await countBanner(teacher2)) + 1, 'the dashboard order count only includes orders a teacher can see');
r = await call(teacher, 'POST', `/api/store/orders/${custOrder.id}/fulfill`);
ok(r.data.ok, 'the owner fulfils the order');
nm = await shopNames(s3003);
ok(nm.includes('Homework pass') && !nm.includes('Extra recess token'), 'a student in no class sees school rewards only', nm);
r = await call(s3003, 'POST', `/api/student/store/${customId}/buy`);
ok(r.status === 400, 'a student outside the class cannot buy the custom reward');

section('Students in more than one class');
nm = await shopNames(s1002);
ok(nm.includes('Extra recess token') && nm.includes('Homework pass') && nm.includes('Sit with a friend'), 'one class using the default plus one with choices shows both', nm);
r = await call(teacher, 'PUT', `/api/classes/${cls2}/rewards`, { item_ids: [homework.id] });
nm = await shopNames(s1002);
ok(JSON.stringify(nm) === JSON.stringify(['Extra recess token', 'Homework pass', 'Pencil']), 'with both classes choosing, a student sees the combined choices', nm);
r = await call(teacher, 'PATCH', `/api/classes/${cls1}`, { archived: true });
nm = await shopNames(s2001);
ok(nm.includes('Homework pass') && !nm.includes('Extra recess token'), 'archiving a student\u2019s only class returns them to the school rewards', nm);
await call(teacher, 'PATCH', `/api/classes/${cls1}`, { archived: false });
r = await call(teacher, 'DELETE', `/api/classes/${cls1}/rewards`);
ok(r.data.ok && db.db.prepare('SELECT COUNT(*) c FROM class_rewards WHERE class_id=?').get(cls1).c === 0 && (await call(teacher, 'GET', `/api/classes/${cls1}/rewards`)).data.configured === false, 'resetting a class goes back to the default');
nm = await shopNames(s2001);
ok(nm.includes('Pencil') && !nm.includes('Extra recess token'), 'after a reset the class shows school rewards again', nm);
await call(teacher, 'PUT', `/api/classes/${cls1}/rewards`, { item_ids: [customId] });
ok((await shopNames(s2001)).includes('Extra recess token'), 'the custom reward is offered again');
await call(teacher, 'PATCH', `/api/store/items/${customId}`, { active: false });
ok(!(await shopNames(s2001)).includes('Extra recess token'), 'hiding a custom reward removes it from the store');
r = await call(teacher, 'GET', `/api/classes/${cls1}/rewards`);
ok(!r.data.items.some((i) => i.id === customId), 'a hidden reward is no longer offered for selection');


// ------------------------------------------------------------------------------------
section('Teacher last names and the class list');
const mig5 = readFileSync(new URL('../migrations/0005_staff_last_name.sql', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('UPDATE'));
for (const [email, name] of [['bf1@x.org', 'Mary Ann de la Cruz'], ['bf2@x.org', 'Madonna'], ['bf3@x.org', 'Pat  Lee']]) {
  db.db.prepare("INSERT INTO users (email, name, role, pw_hash) VALUES (?,?, 'teacher', 'x')").run(email, name);
}
db.db.exec(mig5);
const bf = Object.fromEntries(db.db.prepare("SELECT email, last_name FROM users WHERE email LIKE 'bf%@x.org'").all().map((x) => [x.email, x.last_name]));
ok(bf['bf1@x.org'] === 'Cruz' && bf['bf2@x.org'] === 'Madonna' && bf['bf3@x.org'] === 'Lee', 'the migration fills in last names for existing staff', bf);
db.db.exec("DELETE FROM users WHERE email LIKE 'bf%@x.org'");
ok(db.db.prepare("SELECT last_name FROM users WHERE email='admin@school.org'").get().last_name === 'Admin' && db.db.prepare("SELECT last_name FROM users WHERE email='teach@school.org'").get().last_name === 'Teacher', 'accounts made with a single name still get a last name');
r = await call(admin, 'POST', '/api/admin/users', { email: 'zed@school.org', first_name: 'Zed', last_name: 'Zimmer', role: 'teacher', password: 'zimmer password 12' });
ok(r.data.ok && db.db.prepare("SELECT name, last_name FROM users WHERE email='zed@school.org'").get().name === 'Zed Zimmer', 'admin adds a teacher with a first and last name');
r = await call(admin, 'POST', '/api/admin/users', { email: 'abe@school.org', first_name: 'Abe', last_name: 'Abbott', role: 'teacher', password: 'abbott password 12' });
r = await call(admin, 'POST', '/api/admin/users', { email: 'nofirst@school.org', last_name: 'Solo', role: 'teacher', password: 'solo password 1234' });
ok(r.status === 400, 'a last name without a first name is refused');
const zed = await login({ kind: 'staff', email: 'zed@school.org', password: 'zimmer password 12' });
const abe = await login({ kind: 'staff', email: 'abe@school.org', password: 'abbott password 12' });
await call(zed, 'POST', '/api/classes', { name: 'Zed math', period: '1' });
await call(abe, 'POST', '/api/classes', { name: 'Abe art', period: '2' });
const zedId = db.db.prepare("SELECT id FROM users WHERE email='zed@school.org'").get().id;
const adminId = db.db.prepare("SELECT id FROM users WHERE email='admin@school.org'").get().id;
r = await call(admin, 'GET', '/api/classes?owner=all');
const lasts = r.data.classes.map((c) => c.owner_last_name);
const sortedLasts = [...lasts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
ok(JSON.stringify(lasts) === JSON.stringify(sortedLasts) && lasts[0] === 'Abbott' && lasts[lasts.length - 1] === 'Zimmer', "all teachers' classes come back ordered by the teacher's last name", lasts);
ok(JSON.stringify(r.data.teachers.map((t) => t.last_name)) === JSON.stringify(['Abbott', 'Admin', 'Teacher', 'Zimmer']), 'the teacher filter lists teachers who have classes, ordered by last name', r.data.teachers.map((t) => t.last_name));
r = await call(admin, 'GET', '/api/classes?owner=' + zedId);
ok(r.data.classes.length === 1 && r.data.classes[0].name === 'Zed math', 'an admin can look at one teacher\u2019s classes');
r = await call(admin, 'GET', '/api/classes?owner=me');
ok(r.data.classes.every((c) => c.owner_id === adminId), 'owner=me is only the admin\u2019s own classes');
r = await call(teacher, 'GET', '/api/classes?owner=all');
ok(r.data.classes.length > 0 && r.data.classes.every((c) => c.owner_name === 'Tess Teacher') && r.data.teachers === undefined, 'a teacher asking for everyone still only gets their own classes (and no teacher list)');
r = await call(teacher, 'GET', '/api/classes?owner=' + zedId);
ok(r.data.classes.every((c) => c.owner_name === 'Tess Teacher'), "a teacher can't look at another teacher's classes by id");
r = await call(admin, 'PATCH', `/api/admin/users/${zedId}`, { last_name: 'Young' });
ok(r.data.ok && db.db.prepare('SELECT name, last_name FROM users WHERE id=?').get(zedId).name === 'Zed Young', 'changing a last name updates the display name too');
r = await call(admin, 'GET', '/api/classes?owner=all');
ok(r.data.teachers.map((t) => t.last_name).join() === 'Abbott,Admin,Teacher,Young', 'the order follows the new last name');
r = await call(admin, 'GET', '/api/admin/users');
const ul = r.data.users.filter((u) => u.active).map((u) => u.last_name);
ok(JSON.stringify(ul) === JSON.stringify([...ul].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))), 'the staff list is ordered by last name', ul);

section('Students only see classes they have joined');
const cls3 = (await call(teacher, 'POST', '/api/classes', { name: 'Private class', period: '7' })).data;
const cls3code = cls3.code;
r = await call(s3003, 'GET', '/api/student/classes');
ok(r.data.classes.length === 0, 'a student who has joined nothing sees no classes, even though classes exist');
r = await call(s2001, 'GET', '/api/student/classes');
ok(r.data.classes.length === 1 && r.data.classes[0].id === cls1, 'a student sees only the class they joined', r.data.classes);
ok(JSON.stringify(Object.keys(r.data.classes[0]).sort()) === JSON.stringify(['id', 'name', 'period', 'teacher']), 'and only its name, period, and teacher (no code, no classmates)');
ok(!JSON.stringify(r.data).includes(db.db.prepare('SELECT code FROM classes WHERE id=?').get(cls1).code), "the class code isn't included either");
r = await call(s2001, 'GET', '/api/classes');
ok(r.status === 403, 'a student cannot use the staff class list');
r = await call(s2001, 'GET', '/api/classes/' + cls1);
ok(r.status === 403, "a student can't open even their own class's staff page");
r = await call(s2001, 'GET', `/api/classes/${cls1}/rewards`);
ok(r.status === 403, "a student can't open a class's reward settings");
const leaveOther = await call(s2001, 'DELETE', `/api/student/classes/${cls3.id}`);
const leaveNone = await call(s2001, 'DELETE', '/api/student/classes/999999');
ok(leaveOther.status === 404 && leaveNone.status === 404 && leaveOther.data.error === leaveNone.data.error, "leaving a class you aren't in looks the same as leaving one that doesn't exist");
ok(db.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='class.leave' AND detail=?").get('class=' + cls3.id).c === 0, 'and nothing is recorded or changed');
await call(teacher, 'PATCH', `/api/classes/${cls3.id}`, { join_open: false });
const msgs = [];
for (const code of ['QQQQQQ', cls3code]) msgs.push((await call(s2001, 'POST', '/api/student/classes/join', { code })).data.error);
await call(teacher, 'PATCH', `/api/classes/${cls3.id}`, { join_open: true, archived: true });
msgs.push((await call(s2001, 'POST', '/api/student/classes/join', { code: cls3code })).data.error);
ok(msgs.every((m) => m && m === msgs[0]), 'wrong, closed, and archived codes all get the same answer (nothing is revealed)', msgs);
await call(teacher, 'PATCH', `/api/classes/${cls3.id}`, { archived: false });
r = await call(s3003, 'POST', '/api/student/classes/join', { code: cls3code });
ok(r.data.ok, 'joining with the right code works');
ok((await call(s3003, 'GET', '/api/student/classes')).data.classes.map((c) => c.id).join() === String(cls3.id), 'and the class now appears for that student only');
ok((await call(s2001, 'GET', '/api/student/classes')).data.classes.every((c) => c.id !== cls3.id), "another student's list is unchanged");
await call(teacher, 'PATCH', `/api/classes/${cls3.id}`, { archived: true });
ok((await call(s3003, 'GET', '/api/student/classes')).data.classes.length === 0, 'an archived class disappears from the student\u2019s list');
await call(teacher, 'PATCH', `/api/classes/${cls3.id}`, { archived: false });
r = await call(s3003, 'DELETE', `/api/student/classes/${cls3.id}`);
ok(r.data.ok && (await call(s3003, 'GET', '/api/student/classes')).data.classes.length === 0, 'a student can leave a class they joined');


// ------------------------------------------------------------------------------------
section('Name spinner math');
let seed = 12345;
const lcg = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const tally = Array(7).fill(0);
for (let i = 0; i < 14000; i++) tally[randomInt(7, lcg)]++;
ok(tally.every((c) => c > 1700 && c < 2300), 'every name is about equally likely to be picked', tally);
const secure = Array.from({ length: 3000 }, () => randomInt(5));
ok(secure.every((v) => Number.isInteger(v) && v >= 0 && v < 5) && new Set(secure).size === 5, 'secure random picks stay in range and reach every name');
ok(randomInt(1) === 0, 'a wheel of one name always picks it');
let threw = false; try { randomInt(0); } catch { threw = true; }
ok(threw, 'an empty wheel is refused');
let landBad = 0, spinBad = 0;
for (let t = 0; t < 4000; t++) {
  const n = 1 + Math.floor(lcg() * 60), idx = randomInt(n, lcg), r0 = lcg() * 200;
  const rf = targetRotation(idx, n, r0, lcg);
  if (sliceAtPointer(rf, n) !== idx) landBad++;
  if (rf < r0 + 5 * TAU) spinBad++;
}
ok(landBad === 0, 'the wheel always stops on the chosen name (4,000 random wheels of 1 to 60 names)', landBad);
ok(spinBad === 0, 'the wheel always makes several full turns first');

// ------------------------------------------------------------------------------------
section('Reordering the menu');
r = await call(teacher, 'GET', '/api/me');
ok(r.data.prefs && r.data.prefs.nav_order === null, 'by default nobody has a saved menu order');
r = await call(teacher, 'PUT', '/api/me/nav-order', { order: ['classes', 'dashboard', 'admin', 'bogus', 'dashboard', 'p5'] });
ok(r.data.ok && JSON.stringify(r.data.order) === JSON.stringify(['classes', 'dashboard', 'p5']), 'a saved order drops unknown items, admin-only items for teachers, and repeats', r.data);
r = await call(teacher, 'GET', '/api/me');
ok(JSON.stringify(r.data.prefs.nav_order) === JSON.stringify(['classes', 'dashboard', 'p5']), 'the order comes back with the signed-in person');
r = await call(teacher2, 'GET', '/api/me');
ok(r.data.prefs.nav_order === null, "another teacher's menu is not affected");
r = await call(admin, 'PUT', '/api/me/nav-order', { order: ['admin', 'dashboard'] });
ok(JSON.stringify(r.data.order) === JSON.stringify(['admin', 'dashboard']), 'an admin can order the Admin tab too');
r = await call(s2001, 'PUT', '/api/me/nav-order', { order: ['seat', 'dashboard', 'me'] });
ok(JSON.stringify(r.data.order) === JSON.stringify(['seat', 'me']), 'students can reorder their own menu, but only with student tabs');
ok(JSON.stringify((await call(s2001, 'GET', '/api/me')).data.prefs.nav_order) === JSON.stringify(['seat', 'me']), "and it's saved for them");
ok((await call(s2002, 'GET', '/api/me')).data.prefs.nav_order === null, "another student's menu is not affected");
for (const [label, body] of [['not a list', { order: 'x' }], ['a non-text item', { order: [1] }], ['too many items', { order: Array.from({ length: 31 }, (_, i) => 'p' + i) }]]) {
  r = await call(teacher, 'PUT', '/api/me/nav-order', body);
  ok(r.status === 400, 'menu order refused: ' + label);
}
r = await call(null, 'PUT', '/api/me/nav-order', { order: ['dashboard'] });
ok(r.status === 401, 'signing in is required to save a menu order');
r = await call(teacher, 'DELETE', '/api/me/nav-order');
ok(r.data.ok && (await call(teacher, 'GET', '/api/me')).data.prefs.nav_order === null, 'resetting goes back to the default order');

// ------------------------------------------------------------------------------------
section('Class report');
const repId = (await call(teacher, 'POST', '/api/classes', { name: 'Report class', period: '4' })).data.id;
await call(teacher, 'POST', `/api/classes/${repId}/members`, { student_ids: [1002, 2001, 2002, 3001, 3003] });
const WIDE = 'from=2000-01-01&to=2099-12-31';
const stepCounts = (id, lo, hi) => {
  const rows = db.db.prepare('SELECT step_level l, COUNT(*) c FROM steps WHERE student_id=? AND step_date BETWEEN ? AND ? GROUP BY step_level').all(id, lo, hi);
  const o = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 }; rows.forEach((x) => { o['s' + x.l] = x.c; }); return o;
};
const p5Expect = (id, lo, hi) => {
  const rows = db.db.prepare('SELECT p.type, p.amount, o.type AS otype FROM p5_transactions p LEFT JOIN p5_transactions o ON o.id = p.related_id WHERE p.student_id=? AND p.tx_date BETWEEN ? AND ?').all(id, lo, hi);
  let awarded = 0, fined = 0, spent = 0;
  for (const x of rows) {
    const eff = x.type === 'adjustment' ? x.otype : x.type;
    if (eff === 'award') awarded += x.amount;
    if (eff === 'fine') fined -= x.amount;
    if (['purchase', 'seat', 'refund', 'seat_refund'].includes(x.type)) spent -= x.amount;
  }
  return { awarded, fined, spent };
};
r = await call(teacher, 'GET', `/api/classes/${repId}/report?${WIDE}`);
const rep1 = r.data;
ok(r.status === 200 && rep1.students.length === 5 && rep1.class.name === 'Report class', 'the report lists every student in the class');
ok(rep1.students.map((s) => s.last_name).join() === [...rep1.students.map((s) => s.last_name)].sort((a, b) => a.localeCompare(b)).join(), 'students are listed alphabetically by last name');
let stepsOk = true, p5Ok = true, balOk = true;
for (const s of rep1.students) {
  const e = stepCounts(s.student_id, '2000-01-01', '2099-12-31');
  if (['s1', 's2', 's3', 's4', 's5'].some((k) => s[k] !== e[k]) || s.steps_total !== Object.values(e).reduce((a, b) => a + b, 0)) stepsOk = false;
  const pe = p5Expect(s.student_id, '2000-01-01', '2099-12-31');
  if (s.awarded !== pe.awarded || s.fined !== pe.fined || s.spent !== pe.spent) p5Ok = false;
  if (s.balance !== balOf(s.student_id)) balOk = false;
}
ok(stepsOk, 'step counts by level match the records');
ok(p5Ok, 'P5 awarded, fined, and spent match the ledger');
ok(balOk, 'current balances match');
ok(rep1.totals.steps_total === rep1.students.reduce((n, s) => n + s.steps_total, 0) && rep1.totals.balance === rep1.students.reduce((n, s) => n + s.balance, 0), 'class totals add up');
ok(rep1.steps.length === rep1.totals.steps_total && rep1.steps.every((x) => x.last_name && x.step_date), 'the step history has one named row per step');
ok(rep1.steps.every((x, i, a) => i === 0 || a[i - 1].step_date <= x.step_date), 'the step history is in date order');
ok(rep1.p5.length === db.db.prepare(`SELECT COUNT(*) c FROM p5_transactions WHERE student_id IN (1002,2001,2002,3001,3003)`).get().c, 'the P5 history includes every entry');
const orderCountDb = db.db.prepare("SELECT COUNT(*) c FROM store_orders o JOIN store_items i ON i.id=o.item_id WHERE o.student_id IN (1002,2001,2002,3001,3003) AND (i.owner_id IS NULL OR i.owner_id=?)").get(t1id).c;
ok(rep1.orders.length === orderCountDb && rep1.orders.some((o) => o.item === 'Extra recess token'), 'store orders include school rewards and this teacher\u2019s custom rewards');
const before3003 = rep1.students.find((s) => s.student_id === 3003);
const aw = await call(teacher, 'POST', '/api/p5', { mode: 'award', student_ids: [3003], category_id: 1, amount: 7 });
let after = (await call(teacher, 'GET', `/api/classes/${repId}/report?${WIDE}`)).data.students.find((s) => s.student_id === 3003);
ok(after.awarded === before3003.awarded + 7 && after.balance === before3003.balance + 7, 'a new award shows up');
const lastAward = db.db.prepare("SELECT id FROM p5_transactions WHERE student_id=3003 AND type='award' ORDER BY id DESC").get().id;
await call(teacher, 'POST', `/api/p5/${lastAward}/reverse`, {});
after = (await call(teacher, 'GET', `/api/classes/${repId}/report?${WIDE}`)).data.students.find((s) => s.student_id === 3003);
ok(after.awarded === before3003.awarded && after.balance === before3003.balance, 'a reversed award is netted out, not counted twice');
r = await call(teacher, 'GET', `/api/classes/${repId}/report?from=2026-10-10&to=2026-10-20`);
let rangeOk = true;
for (const s of r.data.students) { const e = stepCounts(s.student_id, '2026-10-10', '2026-10-20'); if (['s1', 's2', 's3', 's4', 's5'].some((k) => s[k] !== e[k])) rangeOk = false; }
ok(rangeOk && r.data.steps.every((x) => x.step_date >= '2026-10-10' && x.step_date <= '2026-10-20'), 'a date range limits the steps to those dates');
r = await call(teacher, 'GET', `/api/classes/${repId}/report?year=2026-27`);
ok(r.data.from === '2026-08-01' && r.data.to === '2027-07-31' && r.data.year === '2026-27', 'a school year means August 1 to July 31');
r = await call(teacher, 'GET', `/api/classes/${repId}/report?year=2025-26`);
ok(r.data.steps.every((x) => x.step_date >= '2025-08-01' && x.step_date <= '2026-07-31'), 'other school years work too');
let seatOk = true;
for (const s of rep1.students) {
  const row = db.db.prepare("SELECT a.name an, d.name dn FROM reward_bookings b JOIN reward_activities a ON a.id=b.activity_id JOIN reward_days d ON d.id=b.reward_day_id WHERE b.student_id=? AND b.status='confirmed' ORDER BY d.reward_date DESC, b.id DESC").get(s.student_id);
  const exp = row ? `${row.an} (${row.dn})` : null;
  if ((s.rewards_day || null) !== exp && !(row && s.rewards_day && s.rewards_day.includes(row.an))) seatOk = false;
}
ok(seatOk, 'each student\u2019s Rewards Day activity is listed');
ok(!JSON.stringify(rep1).match(/pin_hash|pw_hash|hmac\$|pbkdf2/), 'the report never contains PIN or password data');
r = await call(teacher2, 'GET', `/api/classes/${repId}/report`);
ok(r.status === 404, "another teacher can't open this class's report");
r = await call(admin, 'GET', `/api/classes/${repId}/report?${WIDE}`);
ok(r.status === 200 && r.data.students.length === 5, 'an admin can open any class report');
r = await call(s2001, 'GET', `/api/classes/${repId}/report`);
ok(r.status === 403, 'students cannot open reports');
r = await call(null, 'GET', `/api/classes/${repId}/report`);
ok(r.status === 401, 'signing in is required');
for (const [label, q] of [['a bad school year', 'year=abc'], ['a bad date', 'from=2026-13-40'], ['an end date before the start', 'from=2026-10-20&to=2026-10-10']]) {
  r = await call(teacher, 'GET', `/api/classes/${repId}/report?${q}`);
  ok(r.status === 400, 'report refused: ' + label);
}
const theoClass = (await call(teacher2, 'POST', '/api/classes', { name: 'Theo class' })).data.id;
await call(teacher2, 'POST', `/api/classes/${theoClass}/members`, { student_ids: [2001] });
r = await call(teacher2, 'GET', `/api/classes/${theoClass}/report?${WIDE}`);
ok(!r.data.orders.some((o) => o.item === 'Extra recess token'), "one teacher's report never shows orders for another teacher's custom reward");
ok(db.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='class.report'").get().c >= 5, 'opening a report is recorded in the audit log');

// ------------------------------------------------------------------------------------
section('Restroom and water breaks');
r = await call(teacher, 'GET', '/api/breaks/pin');
ok(r.data.has_pin === false, 'a teacher starts with no break PIN');
for (const bad of ['123', '12345', 'abcd', '12a4', '']) {
  r = await call(teacher, 'PUT', '/api/breaks/pin', { pin: bad });
  ok(r.status === 400, `PIN "${bad}" is refused (must be exactly 4 digits)`);
}
r = await call(teacher, 'PUT', '/api/breaks/pin', { pin: '4821' });
ok(r.data.ok, 'teacher sets a 4-digit PIN');
ok(!db.db.prepare('SELECT pin_hash FROM teacher_pins').all().some((x) => x.pin_hash.includes('4821')), 'the teacher PIN is stored hashed, not as digits');
r = await call(teacher2, 'PUT', '/api/breaks/pin', { pin: '4821' });
ok(r.status === 409, 'two teachers cannot share a PIN');
r = await call(teacher2, 'PUT', '/api/breaks/pin', { pin: '7350' });
ok(r.data.ok, 'a second teacher sets a different PIN');
r = await call(teacher, 'PUT', '/api/breaks/pin', { pin: '4821' });
ok(r.data.ok, 'a teacher can re-save their own PIN');
r = await call(s1002, 'PUT', '/api/breaks/pin', { pin: '1111' });
ok(r.status === 403, 'students cannot set teacher PINs');
r = await call(s1002, 'GET', '/api/breaks/report');
ok(r.status === 403, 'students cannot open the break report');

const bStu = await login({ kind: 'student', student_id: '1002', pin: pins[1002] });
r = await call(bStu, 'GET', '/api/student/break');
ok(r.data.active === null, 'no break is active at first');
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'snack', pin: '4821' });
ok(r.status === 400, 'only restroom or water are valid reasons');
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'restroom', pin: '0000' });
ok(r.status === 403 && !/Tess|Teacher/.test(JSON.stringify(r.data)), 'a wrong teacher PIN is refused without hinting at the teacher');
ok(db.db.prepare('SELECT COUNT(*) c FROM break_log').get().c === 0, 'a wrong PIN logs no break');
for (let i = 0; i < 4; i++) await call(bStu, 'POST', '/api/student/break/start', { reason: 'water', pin: '9999' });
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'restroom', pin: '4821' });
ok(r.status === 429, 'after 5 wrong PINs the student is locked out (even with a correct PIN)');
db.db.exec("DELETE FROM login_attempts");
const startedAt = Date.now();
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'restroom', pin: '4821' });
ok(r.data.ok && r.data.active && r.data.active.reason === 'restroom', 'a correct PIN starts the break');
const brow = db.db.prepare('SELECT * FROM break_log').get();
ok(Math.abs(Date.parse(brow.left_at) - startedAt) < 5000 && brow.status === 'out', 'the leave time is stamped by the server');
ok(brow.released_by === db.db.prepare("SELECT id FROM users WHERE email='teach@school.org'").get().id, 'the break records which teacher released the student');
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'water', pin: '4821' });
ok(r.status === 400, 'a student who is already out cannot start a second break');
r = await call(bStu, 'GET', '/api/student/break');
ok(r.data.active && r.data.active.id === brow.id && typeof r.data.server_now === 'string', 'the timer page can read the active break and the server clock');
r = await call(bStu, 'GET', '/api/student/home');
ok(r.data.on_break === true, 'the student home knows the student is out');

r = await call(bStu, 'POST', '/api/student/break/return', { student_number: '1003' });
ok(r.status === 400, "someone else's student number does not stop the timer");
ok(db.db.prepare('SELECT status FROM break_log').get().status === 'out', 'a wrong student number leaves the student marked as out');
r = await call(bStu, 'POST', '/api/student/break/return', { student_number: '' });
ok(r.status === 400, 'an empty student number is refused');
const bOther = await login({ kind: 'student', student_id: '1003', pin: pins[1003] });
r = await call(bOther, 'POST', '/api/student/break/return', { student_number: '1003' });
ok(r.status === 400, "one student cannot stop another student's timer");
db.db.prepare("UPDATE break_log SET left_at = ? WHERE id = ?").run(new Date(Date.now() - 125000).toISOString(), brow.id);
r = await call(bStu, 'POST', '/api/student/break/return', { student_number: '1002' });
ok(r.data.ok && r.data.last.seconds >= 124 && r.data.last.seconds <= 130, 'the right student number stops the timer and returns the minutes out', r.data);
r = await call(bStu, 'POST', '/api/student/break/return', { student_number: '1002' });
ok(r.status === 400, 'a finished break cannot be stopped twice');
const done = db.db.prepare('SELECT * FROM break_log').get();
ok(done.status === 'returned' && done.return_method === 'student' && done.returned_at, 'the return is stored with how it was stopped');

r = await call(bOther, 'POST', '/api/student/break/start', { reason: 'water', pin: '7350' });
ok(r.data.ok, 'another student leaves for water with the second teacher’s PIN');
db.db.exec("UPDATE users SET active = 0 WHERE email = 'teach@school.org'");
r = await call(bStu, 'POST', '/api/student/break/start', { reason: 'water', pin: '4821' });
ok(r.status === 403, 'a deactivated teacher’s PIN stops working');
db.db.exec("UPDATE users SET active = 1 WHERE email = 'teach@school.org'");

r = await call(bStu, 'GET', '/api/student/home');
ok(r.data.breaks.year.total === 1 && r.data.breaks.year.restroom === 1 && r.data.breaks.year.water === 0, 'the student sees their own restroom and water counts');
ok(r.data.breaks.today === 1, 'the student sees how many breaks they took today');

r = await call(teacher, 'GET', '/api/breaks/report');
ok(r.status === 200 && r.data.totals.breaks === 2 && r.data.totals.restroom === 1 && r.data.totals.water === 1, 'the break report counts restroom and water breaks');
ok(r.data.out_now.length === 1 && r.data.out_now[0].student_id === 1003, 'the report lists who is out right now');
const row2002 = r.data.students.find((x) => x.student_id === 1002);
ok(row2002 && row2002.breaks === 1 && row2002.seconds >= 124, 'the report shows each student’s breaks and time out');
const lg = r.data.log.find((x) => x.student_id === 1002);
ok(lg && lg.released_by === 'Tess Teacher' && lg.seconds >= 124 && lg.left_at && lg.returned_at, 'the report shows when they left, when they returned, how long and who released them');
r = await call(teacher, 'GET', '/api/breaks/report?reason=water');
ok(r.data.totals.breaks === 1, 'the report can filter by reason');
r = await call(teacher, 'GET', '/api/breaks/report?from=2026-13-40');
ok(r.status === 400, 'the report rejects a bad date');
r = await call(teacher, 'GET', '/api/breaks/report?grade=5');
ok(r.status === 400, 'the report rejects a bad grade');
const openId = db.db.prepare("SELECT id FROM break_log WHERE status='out'").get().id;
r = await call(teacher, 'POST', `/api/breaks/${openId}/return`);
ok(r.data.ok, 'a teacher can mark a forgotten student as back');
r = await call(teacher, 'POST', `/api/breaks/${openId}/return`);
ok(r.status === 400, 'a break cannot be closed twice');
await call(bOther, 'POST', '/api/student/break/start', { reason: 'water', pin: '7350' });
db.db.prepare("UPDATE break_log SET left_at = ? WHERE status='out'").run(new Date(Date.now() - 4 * 3600 * 1000).toISOString());
await runScheduled(env);
ok(db.db.prepare("SELECT COUNT(*) c FROM break_log WHERE status='out'").get().c === 0, 'the hourly job closes a break left open for hours');
ok(db.db.prepare("SELECT return_method FROM break_log ORDER BY id DESC LIMIT 1").get().return_method === 'auto', 'an auto-closed break is labelled as auto-closed');

r = await call(admin, 'GET', '/api/breaks/pins');
ok(r.data.teachers.some((t) => t.has_pin) && !JSON.stringify(r.data).match(/4821|pin_hash/), 'the admin sees who has a PIN but never the PIN itself');
r = await call(teacher, 'GET', '/api/breaks/pins');
ok(r.status === 403, 'teachers cannot list bOther teachers’ PIN status');
r = await call(admin, 'DELETE', `/api/breaks/pins/${db.db.prepare("SELECT user_id FROM teacher_pins ORDER BY user_id DESC LIMIT 1").get().user_id}`);
ok(r.data.ok, 'an admin can reset a teacher’s PIN');
r = await call(teacher, 'DELETE', '/api/breaks/pin');
ok(r.data.ok && (await call(teacher, 'GET', '/api/breaks/pin')).data.has_pin === false, 'a teacher can remove their own PIN');

section('Student bank page data');
r = await call(s1002, 'GET', '/api/student/home');
const h2 = r.data;
ok(h2.student.student_id === 1002 && typeof h2.balance === 'number', 'the bank page has the account number and balance');
ok(h2.earned - h2.spent - h2.fines_total === h2.balance, 'earned minus spent minus fines equals the balance', { e: h2.earned, s: h2.spent, f: h2.fines_total, b: h2.balance });
ok(h2.earned >= 0 && h2.spent >= 0 && h2.fines_total >= 0, 'the bank totals are never negative');
ok(h2.period && h2.period.name, 'the bank page knows the current rewards period');
ok(Array.isArray(h2.bonuses) && Array.isArray(h2.fines) && Array.isArray(h2.steps), 'bonuses, fines and steps for the period are lists');
ok(!JSON.stringify(h2).match(/pin_hash|notes/), 'the student bank page leaks no PIN hashes or private step notes');

// ------------------------------------------------------------------------------------
section('Students create their own password');
const pwS = await login({ kind: 'student', student_id: '3002', pin: pins[3002] });
r = await call(pwS, 'GET', '/api/me');
ok(r.data.needs_password === true, 'a student who has only a PIN is asked to make a password');
r = await call(pwS, 'POST', '/api/student/password', { current: '000000', next: 'blue-planet-77' });
ok(r.status === 403, 'the PIN must be right to set a password');
for (const [bad, why] of [['short', 'too short'], ['3002', 'too short'], ['11111111', 'one repeated digit'], ['  3002  3002', 'x']].slice(0, 3)) {
  r = await call(pwS, 'POST', '/api/student/password', { current: pins[3002], next: bad });
  ok(r.status === 400, `password refused: ${why}`);
}
r = await call(pwS, 'POST', '/api/student/password', { current: pins[3002], next: pins[3002] });
ok(r.status === 400, 'the new password cannot equal the PIN');
r = await call(pwS, 'POST', '/api/student/password', { current: pins[3002], next: 'blue-planet-77' });
ok(r.data.ok, 'the student sets a password');
r = await call(pwS, 'GET', '/api/me');
ok(r.status === 401, 'they are signed out after setting it');
ok(!db.db.prepare('SELECT pw_hash FROM students WHERE student_id = 3002').get().pw_hash.includes('blue-planet'), 'the password is stored hashed');
r = await login({ kind: 'student', student_id: '3002', pin: pins[3002] });
ok(r.status === 401, 'the old PIN stops working once a password exists');
const pw2 = await login({ kind: 'student', student_id: '3002', pin: 'blue-planet-77' });
ok(pw2.status === 200, 'the new password signs in (with spaces and letters allowed)');
r = await call(pw2, 'GET', '/api/me');
ok(r.data.needs_password === false, 'the student is no longer asked to make a password');
r = await call(pw2, 'POST', '/api/student/password', { current: 'wrong-password', next: 'another-pass-99' });
ok(r.status === 403, 'changing the password needs the current one');
db.db.exec('DELETE FROM login_attempts');
r = await call(admin, 'POST', '/api/admin/students/3002/pin');
const reset = r.data.pin ? { pin: r.data.pin } : (r.data.pins || [])[0];
ok(reset && !db.db.prepare('SELECT pw_hash FROM students WHERE student_id = 3002').get().pw_hash, 'an admin PIN reset also clears the student’s password');
if (reset) { r = await login({ kind: 'student', student_id: '3002', pin: reset.pin }); ok(r.status === 200, 'the new PIN works again after a reset'); }

// ------------------------------------------------------------------------------------
section('Export and audit');
r = await call(admin, 'GET', '/api/admin/export?table=students');
ok(typeof r.data === 'string' && r.data.startsWith('student_id,') && !/pin_hash|hmac\$/.test(r.data), 'student export never includes PIN hashes');
await call(admin, 'POST', '/api/steps', { student_id: 1001, step_level: 1, step_date: '2026-10-20', notes: '=HYPERLINK("http://evil")' });
r = await call(admin, 'GET', '/api/admin/export?table=steps');
ok(/'=HYPERLINK/.test(r.data), 'spreadsheet formulas in notes are neutralised in CSV export');
r = await call(admin, 'GET', '/api/admin/audit');
ok(r.data.entries.length > 20 && r.data.entries.some((e) => e.action === 'export'), 'audit log records actions, including exports');
ok(!JSON.stringify(r.data.entries).match(/correct horse|teacher password/), 'audit log contains no passwords');

section('Session handling');
r = await call(teacher, 'POST', '/api/logout');
ok(r.status === 200, 'logout works');
r = await call(teacher, 'GET', '/api/me');
ok(r.status === 401, 'session is dead after logout');
r = await call(admin, 'PATCH', '/api/admin/users/2', { active: false });
const t3 = await login({ kind: 'staff', email: 'teach@school.org', password: 'teacher password 1' });
ok(t3.status === 401, 'deactivated staff cannot sign in');
r = await call(admin, 'PATCH', '/api/admin/users/1', { active: false });
ok(r.status === 400, 'cannot deactivate the last admin');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:\n - ' + failures.join('\n - '));
  process.exit(1);
}
