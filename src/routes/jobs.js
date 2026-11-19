// Class jobs: teachers post jobs (paid weekly in P5 tickets), students apply, teachers hire.
import { add } from '../router.js';
import { all, one, run, audit } from '../lib/db.js';
import { V, bad, HttpError, todayStr } from '../lib/util.js';
import { runPayroll } from '../lib/payroll.js';

const MAX_JOBS = 25;
export const JOB_PRESETS = [
  { title: 'Greeter', description: 'Welcomes the class at the door and hands out the daily agenda.', salary: 5 },
  { title: 'Materials Manager', description: 'Passes out and collects papers, books, and supplies.', salary: 8 },
  { title: 'Tech Helper', description: 'Helps set up the projector and helps classmates with basic tech problems.', salary: 10 },
  { title: 'Attendance Helper', description: 'Checks the seating chart and reports who is absent.', salary: 8 },
  { title: 'Board Manager', description: 'Writes the date and agenda and erases the board at the end of class.', salary: 5 },
  { title: 'Timekeeper', description: 'Keeps an eye on the clock and gives time warnings for activities.', salary: 5 },
  { title: 'Class Librarian', description: 'Keeps the classroom books and maps organized.', salary: 8 },
  { title: 'Class Historian', description: 'Writes a short summary of what we learned each week.', salary: 10 },
  { title: 'Clean-Up Captain', description: 'Makes sure desks and floors are tidy before the bell.', salary: 5 },
  { title: 'Absent-Work Collector', description: 'Gathers handouts for classmates who were absent.', salary: 8 },
];

async function ownClass(c, idParam) {
  const id = V.int(idParam, 'class id', { min: 1 });
  const cls = await one(c.env, 'SELECT * FROM classes WHERE id = ?', id);
  if (!cls || (c.user.role !== 'admin' && cls.owner_id !== c.user.id)) throw new HttpError(404, 'Class not found.');
  return cls;
}
async function ownJob(c, cls, jidParam) {
  const jid = V.int(jidParam, 'job', { min: 1 });
  const job = await one(c.env, 'SELECT * FROM class_jobs WHERE id = ? AND class_id = ?', jid, cls.id);
  if (!job) throw new HttpError(404, 'Job not found.');
  return job;
}
function jobFields(b, cur = {}) {
  return {
    title: V.str(b.title ?? cur.title, 'Job title', { max: 60 }),
    description: V.str(b.description === undefined ? cur.description : b.description, 'Description', { max: 300, optional: true }),
    salary: V.int(b.salary ?? cur.salary, 'Weekly salary', { min: 1, max: 100 }),
    slots: V.int(b.slots ?? cur.slots ?? 1, 'Openings', { min: 1, max: 10 }),
  };
}
const endHire = (env, where, ...args) =>
  run(env, `UPDATE job_applications SET status = 'ended', ended_on = ?, decided_at = ?, decided_by = ? WHERE status = 'hired' AND ${where}`, ...args);

// ---- Teacher ---------------------------------------------------------------------------
add('GET', '/api/job-presets', 'staff', async () => ({ presets: JOB_PRESETS }));

add('GET', '/api/classes/:id/jobs', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const jobs = await all(c.env, 'SELECT id, title, description, salary, slots, active FROM class_jobs WHERE class_id = ? ORDER BY active DESC, id', cls.id);
  const apps = await all(c.env,
    `SELECT a.id, a.job_id, a.student_id, s.last_name, s.first_name, s.grade, a.message, a.status, a.applied_at, a.hired_on
       FROM job_applications a JOIN students s ON s.student_id = a.student_id
      WHERE a.class_id = ? AND a.status IN ('pending','hired') ORDER BY s.last_name, s.first_name`, cls.id);
  const hiredElsewhere = new Set(apps.filter((a) => a.status === 'hired').map((a) => a.student_id));
  for (const j of jobs) {
    j.hired = apps.filter((a) => a.job_id === j.id && a.status === 'hired');
    j.pending = apps.filter((a) => a.job_id === j.id && a.status === 'pending')
      .map((a) => ({ ...a, has_job: hiredElsewhere.has(a.student_id) }));
  }
  return { jobs, presets: JOB_PRESETS };
});

