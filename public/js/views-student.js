import { state, api, h, raw, mount, $, $$, toast, fail, confirmBox, fmtMD, fmtDate, fmtDT, pct } from './core.js';

import { icon, trophy, medal } from './icons.js';
import { openBreakModal } from './views-breaks.js';
import { leaderTabs } from './views-extras.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);
const TYPE_LABEL = { award: 'Earned', fine: 'Fine', purchase: 'Store', refund: 'Refund', seat: 'Rewards Day seat', seat_refund: 'Seat refund', adjustment: 'Adjustment' };

const nf = (n) => Number(n).toLocaleString();

const TIER_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
function trophyShelf(d) {
  const won = d.trophies.filter((t) => t.tier);
  const cur = d.trophies.find((t) => t.current);
  const status = cur
    ? (cur.tier ? h`<p class="muted small">${cur.name} so far: you are in the top ${cur.top_percent}% of your grade, which is a ${TIER_NAME[cur.tier]} trophy. It becomes final when the period ends.</p>`
      : cur.earned ? h`<p class="muted small">${cur.name} so far: you are in the top ${cur.top_percent}% of your grade. Reach the top 30% for a trophy.</p>`
      : h`<p class="muted small">Earn P5 tickets in ${cur.name} to win a trophy.</p>`)
    : h``;
  return h`<p class="muted">Trophies go to the top ticket earners in your grade for each rewards period: <strong>Gold</strong> for the top 10%, <strong>Silver</strong> for 11\u201320%, <strong>Bronze</strong> for 21\u201330%.</p>${status}
    ${won.length ? h`<div class="shelf">${won.map((t) => h`<div class="award-tile tier-${t.tier}">${trophy(t.tier, 76)}<div class="at-title">${TIER_NAME[t.tier]}</div><div class="at-sub">${t.name}${t.final ? '' : ' (so far)'}</div><div class="at-sub">${t.earned} tickets earned</div></div>`)}</div>`
      : h`<div class="shelf"><div class="award-tile locked">${trophy(null, 76)}<div class="at-title">No trophies yet</div><div class="at-sub">Your first one is waiting</div></div></div>`}`;
}
function badgeCard(title, b, unit, help, pct) {
  const next = b.next ? `${b.next.need} more ${unit}${b.next.need === 1 ? '' : 's'} to ${b.next.name}` : 'Top level reached!';
  return h`<div class="badge-card">${medal(b.tier, String(b.count))}
    <div><h3>${b.count} ${title}</h3><p>${b.tier ? b.tier[0].toUpperCase() + b.tier.slice(1) + ' level. ' : ''}${next}</p><p>${help}</p>
    ${pct === null ? '' : h`<div class="prog" aria-hidden="true"><i data-w="${pct}"></i></div>`}</div></div>`;
}

