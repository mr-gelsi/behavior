import { state, api, h, raw, mount, $, $$, toast, fail, confirmBox, fmtMD, fmtDate, fmtDT, pct } from './core.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);
const TYPE_LABEL = { award: 'Earned', fine: 'Fine', purchase: 'Store', refund: 'Refund', seat: 'Rewards Day seat', seat_refund: 'Seat refund', adjustment: 'Adjustment' };

export async function studentHome(el) {
  loading(el);
  const d = await api('/student/home');
  mount(el, h`
    <h1>Hi, ${d.student.first_name}! \ud83d\udc4b</h1>
    <p class="muted">Your P5 points: Prompt, Prepared, Positive, Polite, Productive</p>
    <div class="card"><div class="muted">Your balance</div><div class="balance-hero"><span class="big">${d.balance}</span><span class="muted">P5 points</span></div>
      <div class="pills mt14"><a class="pill-btn primary" href="#/shop">Visit the store</a><a class="pill-btn" href="#/seat">Reserve a Rewards Day seat</a></div></div>
    <div class="card"><h2>Your recent points</h2>
      ${d.ledger.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>What</th><th>For</th><th class="num">Points</th><th>Note</th></tr></thead><tbody>
        ${d.ledger.map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${TYPE_LABEL[x.type] || x.type}</td><td>${x.category ? `${x.emoji || ''} ${x.category}` : ''}</td>
          <td class="num ${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${x.amount}</td><td>${x.note || ''}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>No points yet</strong>Teachers award P5 points when you\u2019re prompt, prepared, positive, polite, or productive.</div>`}</div>`);
}

export async function studentStore(el) {
  loading(el);
  const [s, o] = await Promise.all([api('/student/store'), api('/student/orders')]);
  mount(el, h`
    <div class="page-head"><div><h1>\ud83d\udecd\ufe0f P5 store</h1><p class="muted">Spend your points on rewards</p></div>
      <div class="card chip-card"><span class="muted">Your balance</span> <strong class="bal-num">${s.balance}</strong> <span class="muted">P5</span></div></div>
    ${s.items.length ? h`<div class="shop-grid">${s.items.map((i) => {
      const blocked = i.sold_out || i.at_limit || i.short_by > 0;
      const why = i.sold_out ? 'Sold out' : i.at_limit ? 'You\u2019ve reached the limit' : i.short_by > 0 ? `You need ${i.short_by} more P5` : '';
      return h`<div class="shop-card"><div class="em">${i.emoji || '\ud83c\udf81'}</div><strong>${i.name}</strong><div class="muted small grow">${i.description || ''}</div>
        <div class="price">${i.price} P5</div>
        ${i.stock !== null && !i.sold_out ? h`<div class="muted small">${i.stock} left</div>` : ''}
        <button class="btn ${blocked ? '' : 'primary'}" data-buy="${i.id}" ${blocked ? raw('disabled') : ''}>${blocked ? why : 'Buy'}</button></div>`;
    })}</div>` : h`<div class="card"><div class="empty"><strong>The store is empty</strong>Check back soon.</div></div>`}
    <div class="card mt16"><h2>Your orders</h2>
      ${o.orders.length ? h`<div class="table-wrap"><table><thead><tr><th>Ordered</th><th>Item</th><th class="num">Paid</th><th>Status</th><th></th></tr></thead><tbody>
        ${o.orders.map((x) => h`<tr><td class="nowrap">${fmtDT(x.created_at)}</td><td>${x.emoji || ''} ${x.name}</td><td class="num">${x.price_paid}</td>
          <td><span class="chip ${x.status === 'fulfilled' ? 'ok' : x.status === 'cancelled' ? 'gray' : 'step'}">${x.status === 'pending' ? 'Waiting for pickup' : x.status === 'fulfilled' ? 'Received' : 'Cancelled'}</span></td>
          <td>${x.status === 'pending' ? h`<button class="btn small danger" data-cancel="${x.id}">Cancel and get points back</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>No orders yet</strong>When you buy something, it shows up here.</div>`}</div>`);
  $$('[data-buy]', el).forEach((b) => b.addEventListener('click', async () => {
    const item = s.items.find((i) => String(i.id) === b.dataset.buy);
    if (!(await confirmBox(`Buy \u201c${item.name}\u201d for ${item.price} P5? You\u2019ll have ${s.balance - item.price} P5 left.`, { ok: 'Buy it' }))) return;
    b.disabled = true;
    try { await api(`/student/store/${item.id}/buy`, { method: 'POST', body: {} }); toast(`You bought ${item.name}! Your teacher will give it to you.`); studentStore(el).catch(fail); }
    catch (e) { fail(e); studentStore(el).catch(fail); }
  }));
  $$('[data-cancel]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Cancel this order? You\u2019ll get your points back.', { ok: 'Cancel order', danger: true }))) return;
    try { await api(`/student/orders/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); toast('Order cancelled. Your points are back.'); studentStore(el).catch(fail); } catch (e) { fail(e); }
  }));
}

