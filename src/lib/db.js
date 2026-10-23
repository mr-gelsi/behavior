// Thin helpers over the D1 binding, plus settings and audit logging.

export const all = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results;
export const one = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).first()) || null;
export const run = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();
export const st = (env, sql, ...p) => env.DB.prepare(sql).bind(...p);

// Run statements atomically in groups. Each D1 batch is one transaction.
export async function batch(env, stmts) {
  if (!stmts.length) return [];
  return env.DB.batch(stmts);
}

// For big imports: several independent batches (each atomic on its own).
export async function chunked(env, stmts, size = 40) {
  const out = [];
  for (let i = 0; i < stmts.length; i += size) out.push(...(await env.DB.batch(stmts.slice(i, i + size))));
  return out;
}

export async function audit(env, actor, action, detail = '') {
  await run(env, 'INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)', actor, action, String(detail).slice(0, 500));
}

export const SETTING_DEFAULTS = {
  school_name: 'Your School',
  nonqual_min_step: '2',
  nonqual_step1_count: '2',
  teacher_max_p5: '10',
  allow_negative_balance: '1',
  code_label: 'Code',
};

export async function getSettings(env) {
  const rows = await all(env, 'SELECT key, value FROM settings');
  const s = { ...SETTING_DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return {
    school_name: s.school_name,
    nonqual_min_step: Number(s.nonqual_min_step),
    nonqual_step1_count: Number(s.nonqual_step1_count),
    teacher_max_p5: Number(s.teacher_max_p5),
    allow_negative_balance: s.allow_negative_balance === '1',
    code_label: s.code_label,
  };
}

export const balanceOf = async (env, studentId) =>
  (await one(env, 'SELECT COALESCE(SUM(amount),0) AS b FROM p5_transactions WHERE student_id = ?', studentId)).b;
