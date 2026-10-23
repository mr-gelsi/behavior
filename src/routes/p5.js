import { add } from '../router.js';
import { all, one, st, batch, audit, getSettings } from '../lib/db.js';
import { V, bad, HttpError, todayStr, schoolYearOf } from '../lib/util.js';
import { afterStepChange } from './students.js';

add('GET', '/api/p5/categories', 'any', async ({ env }) => ({
  categories: await all(env, 'SELECT id, name, emoji, color FROM p5_categories ORDER BY sort'),
}));

// Award or fine one or more students. Optionally adds a linked step (fines only).
add('POST', '/api/p5', 'staff', async (c) => {
  const { env, body, user } = c;
  const settings = await getSettings(env);
  const mode = V.oneOf(body.mode, 'Mode', ['award', 'fine']);
  if (!Array.isArray(body.student_ids) || body.student_ids.length < 1) throw bad('Choose at least one student.');
  if (body.student_ids.length > 120) throw bad('Choose 120 students or fewer at a time.');
  const ids = [...new Set(body.student_ids.map((x) => V.int(x, 'Student', { min: 1 })))];
  const cat = await one(env, 'SELECT id, name FROM p5_categories WHERE id = ?', V.int(body.category_id, 'What is it for?', { min: 1 }));
  if (!cat) throw bad('Choose what the points are for.');
  const maxAmt = user.role === 'admin' ? 1000 : settings.teacher_max_p5;
  const amount = V.int(body.amount, 'Amount', { min: 1, max: maxAmt });
  const note = V.str(body.note, 'Note', { max: 200, optional: true });
  const date = V.date(body.date || todayStr(env), 'Date');
  const wantStep = mode === 'fine' && body.step && body.step.add;
  const level = wantStep ? V.int(body.step.level, 'Step level', { min: 1, max: 5 }) : null;
  const period = wantStep ? V.str(body.step.period, 'Period', { max: 10, optional: true }) : null;

  const found = await all(env, `SELECT student_id FROM students WHERE active = 1 AND student_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (found.length !== ids.length) throw bad('One or more students were not found.');

  const sign = mode === 'award' ? 1 : -1;
  const stmts = [];
  let applied = 0;
  const results = [];
  for (const id of ids) {
    let amt = amount;
    if (mode === 'fine' && !settings.allow_negative_balance) {
      const bal = (await one(env, 'SELECT COALESCE(SUM(amount),0) AS b FROM p5_transactions WHERE student_id = ?', id)).b;
      amt = Math.max(0, Math.min(amount, bal));
    }
    const stepNotes = wantStep ? `P5 fine: ${cat.name}.${note ? ' ' + note : ''}`.slice(0, 300) : null;
    if (amt > 0) {
      stmts.push(st(env,
        `INSERT INTO p5_transactions (student_id, type, category_id, amount, note, teacher, created_by, tx_date)
         VALUES (?,?,?,?,?,?,?,?)`, id, mode, cat.id, sign * amt, note, user.name, user.email, date));
      if (wantStep) {
        stmts.push(st(env,
          `INSERT INTO steps (student_id, step_level, step_date, teacher, period, notes, source, p5_transaction_id, created_by, school_year)
           VALUES (?,?,?,?,?,?, 'p5_fine', last_insert_rowid(), ?, ?)`,
          id, level, date, user.name, period, stepNotes, user.email, schoolYearOf(date)));
        stmts.push(st(env,
          `UPDATE p5_transactions SET linked_step_id = last_insert_rowid()
            WHERE id = (SELECT p5_transaction_id FROM steps WHERE id = last_insert_rowid())`));
      }
      applied++;
    } else if (wantStep) {
      stmts.push(st(env,
        `INSERT INTO steps (student_id, step_level, step_date, teacher, period, notes, source, created_by, school_year)
         VALUES (?,?,?,?,?,?, 'p5_fine', ?, ?)`,
        id, level, date, user.name, period, stepNotes, user.email, schoolYearOf(date)));
    }
    results.push({ student_id: id, applied: amt * sign });
  }
  await batch(env, stmts); // one atomic batch: everything saves, or nothing does
  await audit(env, c.actor, `p5.${mode}`, `students=${ids.length} amount=${amount} cat=${cat.name} step=${wantStep ? level : 'no'}`);
  if (wantStep) await afterStepChange(c);
  const bals = await all(env,
    `SELECT student_id, COALESCE(SUM(amount),0) AS balance FROM p5_transactions
      WHERE student_id IN (${ids.map(() => '?').join(',')}) GROUP BY student_id`, ...ids);
  const balMap = new Map(bals.map((b) => [b.student_id, b.balance]));
  return { ok: true, results: results.map((r) => ({ ...r, balance: balMap.get(r.student_id) ?? 0 })) };
});

add('GET', '/api/p5/recent', 'staff', async ({ env }) => ({
  transactions: await all(env,
    `SELECT p.id, p.student_id, s.last_name, s.first_name, s.grade, p.type, p.amount, p.note, p.teacher, p.tx_date,
            p.created_by, p.created_at, p.linked_step_id, p.reversed_by, c.name AS category, c.emoji, c.color
       FROM p5_transactions p JOIN students s ON s.student_id = p.student_id
       LEFT JOIN p5_categories c ON c.id = p.category_id
      WHERE p.type IN ('award','fine','adjustment') ORDER BY p.id DESC LIMIT 50`),
}));

add('POST', '/api/p5/:id/reverse', 'staff', async (c) => {
  const { env, params, body, user } = c;
  const id = V.int(params.id, 'id', { min: 1 });
  const tx = await one(env, 'SELECT * FROM p5_transactions WHERE id = ?', id);
  if (!tx) throw new HttpError(404, 'Transaction not found.');
  if (!['award', 'fine'].includes(tx.type)) throw bad('Only awards and fines can be reversed here. Cancel store orders or seats from their own pages.');
  if (tx.reversed_by) throw bad('That transaction was already reversed.');
  if (user.role !== 'admin') {
    if (tx.created_by !== user.email) throw new HttpError(403, 'You can only reverse your own entries.');
    if (Date.now() - Date.parse(tx.created_at) > 7 * 24 * 3600 * 1000) throw new HttpError(403, 'Teachers can reverse entries from the past 7 days.');
  }
  const stmts = [
    st(env,
      `INSERT INTO p5_transactions (student_id, type, category_id, amount, note, teacher, created_by, tx_date, related_id)
       VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)`,
      tx.student_id, tx.category_id, -tx.amount, `Reversal of #${tx.id}`, user.name, user.email, todayStr(env), tx.id),
    st(env, 'UPDATE p5_transactions SET reversed_by = last_insert_rowid() WHERE id = ?', tx.id),
  ];
  if (body.delete_step && tx.linked_step_id) {
    stmts.push(st(env, 'DELETE FROM steps WHERE id = ? AND p5_transaction_id = ?', tx.linked_step_id, tx.id));
  }
  await batch(env, stmts);
  await audit(env, c.actor, 'p5.reverse', `tx=${id} delete_step=${!!body.delete_step}`);
  return { ok: true };
});

