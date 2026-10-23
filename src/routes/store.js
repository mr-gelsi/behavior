import { add } from '../router.js';
import { all, one, st, batch, audit, balanceOf } from '../lib/db.js';
import { V, bad, HttpError, todayStr } from '../lib/util.js';

function itemFields(body, existing = {}) {
  return {
    name: V.str(body.name ?? existing.name, 'Name', { max: 60 }),
    description: V.str(body.description ?? existing.description, 'Description', { max: 200, optional: true }),
    price: V.int(body.price ?? existing.price, 'Price', { min: 1, max: 100000 }),
    stock: V.int(body.stock === undefined ? existing.stock : body.stock, 'Stock', { min: 0, max: 100000, optional: true }),
    max_per_student: V.int(body.max_per_student === undefined ? existing.max_per_student : body.max_per_student, 'Limit per student', { min: 1, max: 1000, optional: true }),
    emoji: V.str(body.emoji ?? existing.emoji, 'Emoji', { max: 8, optional: true }),
    active: (body.active ?? existing.active ?? 1) ? 1 : 0,
  };
}

add('GET', '/api/store/items', 'staff', async ({ env }) => ({
  items: await all(env, 'SELECT * FROM store_items ORDER BY active DESC, price, name'),
}));

add('POST', '/api/store/items', 'staff', async (c) => {
  const f = itemFields(c.body);
  await c.env.DB.prepare('INSERT INTO store_items (name, description, price, stock, max_per_student, emoji, active) VALUES (?,?,?,?,?,?,?)')
    .bind(f.name, f.description, f.price, f.stock, f.max_per_student, f.emoji, f.active).run();
  await audit(c.env, c.actor, 'store.item_create', f.name);
  return { ok: true };
});

add('PATCH', '/api/store/items/:id', 'staff', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const cur = await one(c.env, 'SELECT * FROM store_items WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Item not found.');
  const f = itemFields(c.body, cur);
  await c.env.DB.prepare('UPDATE store_items SET name=?, description=?, price=?, stock=?, max_per_student=?, emoji=?, active=? WHERE id=?')
    .bind(f.name, f.description, f.price, f.stock, f.max_per_student, f.emoji, f.active, id).run();
  await audit(c.env, c.actor, 'store.item_update', `id=${id}`);
  return { ok: true };
});

add('GET', '/api/store/orders', 'staff', async ({ env, url }) => {
  const status = url.searchParams.get('status') || 'pending';
  V.oneOf(status, 'status', ['pending', 'fulfilled', 'cancelled', 'all']);
  const rows = await all(env,
    `SELECT o.id, o.status, o.price_paid, o.created_at, o.fulfilled_by, o.fulfilled_at,
            s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, i.name AS item, i.emoji
       FROM store_orders o JOIN students s ON s.student_id = o.student_id JOIN store_items i ON i.id = o.item_id
      ${status === 'all' ? '' : 'WHERE o.status = ?'} ORDER BY o.id DESC LIMIT 300`, ...(status === 'all' ? [] : [status]));
  return { orders: rows };
});

add('POST', '/api/store/orders/:id/fulfill', 'staff', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const r = await c.env.DB.prepare("UPDATE store_orders SET status='fulfilled', fulfilled_by=?, fulfilled_at=? WHERE id=? AND status='pending'")
    .bind(c.user.name, new Date().toISOString(), id).run();
  if (!r.meta.changes) throw bad('That order is not pending.');
  await audit(c.env, c.actor, 'store.fulfill', `order=${id}`);
  return { ok: true };
});

export async function cancelOrder(env, orderId, actor, studentId = null) {
  const today = todayStr(env);
  const res = await batch(env, [
    st(env, `UPDATE store_orders SET status='cancelled' WHERE id=? AND status='pending' ${studentId ? 'AND student_id = ?' : ''}`, orderId, ...(studentId ? [studentId] : [])),
    st(env,
      `INSERT INTO p5_transactions (student_id, type, amount, note, created_by, tx_date, related_id)
       SELECT student_id, 'refund', price_paid, 'Refund: store order #' || id, ?, ?, id FROM store_orders
        WHERE id = ? AND status = 'cancelled' AND changes() = 1`, actor, today, orderId),
    st(env,
      `UPDATE store_items SET stock = stock + 1
        WHERE id = (SELECT item_id FROM store_orders WHERE id = ?) AND stock IS NOT NULL AND changes() = 1`, orderId),
  ]);
  if (!res[0].meta.changes) throw bad('Only pending orders can be cancelled.');
  await audit(env, actor, 'store.cancel', `order=${orderId}`);
}

add('POST', '/api/store/orders/:id/cancel', 'staff', async (c) => {
  await cancelOrder(c.env, V.int(c.params.id, 'id', { min: 1 }), c.actor);
  return { ok: true };
});

// Printable pick list: pending orders grouped by homeroom teacher.
add('GET', '/api/store/picklist', 'staff', async ({ env }) => ({
  rows: await all(env,
    `SELECT COALESCE(s.homeroom_teacher, '(no homeroom)') AS homeroom, s.last_name, s.first_name, s.grade, i.name AS item, i.emoji, o.id AS order_id
       FROM store_orders o JOIN students s ON s.student_id = o.student_id JOIN store_items i ON i.id = o.item_id
      WHERE o.status = 'pending' ORDER BY homeroom, s.last_name, s.first_name`),
}));
