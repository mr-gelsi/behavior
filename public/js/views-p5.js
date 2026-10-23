import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDate, fmtMD, fmtDT, studentPicker, hashQuery,
  loadCategories, catChip,
} from './core.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);
const PERIODS = ['', '1', '2', '3', '4', '5', '6', '7'];

// ======================================================================================
// P5 Points: award or fine
// ======================================================================================
export async function p5(el) {
  loading(el);
  const [cats, hr] = await Promise.all([loadCategories(), api('/homerooms')]);
  const me = state.me;
  const maxAmt = me.user.role === 'admin' ? 1000 : me.settings.teacher_max_p5;
  const form = state.p5form || (state.p5form = { mode: 'award', cat: null, amount: 5 });
  let stepLevel = null;
  const q = hashQuery();

  mount(el, h`
    <div class="page-head"><div><h1>\u2b50 P5 points</h1><p class="muted">Prompt, Prepared, Positive, Polite, Productive</p></div></div>
    <div class="card">
      <div class="field"><div class="seg" id="mode" role="group" aria-label="Award or fine">
        <button type="button" data-mode="award">\ud83c\udf89 Award points</button><button type="button" data-mode="fine">\ud83d\udeab Fine points</button></div></div>

      <div class="field"><label>Students</label><div id="picker"></div>
        ${hr.homerooms.length ? h`<div class="row mt8"><select class="maxw340" id="hr" aria-label="Add a whole class"><option value="">Add a whole homeroom\u2026</option>
          ${hr.homerooms.map((x) => h`<option value="${x.grade}|${x.homeroom_teacher}">Grade ${x.grade} \u2022 ${x.homeroom_teacher} (${x.n})</option>`)}</select>
          <button type="button" class="btn small" id="addhr">Add class</button></div>` : ''}
      </div>

      <div class="field"><label>What is it for?</label>
        <div class="cat-btns" id="cats" role="group" aria-label="P5 category">${cats.map((c) => h`<button type="button" class="cat-btn cat-${c.id}" data-cat="${c.id}" aria-pressed="false"><span class="em">${c.emoji}</span>${c.name}</button>`)}</div></div>

      <div class="field"><label for="amt">Amount</label>
        <div class="amt-btns" id="amts">${[1, 2, 5, 10].filter((n) => n <= maxAmt).map((n) => h`<button type="button" class="btn" data-amt="${n}" aria-pressed="false">${n}</button>`)}
          <input type="number" id="amt" min="1" max="${maxAmt}" step="1" inputmode="numeric" aria-label="Custom amount" placeholder="Other"></div>
        <div class="help">${me.user.role === 'admin' ? 'Admins can give up to 1,000 points at a time.' : `You can give up to ${maxAmt} points per entry.`}</div></div>

      <div class="form-grid">
        <div><label for="note">Note (optional)</label><input type="text" id="note" maxlength="200" placeholder="Why?"></div>
        <div><label for="pd">Date</label><input type="date" id="pd" value="${me.today}"></div>
      </div>

      <div id="fineStep" class="card hidden card-alt">
        <label class="check"><input type="checkbox" id="addStep"> Also add a step to this student\u2019s record</label>
        <div id="stepFields" class="hidden mt12">
          <div class="field"><label>Step level</label><div class="step-btns" id="stepbtns">${[1, 2, 3, 4, 5].map((n) => h`<button type="button" class="step-btn s${n}" data-step="${n}" aria-pressed="false">Step ${n}</button>`)}</div></div>
          <div class="form-grid"><div><label for="sp">Period (optional)</label><select id="sp">${PERIODS.map((p) => h`<option value="${p}">${p || 'None'}</option>`)}</select></div></div>
          <div class="help">The step uses the same reason and note as the fine, and the same date. If more than one student is selected, each gets a step.</div>
        </div>
      </div>

      <div class="row"><button class="btn primary" id="save">Save</button><span class="error-text" id="err" role="alert"></span></div>
    </div>

    <div class="card"><h2>Recent P5 activity</h2><div id="recent"></div></div>

    <details class="card no-print"><summary class="summary-bold">P5 totals report</summary>
      <div class="form-grid mt14"><div><label for="rf">From</label><input type="date" id="rf" value="${me.today.slice(0, 7)}-01"></div><div><label for="rt">To</label><input type="date" id="rt" value="${me.today}"></div></div>
      <button class="btn" id="rrun">Show totals</button><div class="mt14" id="rout"></div></details>`);

  const err = $('#err', el);
  const picker = studentPicker($('#picker', el), { multi: true, onChange: syncFineStep });
  function paintMode() {
    $$('#mode button', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === form.mode)));
    $('#mode', el).className = 'seg ' + form.mode;
    $('#save', el).textContent = form.mode === 'award' ? 'Award points' : 'Fine points';
    $('#save', el).className = 'btn ' + (form.mode === 'award' ? 'primary' : 'primary');
    $('#fineStep', el).classList.toggle('hidden', form.mode !== 'fine');
  }
  function syncFineStep() { /* label wording only */ }
  function paintCat() { $$('#cats button', el).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.cat) === form.cat))); }
  function paintAmt() {
    $$('#amts [data-amt]', el).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.amt) === form.amount)));
    const known = [1, 2, 5, 10].includes(form.amount);
    $('#amt', el).value = known ? '' : (form.amount || '');
  }
  paintMode(); paintCat(); paintAmt();

  $$('#mode button', el).forEach((b) => b.addEventListener('click', () => { form.mode = b.dataset.mode; paintMode(); }));
  $$('#cats button', el).forEach((b) => b.addEventListener('click', () => { form.cat = Number(b.dataset.cat); paintCat(); }));
  $$('#amts [data-amt]', el).forEach((b) => b.addEventListener('click', () => { form.amount = Number(b.dataset.amt); paintAmt(); }));
  $('#amt', el).addEventListener('input', (e) => { form.amount = e.target.value ? Number(e.target.value) : null; $$('#amts [data-amt]', el).forEach((b) => b.setAttribute('aria-pressed', 'false')); });
  $('#addStep', el).addEventListener('change', (e) => $('#stepFields', el).classList.toggle('hidden', !e.target.checked));
  $$('#stepbtns button', el).forEach((b) => b.addEventListener('click', () => {
    stepLevel = Number(b.dataset.step);
    $$('#stepbtns button', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const addhr = $('#addhr', el);
  if (addhr) addhr.addEventListener('click', async () => {
    const v = $('#hr', el).value;
    if (!v) return;
    const [grade, hrName] = v.split('|');
    try {
      const { students } = await api(`/homerooms/students?grade=${grade}&homeroom=${encodeURIComponent(hrName)}`);
      picker.addMany(students);
      toast(`Added ${students.length} students.`);
    } catch (e) { fail(e); }
  });
  if (q.student) { try { const d = await api('/students/' + Number(q.student)); picker.add(d.student); } catch { /* ignore */ } }

  $('#save', el).addEventListener('click', async () => {
    err.textContent = '';
    const students = picker.get();
    if (!students.length) { err.textContent = 'Choose at least one student.'; return; }
    if (!form.cat) { err.textContent = 'Choose what the points are for.'; return; }
    if (!form.amount || form.amount < 1) { err.textContent = 'Enter an amount.'; return; }
    const addStep = form.mode === 'fine' && $('#addStep', el).checked;
    if (addStep && !stepLevel) { err.textContent = 'Choose a step level, or untick \u201cAlso add a step\u201d.'; return; }
    const cat = cats.find((c) => c.id === form.cat);
    if (form.mode === 'fine' || students.length > 10) {
      const verb = form.mode === 'award' ? 'Award' : 'Fine';
      const msg = `${verb} ${form.amount} ${cat.name} point${form.amount === 1 ? '' : 's'} ${form.mode === 'award' ? 'to' : 'from'} ${students.length === 1 ? students[0].first_name + ' ' + students[0].last_name : students.length + ' students'}${addStep ? `, and add a Step ${stepLevel} to ${students.length === 1 ? 'their' : 'each'} record` : ''}?`;
      if (!(await confirmBox(msg, { ok: verb, danger: form.mode === 'fine' }))) return;
    }
    const btn = $('#save', el);
    btn.disabled = true;
    try {
      const r = await api('/p5', { method: 'POST', body: {
        mode: form.mode, student_ids: students.map((s) => s.student_id), category_id: form.cat, amount: form.amount,
        note: $('#note', el).value || null, date: $('#pd', el).value,
        step: addStep ? { add: true, level: stepLevel, period: $('#sp', el).value || null } : undefined,
      } });
      const one = r.results.length === 1 ? ` New balance: ${r.results[0].balance}.` : '';
      toast(`${form.mode === 'award' ? 'Awarded' : 'Fined'} ${form.amount} ${cat.name} point${form.amount === 1 ? '' : 's'}${addStep ? ' and added a step' : ''}.${one}`);
      picker.clear(); $('#note', el).value = '';
      $('#addStep', el).checked = false; $('#stepFields', el).classList.add('hidden'); stepLevel = null;
      $$('#stepbtns button', el).forEach((x) => x.setAttribute('aria-pressed', 'false'));
      loadRecent();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  });

  async function loadRecent() {
    try {
      const { transactions } = await api('/p5/recent');
      mount($('#recent', el), transactions.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Student</th><th>Gr</th><th>Type</th><th>For</th><th class="num">Points</th><th>Note</th><th>Teacher</th><th class="no-print"></th></tr></thead><tbody>
        ${transactions.map((t) => h`<tr><td class="nowrap">${fmtMD(t.tx_date)}</td><td>${t.last_name}, ${t.first_name}</td><td>${t.grade}</td>
          <td><span class="chip ${t.type === 'award' ? 'award' : t.type === 'fine' ? 'fine' : 'gray'}">${t.type === 'adjustment' ? 'reversal' : t.type}</span>${t.linked_step_id ? h` <span class="chip step">+ step</span>` : ''}</td>
          <td>${t.category ? catChip(cats.find((c) => c.name === t.category)?.id || 0, t.category, t.emoji) : ''}</td>
          <td class="num ${t.amount > 0 ? 'pos' : 'neg'}">${t.amount > 0 ? '+' : ''}${t.amount}</td><td>${t.note || ''}</td><td>${t.teacher || ''}</td>
          <td class="no-print">${['award', 'fine'].includes(t.type) && !t.reversed_by && (me.user.role === 'admin' || (t.created_by === me.user.email && Date.now() - Date.parse(t.created_at) < 7 * 864e5)) ? h`<button class="btn small" data-rev="${t.id}">Reverse</button>` : t.reversed_by ? h`<span class="muted small">reversed</span>` : ''}</td></tr>`)}
        </tbody></table></div>` : h`<div class="empty"><strong>No P5 activity yet</strong>Awards and fines will show up here.</div>`);
      $$('[data-rev]', el).forEach((b) => b.addEventListener('click', () => reverse(transactions.find((t) => String(t.id) === b.dataset.rev))));
    } catch (e) { fail(e); }
  }
  function reverse(t) {
    const m = modal('Reverse this entry?', h`<p>This ${t.type} of <strong>${Math.abs(t.amount)}</strong> point${Math.abs(t.amount) === 1 ? '' : 's'} for <strong>${t.first_name} ${t.last_name}</strong> will be undone. The original stays in the history, with a matching reversal.</p>
      ${t.linked_step_id ? h`<label class="check"><input type="checkbox" id="delstep" checked> Also delete the step that was added with this fine</label>` : ''}
      <div class="row end mt14"><button class="btn" data-x>Cancel</button><button class="btn primary" data-y>Reverse</button></div><div class="error-text" id="rerr"></div>`);
    $('[data-x]', m.el).addEventListener('click', m.close);
    $('[data-y]', m.el).addEventListener('click', async () => {
      try {
        await api(`/p5/${t.id}/reverse`, { method: 'POST', body: { delete_step: !!($('#delstep', m.el) && $('#delstep', m.el).checked) } });
        m.close(); toast('Entry reversed.'); loadRecent();
      } catch (e) { $('#rerr', m.el).textContent = e.message; }
    });
  }
  $('#rrun', el).addEventListener('click', async () => {
    try {
      const r = await api(`/p5/report?from=${$('#rf', el).value}&to=${$('#rt', el).value}`);
      const tbl = (title, rows) => h`<h3 class="mt12">${title}</h3><div class="table-wrap"><table><thead><tr><th>${title.replace('By ', '')}</th><th class="num">Awarded</th><th class="num">Fined</th></tr></thead><tbody>
        ${rows.map((x) => h`<tr><td>${x.label}</td><td class="num pos">${x.awarded}</td><td class="num neg">${x.fined}</td></tr>`)}</tbody></table></div>`;
      mount($('#rout', el), h`${tbl('By category', r.by_category)}${tbl('By grade', r.by_grade)}${tbl('By teacher', r.by_teacher)}`);
    } catch (e) { fail(e); }
  });
  loadRecent();
}

// ======================================================================================
// Store (staff): items, orders, pick list
// ======================================================================================
export async function storeStaff(el) {
  const tab = state.storeTab || 'orders';
  mount(el, h`
    <div class="page-head"><div><h1>\ud83d\udecd\ufe0f Store</h1><p class="muted">Items students can buy with P5 points</p></div></div>
    <div class="tabs" role="tablist">${[['orders', 'Orders'], ['items', 'Items'], ['pick', 'Pick list']].map(([k, l]) => h`<button role="tab" data-t="${k}" aria-selected="${tab === k}">${l}</button>`)}</div>
    <div id="body"><div class="spinner">Loading\u2026</div></div>`);
  $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { state.storeTab = b.dataset.t; storeStaff(el).catch(fail); }));
  const body = $('#body', el);

  if (tab === 'items') {
    const { items } = await api('/store/items');
    mount(body, h`<div class="card"><div class="row end mb10"><button class="btn primary" id="new">Add item</button></div>
      ${items.length ? h`<div class="table-wrap"><table><thead><tr><th></th><th>Item</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Limit per student</th><th>Status</th><th></th></tr></thead><tbody>
      ${items.map((i) => h`<tr><td>${i.emoji || ''}</td><td><strong>${i.name}</strong><div class="muted small">${i.description || ''}</div></td><td class="num">${i.price}</td><td class="num">${i.stock === null ? 'Unlimited' : i.stock}</td><td class="num">${i.max_per_student ?? '\u2014'}</td>
        <td><span class="chip ${i.active ? 'ok' : 'gray'}">${i.active ? 'For sale' : 'Hidden'}</span></td><td><button class="btn small" data-edit="${i.id}">Edit</button></td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>No items yet</strong>Add something students can buy.</div>`}</div>`);
    const edit = (i) => {
      i = i || { name: '', description: '', price: 10, stock: null, max_per_student: null, emoji: '', active: 1 };
      const m = modal(i.id ? 'Edit item' : 'Add item', h`
        <div class="form-grid">
          <div><label for="i_n">Name</label><input type="text" id="i_n" value="${i.name}" maxlength="60"></div>
          <div><label for="i_e">Emoji</label><input type="text" id="i_e" value="${i.emoji || ''}" maxlength="8"></div>
          <div><label for="i_p">Price (P5 points)</label><input type="number" id="i_p" min="1" value="${i.price}"></div>
          <div><label for="i_s">Stock (blank = unlimited)</label><input type="number" id="i_s" min="0" value="${i.stock ?? ''}"></div>
          <div><label for="i_m">Limit per student (blank = none)</label><input type="number" id="i_m" min="1" value="${i.max_per_student ?? ''}"></div>
        </div>
        <div class="field"><label for="i_d">Description</label><input type="text" id="i_d" value="${i.description || ''}" maxlength="200"></div>
        <label class="check"><input type="checkbox" id="i_a" ${i.active ? raw('checked') : ''}> For sale (students can see and buy it)</label>
        <div class="row end mt14"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save item</button></div><div class="error-text" id="i_err"></div>`);
      $('[data-x]', m.el).addEventListener('click', m.close);
      $('[data-s]', m.el).addEventListener('click', async () => {
        const v = (s) => $(s, m.el).value;
        const body = { name: v('#i_n'), emoji: v('#i_e') || null, price: Number(v('#i_p')), stock: v('#i_s') === '' ? null : Number(v('#i_s')), max_per_student: v('#i_m') === '' ? null : Number(v('#i_m')), description: v('#i_d') || null, active: $('#i_a', m.el).checked };
        try { await api(i.id ? '/store/items/' + i.id : '/store/items', { method: i.id ? 'PATCH' : 'POST', body }); m.close(); toast('Item saved.'); storeStaff(el).catch(fail); }
        catch (e) { $('#i_err', m.el).textContent = e.message; }
      });
    };
    $('#new', el).addEventListener('click', () => edit(null));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => edit(items.find((x) => String(x.id) === b.dataset.edit))));
    return;
  }

  if (tab === 'pick') {
    const { rows } = await api('/store/picklist');
    const groups = {};
    rows.forEach((r) => (groups[r.homeroom] = groups[r.homeroom] || []).push(r));
    mount(body, h`<div class="row end no-print mb10"><button class="btn" id="print">Print pick list</button></div>
      ${rows.length ? Object.entries(groups).map(([hrm, list]) => h`<div class="card"><h2>${hrm} \u2022 ${list.length} order${list.length === 1 ? '' : 's'}</h2>
        <table><thead><tr><th>Student</th><th>Gr</th><th>Item</th><th>Order</th></tr></thead><tbody>
        ${list.map((r) => h`<tr><td>${r.last_name}, ${r.first_name}</td><td>${r.grade}</td><td>${r.emoji || ''} ${r.item}</td><td>#${r.order_id}</td></tr>`)}</tbody></table></div>`)
        : h`<div class="card"><div class="empty"><strong>Nothing to pick</strong>No orders are waiting.</div></div>`}`);
    $('#print', el).addEventListener('click', () => window.print());
    return;
  }

  const status = state.orderStatus || 'pending';
  const { orders } = await api('/store/orders?status=' + status);
  mount(body, h`<div class="card"><div class="row mb12"><label for="os" class="hidden">Status</label>
    <select class="maxw220" id="os">${['pending', 'fulfilled', 'cancelled', 'all'].map((s) => h`<option value="${s}" ${s === status ? raw('selected') : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`)}</select></div>
    ${orders.length ? h`<div class="table-wrap"><table><thead><tr><th>Ordered</th><th>Student</th><th>Gr</th><th>Homeroom</th><th>Item</th><th class="num">Paid</th><th>Status</th><th></th></tr></thead><tbody>
      ${orders.map((o) => h`<tr><td class="nowrap">${fmtDT(o.created_at)}</td><td>${o.last_name}, ${o.first_name}</td><td>${o.grade}</td><td>${o.homeroom_teacher || ''}</td><td>${o.emoji || ''} ${o.item}</td><td class="num">${o.price_paid}</td>
        <td><span class="chip ${o.status === 'fulfilled' ? 'ok' : o.status === 'cancelled' ? 'gray' : 'step'}">${o.status}</span></td>
        <td class="nowrap">${o.status === 'pending' ? h`<button class="btn small primary" data-ful="${o.id}">Mark fulfilled</button> <button class="btn small danger" data-can="${o.id}">Cancel</button>` : ''}</td></tr>`)}</tbody></table></div>`
      : h`<div class="empty"><strong>No ${status === 'all' ? '' : status} orders</strong>Orders from students will show up here.</div>`}</div>`);
  $('#os', el).addEventListener('change', (e) => { state.orderStatus = e.target.value; storeStaff(el).catch(fail); });
  $$('[data-ful]', el).forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/store/orders/${b.dataset.ful}/fulfill`, { method: 'POST' }); toast('Order marked fulfilled.'); storeStaff(el).catch(fail); } catch (e) { fail(e); }
  }));
  $$('[data-can]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Cancel this order and refund the student\u2019s points?', { ok: 'Cancel order', danger: true }))) return;
    try { await api(`/store/orders/${b.dataset.can}/cancel`, { method: 'POST' }); toast('Order cancelled and points refunded.'); storeStaff(el).catch(fail); } catch (e) { fail(e); }
  }));
}