add('GET', '/api/p5/report', 'staff', async ({ env, url }) => {
  const from = V.date(url.searchParams.get('from') || todayStr(env).slice(0, 7) + '-01', 'from');
  const to = V.date(url.searchParams.get('to') || todayStr(env), 'to');
  const by = (sql) => all(env, sql, from, to);
  return {
    from, to,
    by_category: await by(`SELECT c.name AS label, COALESCE(SUM(CASE WHEN p.type='award' THEN p.amount END),0) AS awarded,
        COALESCE(-SUM(CASE WHEN p.type='fine' THEN p.amount END),0) AS fined
        FROM p5_categories c LEFT JOIN p5_transactions p ON p.category_id = c.id AND p.tx_date BETWEEN ? AND ? GROUP BY c.id ORDER BY c.sort`),
    by_grade: await by(`SELECT s.grade AS label, COALESCE(SUM(CASE WHEN p.type='award' THEN p.amount END),0) AS awarded,
        COALESCE(-SUM(CASE WHEN p.type='fine' THEN p.amount END),0) AS fined
        FROM p5_transactions p JOIN students s ON s.student_id = p.student_id WHERE p.tx_date BETWEEN ? AND ? GROUP BY s.grade ORDER BY s.grade`),
    by_teacher: await by(`SELECT p.teacher AS label, COALESCE(SUM(CASE WHEN p.type='award' THEN p.amount END),0) AS awarded,
        COALESCE(-SUM(CASE WHEN p.type='fine' THEN p.amount END),0) AS fined
        FROM p5_transactions p WHERE p.tx_date BETWEEN ? AND ? AND p.type IN ('award','fine') GROUP BY p.teacher ORDER BY awarded DESC`),
  };
});
