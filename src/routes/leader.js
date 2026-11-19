// Student leaders can see and fulfil School Store orders. Nothing else: no balances, no refunds, no cancelling,
// and no orders for teachers' own custom rewards.
import { add } from '../router.js';
import { all, one, run, audit } from '../lib/db.js';
import { V, bad, HttpError } from '../lib/util.js';

const leaderOnly = (c) => {
  if (!c.student.leadership) throw new HttpError(403, 'This page is only for student leaders.');
};

add('GET', '/api/student/leader/orders', 'student', async (c) => {
  leaderOnly(c);
  const status = c.url.searchParams.get('status') || 'pending';
  V.oneOf(status, 'status', ['pending', 'fulfilled']);
  const rows = await all(c.env,
    `SELECT o.id, o.status, o.created_at, o.fulfilled_by, o.fulfilled_at, s.student_id, s.last_name, s.first_name, s.grade,
            s.homeroom_teacher, s.room, i.name AS item, i.emoji, (s.student_id = ?) AS mine
       FROM store_orders o JOIN students s ON s.student_id = o.student_id JOIN store_items i ON i.id = o.item_id
      WHERE o.status = ? AND i.owner_id IS NULL ORDER BY ${status === 'pending' ? 'o.id' : 'o.fulfilled_at DESC'} LIMIT 200`,
    c.student.student_id, status);
  return { orders: rows };
});

add('POST', '/api/student/leader/orders/:id/fulfill', 'student', async (c) => {
  leaderOnly(c);
  const id = V.int(c.params.id, 'id', { min: 1 });
  const o = await one(c.env, 'SELECT o.id, o.student_id, i.owner_id FROM store_orders o JOIN store_items i ON i.id = o.item_id WHERE o.id = ?', id);
  if (!o || o.owner_id !== null) throw new HttpError(404, 'Order not found.');
  if (o.student_id === c.student.student_id) throw bad('You cannot hand out your own order. Ask another leader or a teacher.');
  const who = `${c.student.first_name} ${c.student.last_name} (student leader)`;
  const r = await run(c.env, "UPDATE store_orders SET status='fulfilled', fulfilled_by=?, fulfilled_at=? WHERE id=? AND status='pending'", who, new Date().toISOString(), id);
  if (!r.meta.changes) throw bad('That order is not pending.');
  await audit(c.env, c.actor, 'store.fulfill', `order=${id} by_leader`);
  return { ok: true };
});
