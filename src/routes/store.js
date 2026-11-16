import { add } from '../router.js';
import { all, one, st, batch, audit, balanceOf } from '../lib/db.js';
import { V, bad, HttpError, todayStr } from '../lib/util.js';
import { canManageItem, canSeeItem } from '../lib/store.js';

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

add('GET', '/api/store/items', 'staff', async ({ env, user }) => {
  const rows = await all(env,
    `SELECT i.*, u.name AS owner_name, u.last_name AS owner_last_name FROM store_items i LEFT JOIN users u ON u.id = i.owner_id
      WHERE (? = 1 OR i.owner_id IS NULL OR i.owner_id = ?) ORDER BY i.active DESC, i.price, i.name`,
    user.role === 'admin' ? 1 : 0, user.id);
  const used = await all(env,
    `SELECT r.item_id, c.id AS class_id, c.name, c.period FROM class_rewards r JOIN classes c ON c.id = r.class_id
      WHERE c.archived = 0 ORDER BY c.name`);
  return {
    items: rows.map((i) => ({
      ...i,
      scope: i.owner_id === null ? 'school' : 'custom',
      can_edit: canManageItem(user, i),
      mine: i.owner_id !== null && i.owner_id === user.id,
      classes: used.filter((u) => u.item_id === i.id).map((u) => ({ id: u.class_id, name: u.name, period: u.period })),
    })),
  };
});

// Admins create school rewards. Teachers (and Admins) create custom rewards that only their
// own classes can switch on.
add('POST', '/api/store/items', 'staff', async (c) => {
  const admin = c.user.role === 'admin';
  const scope = V.oneOf(c.body.scope || (admin ? 'school' : 'mine'), 'Scope', ['school', 'mine']);
  if (scope === 'school' && !admin) throw new HttpError(403, 'Only an Admin can add school rewards. You can add your own class rewards instead.');
  const f = itemFields(c.body);
  const owner = scope === 'mine' ? c.user.id : null;
  if (owner !== null) {
    const n = (await one(c.env, 'SELECT COUNT(*) AS n FROM store_items WHERE owner_id = ?', owner)).n;
    if (n >= 100) throw bad('You have a lot of custom rewards. Hide some you no longer use instead of adding more.');
  }
  const r = await c.env.DB.prepare('INSERT INTO store_items (name, description, price, stock, max_per_student, emoji, active, owner_id) VALUES (?,?,?,?,?,?,?,?)')
    .bind(f.name, f.description, f.price, f.stock, f.max_per_student, f.emoji, f.active, owner).run();
  await audit(c.env, c.actor, 'store.item_create', `${scope}: ${f.name}`);
  return { ok: true, id: r.meta.last_row_id };
});

add('PATCH', '/api/store/items/:id', 'staff', async (c) => {
  const id = V.int(c.params.id, 'id', { min: 1 });
  const cur = await one(c.env, 'SELECT * FROM store_items WHERE id = ?', id);
  if (!cur || !canSeeItem(c.user, cur)) throw new HttpError(404, 'Item not found.');
  if (!canManageItem(c.user, cur)) throw new HttpError(403, 'Only an Admin can change school rewards.');
  const f = itemFields(c.body, cur);
  await c.env.DB.prepare('UPDATE store_items SET name=?, description=?, price=?, stock=?, max_per_student=?, emoji=?, active=? WHERE id=?')
    .bind(f.name, f.description, f.price, f.stock, f.max_per_student, f.emoji, f.active, id).run();
  await audit(c.env, c.actor, 'store.item_update', `id=${id}`);
  return { ok: true };
});

add('GET', '/api/store/orders', 'staff', async ({ env, url, user }) => {
  const status = url.searchParams.get('status') || 'pending';
  V.oneOf(status, 'status', ['pending', 'fulfilled', 'cancelled', 'all']);
  const where = [];
  const p = [];
  if (status !== 'all') { where.push('o.status = ?'); p.push(status); }
  // Teachers see orders for school rewards and for their own custom rewards. Admins see everything.
  if (user.role !== 'admin') { where.push('(i.owner_id IS NULL OR i.owner_id = ?)'); p.push(user.id); }
  const rows = await all(env,
    `SELECT o.id, o.status, o.price_paid, o.created_at, o.fulfilled_by, o.fulfilled_at,
            s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, i.name AS item, i.emoji,
            CASE WHEN i.owner_id IS NULL THEN 0 ELSE 1 END AS custom
       FROM store_orders o JOIN students s ON s.student_id = o.student_id JOIN store_items i ON i.id = o.item_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 300`, ...p);
  return { orders: rows };
});

async function visibleOrder(c, idParam) {
  const id = V.int(idParam, 'id', { min: 1 });
  const o = await one(c.env, 'SELECT o.id, i.owner_id FROM store_orders o JOIN store_items i ON i.id = o.item_id WHERE o.id = ?', id);
  if (!o || !canSeeItem(c.user, o)) throw new HttpError(404, 'Order not found.');
  return id;
}

add('POST', '/api/store/orders/:id/fulfill', 'staff', async (c) => {
  const id = await visibleOrder(c, c.params.id);
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
  await cancelOrder(c.env, await visibleOrder(c, c.params.id), c.actor);
  return { ok: true };
});

// Printable pick list: pending orders grouped by homeroom teacher.
add('GET', '/api/store/picklist', 'staff', async ({ env, user }) => ({
  rows: await all(env,
    `SELECT COALESCE(s.homeroom_teacher, '(no homeroom)') AS homeroom, s.last_name, s.first_name, s.grade, i.name AS item, i.emoji, o.id AS order_id
       FROM store_orders o JOIN students s ON s.student_id = o.student_id JOIN store_items i ON i.id = o.item_id
      WHERE o.status = 'pending' AND (? = 1 OR i.owner_id IS NULL OR i.owner_id = ?)
      ORDER BY homeroom, s.last_name, s.first_name`, user.role === 'admin' ? 1 : 0, user.id),
}));