export async function studentSeat(el) {
  loading(el);
  const d = await api('/student/reward-day');
  if (!d.day) {
    mount(el, h`<h1>\ud83c\udf9f\ufe0f Reserve a seat</h1><div class="card"><div class="empty"><strong>No Rewards Day is open for booking right now</strong>When your teachers set one up, it will show here.</div></div>`);
    return;
  }
  const day = d.day;
  const head = h`<div class="page-head"><div><h1>\ud83c\udf9f\ufe0f ${day.name}</h1><p class="muted">${fmtDate(day.reward_date)}</p></div>
    <div class="card chip-card"><span class="muted">Your balance</span> <strong class="bal-num">${d.balance}</strong> <span class="muted">P5</span></div></div>`;

  if (!d.qualified) {
    mount(el, h`${head}<div class="card"><h2>Your Rewards Day room</h2>
      ${d.booking ? h`<p class="fs18">You\u2019re in <strong>${d.booking.name}</strong>${d.booking.location ? ' (' + d.booking.location + ')' : ''}.</p>`
        : h`<p>Your room for Rewards Day will show here soon.</p>`}
      <p class="muted">Questions? Please see your teacher.</p></div>`);
    return;
  }

  const banner = day.window === 'before' ? h`<div class="banner info">Booking opens ${fmtDT(day.booking_opens_at)}.</div>`
    : day.window === 'closed' ? h`<div class="banner info">Booking has closed${d.booking ? '. Here\u2019s where you\u2019ll be.' : '. Please see your teacher about your Rewards Day plan.'}</div>`
    : d.booking ? h`<div class="banner info">You have a seat in <strong>${d.booking.name}</strong>. You can switch or cancel until ${fmtDT(day.booking_closes_at)}.</div>`
    : h`<div class="banner warn">You haven\u2019t picked an activity yet. Booking closes ${fmtDT(day.booking_closes_at)}.</div>`;
  const open = day.window === 'open';
  mount(el, h`${head}${banner}
    ${d.activities.length ? h`<div class="grid-gap12">${d.activities.map((a) => {
      const mine = d.booking && d.booking.activity_id === a.id;
      const full = a.left <= 0 && !mine;
      const short = !mine && a.p5_cost > d.balance + (d.booking ? d.booking.p5_cost_paid : 0);
      const label = mine ? '\u2713 Your seat' : !a.grade_ok ? 'Not open to your grade' : full ? 'Full' : short ? `Need ${a.p5_cost - d.balance - (d.booking ? d.booking.p5_cost_paid : 0)} more P5` : d.booking ? 'Switch to this' : 'Reserve a seat';
      const disabled = !open || mine || full || short || !a.grade_ok;
      return h`<div class="seat-card ${mine ? 'mine' : ''} ${full ? 'full' : ''}">
        <div class="row jc-between"><strong class="fs18">${a.name}</strong><span class="chip gray">${a.p5_cost === 0 ? 'Free' : a.p5_cost + ' P5'}</span></div>
        ${a.description ? h`<div class="muted">${a.description}</div>` : ''}
        <div class="seat-meta">${a.location ? h`<span>\ud83d\udccd ${a.location}</span>` : ''}<span>${a.left} of ${a.capacity} seats left</span></div>
        <div class="bar thin ${a.left > 0 ? 'green' : ''}"><i data-w="${pct(a.capacity - a.left, a.capacity)}"></i></div>
        <div class="row"><button class="btn ${disabled ? '' : 'primary'}" data-book="${a.id}" ${disabled ? raw('disabled') : ''}>${label}</button>
          ${mine && open ? h`<button class="btn danger" data-cancel>Cancel my seat</button>` : ''}</div></div>`;
    })}</div>` : h`<div class="card"><div class="empty"><strong>No activities yet</strong>Check back soon.</div></div>`}`);
  $$('[data-book]', el).forEach((b) => b.addEventListener('click', async () => {
    const a = d.activities.find((x) => String(x.id) === b.dataset.book);
    const msg = d.booking
      ? `Switch to \u201c${a.name}\u201d? Your seat in \u201c${d.booking.name}\u201d is cancelled and its points come back.${a.p5_cost ? ` This one costs ${a.p5_cost} P5.` : ''}`
      : `Reserve a seat in \u201c${a.name}\u201d?${a.p5_cost ? ` It costs ${a.p5_cost} P5. You\u2019ll have ${d.balance - a.p5_cost} left.` : ' It\u2019s free.'}`;
    if (!(await confirmBox(msg, { ok: d.booking ? 'Switch' : 'Reserve' }))) return;
    b.disabled = true;
    try { await api('/student/reward-day/book', { method: 'POST', body: { activity_id: a.id } }); toast(`You\u2019re in ${a.name}!`); }
    catch (e) { fail(e); }
    studentSeat(el).catch(fail);
  }));
  const c = $('[data-cancel]', el);
  if (c) c.addEventListener('click', async () => {
    if (!(await confirmBox('Cancel your seat? Your points come back to you.', { ok: 'Cancel seat', danger: true }))) return;
    try { await api('/student/reward-day/booking', { method: 'DELETE' }); toast('Seat cancelled. Your points are back.'); } catch (e) { fail(e); }
    studentSeat(el).catch(fail);
  });
}