add('POST', '/api/classes/:id/jobs', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const n = await one(c.env, 'SELECT COUNT(*) AS n FROM class_jobs WHERE class_id = ? AND active = 1', cls.id);
  if (n.n >= MAX_JOBS) throw bad(`A class can have up to ${MAX_JOBS} open jobs.`);
  const f = jobFields(c.body);
  const r = await run(c.env, 'INSERT INTO class_jobs (class_id, title, description, salary, slots) VALUES (?,?,?,?,?)', cls.id, f.title, f.description, f.salary, f.slots);
  await audit(c.env, c.actor, 'job.create', `class=${cls.id} job=${r.meta.last_row_id}`);
  return { ok: true, id: r.meta.last_row_id };
});

add('PATCH', '/api/classes/:id/jobs/:jid', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const job = await ownJob(c, cls, c.params.jid);
  const f = jobFields(c.body, job);
  const hired = await one(c.env, "SELECT COUNT(*) AS n FROM job_applications WHERE job_id = ? AND status = 'hired'", job.id);
  if (f.slots < hired.n) throw bad(`${hired.n} students already hold this job. End one first to lower the openings.`);
  await run(c.env, 'UPDATE class_jobs SET title=?, description=?, salary=?, slots=? WHERE id=?', f.title, f.description, f.salary, f.slots, job.id);
  await audit(c.env, c.actor, 'job.update', `job=${job.id} salary=${f.salary}`);
  return { ok: true };
});

// Removing a job ends everyone's employment and declines pending applications. Pay already made stays.
add('DELETE', '/api/classes/:id/jobs/:jid', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const job = await ownJob(c, cls, c.params.jid);
  const now = new Date().toISOString();
  await endHire(c.env, 'job_id = ?', todayStr(c.env), now, c.actor, job.id);
  await run(c.env, "UPDATE job_applications SET status = 'declined', decided_at = ?, decided_by = ? WHERE job_id = ? AND status = 'pending'", now, c.actor, job.id);
  await run(c.env, 'UPDATE class_jobs SET active = 0 WHERE id = ?', job.id);
  await audit(c.env, c.actor, 'job.remove', `job=${job.id}`);
  return { ok: true };
});

async function ownApp(c, cls, aidParam) {
  const id = V.int(aidParam, 'application', { min: 1 });
  const a = await one(c.env, 'SELECT * FROM job_applications WHERE id = ? AND class_id = ?', id, cls.id);
  if (!a) throw new HttpError(404, 'Application not found.');
  return a;
}

add('POST', '/api/classes/:id/applications/:aid/hire', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const a = await ownApp(c, cls, c.params.aid);
  if (a.status !== 'pending') throw bad('That application is not waiting for a decision.');
  const job = await one(c.env, 'SELECT * FROM class_jobs WHERE id = ?', a.job_id);
  if (!job.active) throw bad('That job has been removed.');
  const member = await one(c.env, 'SELECT 1 AS x FROM class_members WHERE class_id = ? AND student_id = ?', cls.id, a.student_id);
  if (!member) throw bad('That student is no longer in this class.');
  if (await one(c.env, "SELECT 1 AS x FROM job_applications WHERE class_id = ? AND student_id = ? AND status = 'hired'", cls.id, a.student_id)) throw bad('That student already has a job in this class.');
  const filled = await one(c.env, "SELECT COUNT(*) AS n FROM job_applications WHERE job_id = ? AND status = 'hired'", job.id);
  if (filled.n >= job.slots) throw bad('All openings for this job are filled.');
  const now = new Date().toISOString();
  try {
    await run(c.env, "UPDATE job_applications SET status = 'hired', decided_at = ?, decided_by = ?, hired_on = ? WHERE id = ? AND status = 'pending'", now, c.actor, todayStr(c.env), a.id);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw bad('That student already has a job in this class.');
    throw e;
  }
  // Their other waiting applications in this class are no longer needed.
  await run(c.env, "UPDATE job_applications SET status = 'withdrawn', decided_at = ? WHERE class_id = ? AND student_id = ? AND status = 'pending'", now, cls.id, a.student_id);
  await audit(c.env, c.actor, 'job.hire', `app=${a.id} student=${a.student_id}`);
  return { ok: true };
});

add('POST', '/api/classes/:id/applications/:aid/decline', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const a = await ownApp(c, cls, c.params.aid);
  const r = await run(c.env, "UPDATE job_applications SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'", new Date().toISOString(), c.actor, a.id);
  if (!r.meta.changes) throw bad('That application is not waiting for a decision.');
  await audit(c.env, c.actor, 'job.decline', `app=${a.id}`);
  return { ok: true };
});