export async function studentHome(el) {
  loading(el);
  const d = await api('/student/home');
  const per = d.period;
  const bonusTotal = d.bonuses.reduce((a, x) => a + x.amount, 0);
  const fineTotal = d.fines.reduce((a, x) => a - x.amount, 0);
  let open = null; // which panel is showing: 'bonus' | 'fines' | null
  mount(el, h`
    ${state.me.student.leadership ? leaderTabs('me') : ''}
    <div class="page-head"><div><h1>Hi, ${d.student.first_name}!</h1><p class="muted">Your P5 tickets: Prompt, Prepared, Positive, Polite, Productive</p></div>
      <div class="actions"><a class="btn primary" href="#/shop">${icon('store', 18)} Visit the store</a><a class="btn" href="#/seat">${icon('ticket', 18)} Reserve a seat</a></div></div>

    <div class="bank-top">
      <div class="bank-card" aria-label="P5 ticket account">
        <div class="bc-head"><span class="bc-chip">${icon('chip', 34)}</span><span class="bc-brand">P5 TICKETS</span></div>
        <div class="bc-label">Available balance</div>
        <div class="bc-balance"><span>${nf(d.balance)}</span><small>tickets</small></div>
        <div class="bc-acct"><span>ACCT</span><strong>${d.student.student_id}</strong></div>
        <div class="bc-name">${d.student.first_name} ${d.student.last_name}</div>
      </div>
      <div class="bank-stats">
        <div class="stat"><div class="stat-label">${icon('up', 16)} Total tickets \u00b7 all time</div><div class="stat-num">${nf(d.earned)}</div><div class="stat-sub">earned since you started</div></div>
        <div class="stat"><div class="stat-label">${icon('down', 16)} Total spent \u00b7 all time</div><div class="stat-num">${nf(d.spent)}</div><div class="stat-sub">store items and Rewards Day seats</div></div>
      </div>
    </div>

    <div class="bank-actions">
      <button type="button" class="bank-btn" data-p="bonus" aria-expanded="false">${icon('gift', 26)}<span class="bb-text"><strong>Bonuses</strong><span>${per ? per.name : 'This rewards period'} \u00b7 ${d.bonuses.length} earned</span></span><span class="bb-amt pos">+${nf(bonusTotal)}</span></button>
      <button type="button" class="bank-btn" data-p="fines" aria-expanded="false">${icon('alert', 26)}<span class="bb-text"><strong>Fines &amp; steps</strong><span>${per ? per.name : 'This rewards period'} \u00b7 ${d.steps.length} step${d.steps.length === 1 ? '' : 's'}</span></span><span class="bb-amt neg">${fineTotal ? '\u2212' + nf(fineTotal) : '0'}</span></button>
    </div>
    <div id="bankpanel"></div>

    ${d.jobs.length ? h`<div class="card mt16"><h2>${icon('briefcase', 20)} <span class="ml6">My class jobs</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Job</th><th>Class</th><th class="num">Paid every Friday</th></tr></thead><tbody>
      ${d.jobs.map((j) => h`<tr><td><strong>${j.title}</strong></td><td>${j.class_name}</td><td class="num pos">+${j.salary}</td></tr>`)}</tbody></table></div></div>` : ''}

    <div class="card mt16"><h2>${icon('star', 20)} <span class="ml6">Trophies &amp; badges</span></h2>
      ${trophyShelf(d)}
      <div class="badge-grid">
        ${badgeCard('school days without a step', d.badges.step_free_days, 'day', 'Counts up every school day you go without getting a step.', null)}
        ${badgeCard('school days in class', d.badges.no_leave_days, 'day', 'Counts up every school day you do not leave class for the restroom or water.', null)}
      </div>
    </div>

    <div class="grid-2 mt16">
      <div class="card"><h2>${icon('drop', 20)} <span class="ml6">Restroom &amp; water breaks</span></h2>
        <div class="break-tiles">
          <div class="mini"><div class="mini-num">${d.breaks.year.restroom}</div><div class="mini-label">Restroom this year</div></div>
          <div class="mini"><div class="mini-num">${d.breaks.year.water}</div><div class="mini-label">Water this year</div></div>
          <div class="mini"><div class="mini-num">${d.breaks.today}</div><div class="mini-label">Today</div></div>
        </div>
        ${d.breaks.period ? h`<p class="muted small mt8">${per.name}: ${d.breaks.period.restroom} restroom, ${d.breaks.period.water} water</p>` : ''}
        <button type="button" class="btn mt12" id="leave">${icon('drop', 18)} Restroom / Water</button></div>
      <div class="card"><h2>${icon('bank', 20)} <span class="ml6">Recent activity</span></h2>
        ${d.ledger.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>What</th><th class="num">Tickets</th></tr></thead><tbody>
          ${d.ledger.slice(0, 8).map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${TYPE_LABEL[x.type] || x.type}${x.category ? ` \u00b7 ${x.emoji || ''} ${x.category}` : ''}${x.note ? h`<div class="muted small">${x.note}</div>` : ''}</td>
            <td class="num ${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${x.amount}</td></tr>`)}</tbody></table></div>`
          : h`<div class="empty"><strong>No tickets yet</strong>Teachers award P5 tickets when you\u2019re prompt, prepared, positive, polite, or productive.</div>`}</div>
    </div>`);

  const panel = $('#bankpanel', el);
  const drawPanel = () => {
    $$('.bank-btn', el).forEach((b) => { const on = b.dataset.p === open; b.setAttribute('aria-expanded', String(on)); b.classList.toggle('on', on); });
    if (!open) { mount(panel, h``); return; }
    const when = per ? `${fmtDate(per.start_date)} \u2013 ${fmtDate(per.end_date)}` : '';
    if (open === 'bonus') {
      mount(panel, h`<div class="card mt12"><h2>Bonuses \u00b7 ${per ? per.name : ''}</h2><p class="muted small">${when}</p>
        ${d.bonuses.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>For</th><th>Note</th><th class="num">Tickets</th></tr></thead><tbody>
          ${d.bonuses.map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${x.category ? `${x.emoji || ''} ${x.category}` : ''}</td><td>${x.note || ''}</td><td class="num pos">+${x.amount}</td></tr>`)}
          <tr class="totals"><td colspan="3">Total</td><td class="num">+${bonusTotal}</td></tr></tbody></table></div>`
          : h`<div class="empty"><strong>No bonuses yet this period</strong>Keep being prompt, prepared, positive, polite, and productive.</div>`}</div>`);
    } else {
      mount(panel, h`<div class="card mt12"><h2>Fines &amp; steps \u00b7 ${per ? per.name : ''}</h2><p class="muted small">${when}</p>
        <h3>Fines</h3>
        ${d.fines.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>For</th><th>Note</th><th class="num">Tickets</th></tr></thead><tbody>
          ${d.fines.map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${x.category ? `${x.emoji || ''} ${x.category}` : ''}</td><td>${x.note || ''}</td><td class="num neg">${x.amount}</td></tr>`)}</tbody></table></div>`
          : h`<p class="muted">No fines this period.</p>`}
        <h3 class="mt16">Steps</h3>
        ${d.steps.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Step</th><th>Teacher</th></tr></thead><tbody>
          ${d.steps.map((x) => h`<tr><td class="nowrap">${fmtMD(x.step_date)}</td><td><span class="chip step">Step ${x.step_level}</span></td><td>${x.teacher || ''}</td></tr>`)}</tbody></table></div>`
          : h`<p class="muted">No steps this period. Nice work!</p>`}</div>`);
    }
  };
  $$('.bank-btn', el).forEach((b) => b.addEventListener('click', () => { open = open === b.dataset.p ? null : b.dataset.p; drawPanel(); if (open) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
  $('#leave', el).addEventListener('click', () => openBreakModal());
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
      return h`<div class="shop-card"><div class="em">${i.emoji || '\ud83c\udf81'}</div><strong>${i.name}</strong>${i.offered_by ? h`<span class="chip gray">From ${i.offered_by}</span>` : ''}<div class="muted small grow">${i.description || ''}</div>
        <div class="price">${i.price} P5</div>
        ${i.stock !== null && !i.sold_out ? h`<div class="muted small">${i.stock} left</div>` : ''}
        <button class="btn ${blocked ? '' : 'primary'}" data-buy="${i.id}" ${blocked ? raw('disabled') : ''}>${blocked ? why : 'Buy'}</button></div>`;
    })}</div>` : h`<div class="card"><div class="empty"><strong>No rewards are available yet</strong>Your teachers choose which rewards each class offers. Check back soon or ask your teacher.</div></div>`}
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
