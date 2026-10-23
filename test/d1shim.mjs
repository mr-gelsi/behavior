// Minimal D1 look-alike on top of node:sqlite so the Worker can be tested without Cloudflare.
import { DatabaseSync } from 'node:sqlite';

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(norm)); }
  _exec() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(select|with)\b/i.test(this.sql)) {
      return { results: stmt.all(...this.params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    }
    const r = stmt.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this._exec(); }
  async first() { return this._exec().results[0] ?? null; }
  async run() { return this._exec(); }
}

export class D1Shim {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._exec());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