// "Fire" / end a job. Stops future pay; pay already made stays.
add('POST', '/api/classes/:id/applications/:aid/end', 'staff', async (c) => {
  const cls = await ownClass(c, c.params.id);
  const a = await ownApp(c, cls, c.params.aid);
  const r = await endHire(c.env, 'id = ?', todayStr(c.env), new Date().toISOString(), c.actor, a.id);
  if (!r.meta.changes) throw bad('That student does not currently hold this job.');
  await audit(c.env, c.actor, 'job.end', `app=${a.id}`);
  return { ok: true };
});

// Admin: run payroll by hand (it also runs by itself every hour).
add('POST', '/api/admin/payroll/run', 'admin', async (c) => {
  const asOf = c.body.as_of ? V.date(c.body.as_of, 'Date') : null;
  const r = await runPayroll(c.env, asOf);
  await audit(c.env, c.actor, 'payroll.run', `paid=${r.paid}`);
  return r;
});

// ---- Student ---------------------------------------------------------------------------
async function memberClass(env, student, idParam) {
  const id = V.int(idParam, 'class', { min: 1 });
  const cls = await one(env,
    `SELECT c.id, c.name, c.period, COALESCE(u.last_name, u.name) AS teacher FROM class_members m
       JOIN classes c ON c.id = m.class_id JOIN users u ON u.id = c.owner_id
      WHERE m.class_id = ? AND m.student_id = ? AND c.archived = 0`, id, student.student_id);
  if (!cls) throw new HttpError(404, 'Class not found.');
  return cls;
}

add('GET', '/api/student/classes/:id/jobs', 'student', async ({ env, student, params }) => {
  const cls = await memberClass(env, student, params.id);
  const jobs = await all(env,
    `SELECT j.id, j.title, j.description, j.salary, j.slots,
            (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = j.id AND a.status = 'hired') AS filled
       FROM class_jobs j WHERE j.class_id = ? AND j.active = 1 ORDER BY j.title`, cls.id);
  const mine = await all(env,
    "SELECT id, job_id, status, message, applied_at, hired_on FROM job_applications WHERE class_id = ? AND student_id = ? AND status IN ('pending','hired')", cls.id, student.student_id);
  for (const j of jobs) j.mine = mine.find((a) => a.job_id === j.id) || null;
  return { class: cls, jobs, has_job: mine.some((a) => a.status === 'hired') };
});

add('POST', '/api/student/classes/:id/jobs/:jid/apply', 'student', async ({ env, student, params, body, actor }) => {
  const cls = await memberClass(env, student, params.id);
  const jid = V.int(params.jid, 'job', { min: 1 });
  const job = await one(env, 'SELECT * FROM class_jobs WHERE id = ? AND class_id = ? AND active = 1', jid, cls.id);
  if (!job) throw new HttpError(404, 'Job not found.');
  const message = V.str(body.message, 'Your application', { max: 600 });
  if (message.length < 20) throw bad('Tell your teacher a bit more about why you would be good at this job (at least a couple of sentences).');
  if (await one(env, "SELECT 1 AS x FROM job_applications WHERE class_id = ? AND student_id = ? AND status = 'hired'", cls.id, student.student_id)) {
    throw bad('You already have a job in this class.');
  }
  try {
    await run(env, 'INSERT INTO job_applications (job_id, class_id, student_id, message) VALUES (?,?,?,?)', job.id, cls.id, student.student_id, message);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw bad('You already applied for this job.');
    throw e;
  }
  await audit(env, actor, 'job.apply', `job=${job.id}`);
  return { ok: true };
});

add('DELETE', '/api/student/applications/:aid', 'student', async ({ env, student, params, actor }) => {
  const id = V.int(params.aid, 'application', { min: 1 });
  const r = await run(env, "UPDATE job_applications SET status = 'withdrawn', decided_at = ? WHERE id = ? AND student_id = ? AND status = 'pending'", new Date().toISOString(), id, student.student_id);
  if (!r.meta.changes) throw new HttpError(404, 'Application not found.');
  await audit(env, actor, 'job.withdraw', `app=${id}`);
  return { ok: true };
});
