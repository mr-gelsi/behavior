// Student portal: My P5, Store. (Reserve a Seat lives in rewards.js.)
import { add } from '../router.js';
import { all, one, st, batch, audit, balanceOf } from '../lib/db.js';
import { V, bad, todayStr } from '../lib/util.js';
import { cancelOrder } from './store.js';

add('GET', '/api/student/home', 'student', async ({ env, student }) => ({
  student: { first_name: student.first_name, last_name: student.last_name, grade: student.grade },
  balance: await balanceOf(env, student.student_id),
  ledger: await all(env,
    `SELECT p.id, p.type, p.amount, p.note, p.tx_date, c.name AS category, c.emoji
       FROM p5_transactions p LEFT JOIN p5_categories c ON c.id = p.category_id
      WHERE p.student_id = ? ORDER BY p.id DESC LIMIT 50`, student.student_id),
}));

add('GET', '/api/student/store', 'student', async ({ env, student }) => {
  const balance = await balanceOf(env, student.student_id);
  const items = await all(env,
    `SELECT i.id, i.name, i.description, i.price, i.stock, i.max_per_student, i.emoji,
            (SELECT COUNT(*) FROM store_orders o WHERE o.item_id = i.id AND o.student_id = ? AND o.status <> 'cancelled') AS mine
       FROM store_items i WHERE i.active = 1 ORDER BY i.price, i.name`, student.student_id);
  return {
    balance,
    items: items.map((i) => ({
      ...i,
      sold_out: i.stock !== null && i.stock <= 0,
      at_limit: i.max_per_student !== null && i.mine >= i.max_per_student,
      short_by: Math.max(0, i.price - balance),
    })),
  };
});

add('POST', '/api/student/store/:id/buy', 'student', async (c) => {
  const { env, student } = c;
  const itemId = V.int(c.params.id, 'item', { min: 1 });
  const item = await one(env, 'SELECT * FROM store_items WHERE id = ? AND active = 1', itemId);
  if (!item) throw bad('That item is not available.');
  const today = todayStr(env);
  const res = await batch(env, [
    st(env,
      `INSERT INTO store_orders (student_id, item_id, price_paid, status)
       SELECT ?, ?, ?, 'pending'
        WHERE (SELECT COALESCE(SUM(amount), 0) FROM p5_transactions WHERE student_id = ?) >= ?
          AND (SELECT stock FROM store_items WHERE id = ?) IS NOT 0
          AND (SELECT active FROM store_items WHERE id = ?) = 1
          AND ((SELECT max_per_student FROM store_items WHERE id = ?) IS NULL
               OR (SELECT COUNT(*) FROM store_orders WHERE student_id = ? AND item_id = ? AND status <> 'cancelled')
                  < (SELECT max_per_student FROM store_items WHERE id = ?))`,
      student.student_id, itemId, item.price, student.student_id, item.price, itemId, itemId, itemId, student.student_id, itemId, itemId),
    st(env,
      `INSERT INTO p5_transactions (student_id, type, amount, note, created_by, tx_date, related_id)
       SELECT ?, 'purchase', ?, ?, ?, ?, (SELECT MAX(id) FROM store_orders WHERE student_id = ? AND item_id = ?) WHERE changes() = 1`,
      student.student_id, -item.price, `Store: ${item.name}`.slice(0, 120), c.actor, today, student.student_id, itemId),
    st(env, 'UPDATE store_items SET stock = stock - 1 WHERE id = ? AND stock IS NOT NULL AND changes() = 1', itemId),
  ]);
  if (!res[0].meta.changes) {
    const fresh = await one(env, 'SELECT stock, max_per_student FROM store_items WHERE id = ?', itemId);
    const bal = await balanceOf(env, student.student_id);
    if (bal < item.price) throw bad(`You need ${item.price - bal} more P5 to buy this.`);
    if (fresh.stock === 0) throw bad('Sorry, this item just sold out.');
    throw bad('You\u2019ve reached the limit for this item.');
  }
  await audit(env, c.actor, 'store.buy', `item=${itemId} price=${item.price}`);
  return { ok: true, balance: await balanceOf(env, student.student_id) };
});

add('GET', '/api/student/orders', 'student', async ({ env, student }) => ({
  orders: await all(env,
    `SELECT o.id, o.status, o.price_paid, o.created_at, i.name, i.emoji FROM store_orders o JOIN store_items i ON i.id = o.item_id
      WHERE o.student_id = ? ORDER BY o.id DESC LIMIT 50`, student.student_id),
}));

add('POST', '/api/student/orders/:id/cancel', 'student', async (c) => {
  await cancelOrder(c.env, V.int(c.params.id, 'id', { min: 1 }), c.actor, c.student.student_id);
  return { ok: true, balance: await balanceOf(c.env, c.student.student_id) };
});
