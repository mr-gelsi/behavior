import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, studentPicker, loadCategories, fmtDate,
} from './core.js';
import { itemForm } from './views-p5.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Code copied.'); }
  catch { toast('Couldn\u2019t copy automatically. Select the code and copy it by hand.', 'err'); }
}
const shortName = (m) => `${m.first_name} ${m.last_name.charAt(0)}.`;

// ======================================================================================
// Staff: list of classes
// ======================================================================================
export async function classesList(el) {
  loading(el);
  const arch = !!state.showArchivedClasses;
  const { classes } = await api('/classes?archived=' + (arch ? 1 : 0));
  const admin = state.me.user.role === 'admin';
  mount(el, h`
    <div class="page-head"><div><h1>\ud83c\udfeb My classes</h1><p class="muted">Each class has a code students type in to join. Open a class for its seating chart.</p></div>
      <div class="actions"><label class="check"><input type="checkbox" id="arch" ${arch ? raw('checked') : ''}> Show archived</label><button class="btn primary" id="new">New class</button></div></div>
    ${classes.length ? h`<div class="class-grid">${classes.map((c) => h`<div class="class-card ${c.archived ? 'archived' : ''}">
      <div><strong class="fs18">${c.name}</strong><div class="muted small">${[c.period ? 'Period ' + c.period : '', c.school_year, admin ? c.owner_name : ''].filter(Boolean).join(' \u2022 ')}</div></div>
      <div class="row"><span class="chip gray">${c.members} student${c.members === 1 ? '' : 's'}</span><span class="chip ${c.join_open && !c.archived ? 'ok' : 'gray'}">${c.archived ? 'Archived' : c.join_open ? 'Joining open' : 'Joining closed'}</span></div>
      <div class="code-box"><span class="code">${c.code}</span><button class="btn small" data-copy="${c.code}">Copy</button></div>
      <div class="row"><a class="btn primary" href="#/class/${c.id}">Open</a></div></div>`)}</div>`
      : h`<div class="card"><div class="empty"><strong>${arch ? 'No classes yet' : 'No active classes yet'}</strong>Create a class, give students its code, then set up your seating chart.</div></div>`}`);
  $('#arch', el).addEventListener('change', (e) => { state.showArchivedClasses = e.target.checked; classesList(el).catch(fail); });
  $$('[data-copy]', el).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
  $('#new', el).addEventListener('click', () => {
    const m = modal('New class', h`<div class="form-grid">
      <div><label for="c_n">Class name</label><input type="text" id="c_n" maxlength="60" placeholder="US History"></div>
      <div><label for="c_p">Period (optional)</label><input type="text" id="c_p" maxlength="20" placeholder="3"></div></div>
      <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Create class</button></div><div class="error-text" id="c_err"></div>`);
    $('[data-x]', m.el).addEventListener('click', m.close);
    $('[data-s]', m.el).addEventListener('click', async () => {
      try {
        const r = await api('/classes', { method: 'POST', body: { name: $('#c_n', m.el).value, period: $('#c_p', m.el).value || null } });
        m.close(); toast('Class created. Share the code with your students.'); location.hash = '#/class/' + r.id;
      } catch (e) { $('#c_err', m.el).textContent = e.message; }
    });
    $('#c_n', m.el).focus();
  });
}

// ======================================================================================
// Staff: one class (seating, students, settings)
// ======================================================================================
export async function classDetail(el, id) {
  loading(el);
  const d = await api('/classes/' + id);
  const c = d.class;
  const tab = state.classTab || 'seating';
  const reload = () => classDetail(el, id).catch(fail);
  mount(el, h`
    <div class="page-head"><div><h1>${c.name}</h1>
      <p class="muted">${[c.period ? 'Period ' + c.period : '', c.school_year, `${d.members.length} student${d.members.length === 1 ? '' : 's'}`, c.archived ? 'Archived' : ''].filter(Boolean).join(' \u2022 ')}</p></div>
      <div class="actions no-print"><a class="btn" href="#/classes">\u2190 All classes</a></div></div>
    <div class="card no-print"><div class="row">
      <div class="code-box big"><span class="code">${c.code}</span><button class="btn small" id="copy">Copy</button></div>
      <div class="muted grow-220">Students sign in, open <strong>My Classes</strong>, and type this code. <span class="chip ${c.join_open && !c.archived ? 'ok' : 'gray'}">${c.join_open && !c.archived ? 'Joining open' : 'Joining closed'}</span></div></div></div>
    <div class="tabs no-print" role="tablist">${[['seating', 'Seating chart'], ['students', 'Students'], ['rewards', 'Rewards'], ['settings', 'Settings']].map(([k, l]) => h`<button role="tab" data-t="${k}" aria-selected="${tab === k}">${l}</button>`)}</div>
    <div id="tab"></div>`);
  $('#copy', el).addEventListener('click', () => copyText(c.code));
  $$('.tabs button', el).forEach((b) => b.addEventListener('click', async () => {
    if (state.leaveGuard && state.leaveGuard() && !(await confirmBox(state.leaveGuard(), { ok: 'Leave without saving', danger: true }))) return;
    state.classTab = b.dataset.t; state.leaveGuard = null; reload();
  }));
  const box = $('#tab', el);
  if (tab === 'seating') await seating(box, d, reload);
  else if (tab === 'students') await studentsTab(box, d, reload);
  else if (tab === 'rewards') await rewardsTab(box, d, reload);
  else settingsTab(box, d, reload);
}

// --------------------------------------------------------------------------------------
// Seating chart
// --------------------------------------------------------------------------------------
async function seating(box, d, reload) {
  const me = state.me;
  const classId = d.class.id;
  const members = new Map(d.members.map((m) => [m.student_id, m]));
  let nextKey = 1;
  const mk = (x) => ({ key: 'k' + nextKey++, x: x.x, y: x.y, kind: x.kind, student_id: x.student_id ?? null });
  const L = { cols: d.class.grid_cols, rows: d.class.grid_rows, desks: d.desks.map(mk) };
  const snap = () => JSON.stringify({ c: L.cols, r: L.rows, d: L.desks.map((k) => [k.x, k.y, k.kind, k.student_id]).sort() });
  const saved = snap();
  const isDirty = () => snap() !== saved;
  let edit = !!state.seatEdit;
  let pick = null;
  let others = null;

  const seatedIds = () => new Set(L.desks.filter((k) => k.student_id).map((k) => k.student_id));
  const unseated = () => d.members.filter((m) => !seatedIds().has(m.student_id));
  const deskAt = (x, y) => L.desks.find((k) => k.x === x && k.y === y);
  const byKey = (key) => L.desks.find((k) => k.key === key);
  const firstFree = () => { for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (!deskAt(x, y)) return { x, y }; return null; };
  state.leaveGuard = () => (isDirty() ? 'You have seating changes that aren\u2019t saved. Leave without saving them?' : null);

  async function loadOthers() {
    try { others = (await api('/classes?archived=1')).classes.filter((c) => c.id !== classId); } catch { others = []; }
  }
  if (edit) await loadOthers();

  const deskHtml = (k) => {
    const sel = edit && pick && k.kind === 'desk' ? ' sel-target' : '';
    const tools = (k.student_id ? h`<button type="button" data-unseat="${k.key}" aria-label="Unseat student" title="Unseat">\u2715</button>` : '');
    if (k.kind === 'teacher') {
      return h`<div class="desk teacher" data-key="${k.key}" data-gx="${k.x}" data-gy="${k.y}" ${edit ? raw('tabindex="0"') : ''} aria-label="Teacher desk">
        <div class="dname">\ud83c\udf4e Teacher</div>${edit ? h`<div class="dtools"><button type="button" data-del="${k.key}" aria-label="Remove desk" title="Remove desk">\ud83d\uddd1</button></div>` : ''}</div>`;
    }
    const m = k.student_id ? members.get(k.student_id) : null;
    if (edit) {
      return h`<div class="desk ${m ? '' : 'empty'}${sel}" data-key="${k.key}" data-gx="${k.x}" data-gy="${k.y}" tabindex="0" aria-label="${m ? m.first_name + ' ' + m.last_name : 'Empty desk'}, column ${k.x + 1}, row ${k.y + 1}">
        <div class="dname" title="${m ? m.first_name + ' ' + m.last_name : ''}">${m ? shortName(m) : 'Empty'}</div>
        <div class="dtools">${tools}<button type="button" data-del="${k.key}" aria-label="Remove desk" title="Remove desk">\ud83d\uddd1</button></div></div>`;
    }
    if (!m) return h`<div class="desk empty" data-key="${k.key}" data-gx="${k.x}" data-gy="${k.y}" aria-label="Empty desk"><div class="dname">Empty</div></div>`;
    return h`<div class="desk" data-key="${k.key}" data-gx="${k.x}" data-gy="${k.y}">
      <div class="dname" title="${m.first_name} ${m.last_name}">${shortName(m)}</div>
      <div class="dbal">\u2b50 ${m.balance}</div>
      <div class="dbtns"><button type="button" class="dbtn plus" data-act="award" data-sid="${m.student_id}" aria-label="Award points to ${m.first_name} ${m.last_name}">+</button>
        <button type="button" class="dbtn minus" data-act="fine" data-sid="${m.student_id}" aria-label="Fine points from ${m.first_name} ${m.last_name}">\u2212</button></div></div>`;
  };

  function paint() {
    const keepL = $('.seat-scroll', box) ? $('.seat-scroll', box).scrollLeft : 0;
    const keepT = $('.seat-scroll', box) ? $('.seat-scroll', box).scrollTop : 0;
    const cells = [];
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
      cells.push(h`<button type="button" class="cell" tabindex="-1" data-x="${x}" data-y="${y}" data-gx="${x}" data-gy="${y}" ${edit ? '' : raw('disabled')} aria-label="Empty spot, column ${x + 1}, row ${y + 1}"></button>`);
    }
    const free = unseated();
    const dirty = isDirty();
    mount(box, h`
      <div class="seat-bar no-print">
        <div class="seg" role="group" aria-label="Seating mode"><button type="button" data-mode="use" aria-pressed="${!edit}">\u2b50 Award &amp; fine</button><button type="button" data-mode="edit" aria-pressed="${edit}">\u270f\ufe0f Edit layout</button></div>
        <div class="row">${dirty ? h`<span class="chip dirty-chip">Unsaved changes</span>` : ''}
          ${dirty ? h`<button type="button" class="btn" id="discard">Discard</button><button type="button" class="btn primary" id="save">Save layout</button>` : ''}
          ${!edit ? h`<button type="button" class="btn plus-btn" id="clsAward" ${d.members.length ? '' : raw('disabled')}>\u2b50 Award whole class</button><button type="button" class="btn danger" id="clsFine" ${d.members.length ? '' : raw('disabled')}>Fine whole class</button>` : ''}
          ${!edit && !dirty ? h`<button type="button" class="btn" id="print">Print seating chart</button>` : ''}</div>
      </div>
      ${edit ? h`<div class="help no-print mb10">Drag a desk to move it (or focus it and use the arrow keys). Click an empty spot to add a desk. Pick a student on the right, then click a desk to seat them. Remember to save.</div>`
        : (!L.desks.length ? h`<div class="banner info no-print">No desks yet. Switch to <strong>Edit layout</strong> to build your seating chart.</div>` : '')}
      <div class="seat-layout ${edit ? 'editing' : ''}">
        <div class="seat-scroll"><div class="seat-grid ${edit ? 'editing' : ''}" id="grid" data-cols="${L.cols}" data-rows="${L.rows}" role="group" aria-label="Seating chart">${cells}${L.desks.map(deskHtml)}</div></div>
        ${edit ? h`<aside class="seat-side no-print">
          <div class="card"><h3>Room</h3><div class="row"><button type="button" class="btn small" id="addDesk">Add desk</button><button type="button" class="btn small" id="addTeacher">Add teacher desk</button></div>
            <div class="form-grid mt12"><div><label for="g_c">Columns</label><input type="number" id="g_c" min="2" max="16" value="${L.cols}"></div><div><label for="g_r">Rows</label><input type="number" id="g_r" min="2" max="12" value="${L.rows}"></div></div></div>
          <div class="card"><h3>Students without a desk (${free.length})</h3>
            ${free.length ? h`<div class="stu-list">${free.map((m) => h`<button type="button" class="stu-chip" data-stu="${m.student_id}" aria-pressed="${pick === m.student_id}">${m.last_name}, ${m.first_name}</button>`)}</div>`
              : h`<p class="muted small">${d.members.length ? 'Everyone has a desk.' : 'No students yet. Add them on the Students tab, or share the class code.'}</p>`}
            <div class="row mt8"><button type="button" class="btn small" id="autoSeat" ${free.length ? '' : raw('disabled')}>Seat A\u2013Z</button><button type="button" class="btn small danger" id="clearSeats">Clear all seats</button></div></div>
          <div class="card"><h3>Copy a layout</h3>
            ${others && others.length ? h`<label for="cp_f" class="hidden">Copy from</label><select id="cp_f">${others.map((o) => h`<option value="${o.id}">${o.name}${o.period ? ' (P' + o.period + ')' : ''} \u2022 ${o.school_year}</option>`)}</select>
              <label class="check mt8"><input type="checkbox" id="cp_s"> Also seat students who are in both classes</label>
              <button type="button" class="btn small mt8" id="cp_go">Copy layout here</button>` : h`<p class="muted small">You don\u2019t have another class to copy from yet.</p>`}</div>
        </aside>` : ''}
      </div>`);
    const sc = $('.seat-scroll', box);
    if (sc) { sc.scrollLeft = keepL; sc.scrollTop = keepT; }
    window.onbeforeunload = isDirty() ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
  }

  const refocus = (key) => { const n = $(`[data-key="${key}"]`, box); if (n) n.focus(); };
  function moveDesk(key, x, y) {
    const k = byKey(key);
    if (!k || x < 0 || y < 0 || x >= L.cols || y >= L.rows) return;
    const other = deskAt(x, y);
    if (other && other.key !== key) { other.x = k.x; other.y = k.y; }
    k.x = x; k.y = y;
  }
  function seatPicked(key) {
    const k = byKey(key);
    if (!k || k.kind !== 'desk' || !pick) return;
    k.student_id = pick;
    const next = unseated()[0];
    pick = next ? next.student_id : null;
  }
  function addDeskAt(x, y, kind) {
    if (L.desks.length >= 80) { toast('A layout can have at most 80 desks.', 'err'); return null; }
    const k = mk({ x, y, kind, student_id: null });
    L.desks.push(k);
    return k;
  }

  // ---- clicks -----------------------------------------------------------------------
  box.addEventListener('click', async (e) => {
    const t = e.target;
    const btn = t.closest('button');
    if (!btn) return;
    if (btn.dataset.mode) { edit = btn.dataset.mode === 'edit'; state.seatEdit = edit; pick = null; if (edit && !others) await loadOthers(); paint(); return; }
    if (btn.dataset.act) { const m = members.get(Number(btn.dataset.sid)); if (m) deskReward(m, btn.dataset.act, paint); return; }
    if (btn.id === 'print') { window.print(); return; }
    if (btn.id === 'clsAward' || btn.id === 'clsFine') { classReward(d, btn.id === 'clsAward' ? 'award' : 'fine', paint); return; }
    if (btn.id === 'save') {
      btn.disabled = true;
      try {
        await api(`/classes/${classId}/layout`, { method: 'PUT', body: { cols: L.cols, rows: L.rows, desks: L.desks.map(({ x, y, kind, student_id }) => ({ x, y, kind, student_id })) } });
        toast('Seating layout saved.'); state.leaveGuard = null; window.onbeforeunload = null; reload();
      } catch (er) { fail(er); btn.disabled = false; }
      return;
    }
    if (btn.id === 'discard') { state.leaveGuard = null; window.onbeforeunload = null; reload(); return; }
    if (!edit) return;
    if (btn.classList.contains('cell')) { const k = addDeskAt(Number(btn.dataset.x), Number(btn.dataset.y), 'desk'); if (k) { if (pick) seatPicked(k.key); paint(); refocus(k.key); } return; }
    if (btn.dataset.unseat) { byKey(btn.dataset.unseat).student_id = null; paint(); return; }
    if (btn.dataset.del) { L.desks = L.desks.filter((k) => k.key !== btn.dataset.del); paint(); return; }
    if (btn.dataset.stu) { const id = Number(btn.dataset.stu); pick = pick === id ? null : id; paint(); return; }
    if (btn.id === 'addDesk' || btn.id === 'addTeacher') {
      const f = firstFree();
      if (!f) { toast('The room is full. Make the grid bigger first.', 'err'); return; }
      const k = addDeskAt(f.x, f.y, btn.id === 'addTeacher' ? 'teacher' : 'desk');
      if (k) { paint(); refocus(k.key); }
      return;
    }
    if (btn.id === 'autoSeat') {
      const free = unseated().sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
      const spots = L.desks.filter((k) => k.kind === 'desk' && !k.student_id).sort((a, b) => a.y - b.y || a.x - b.x);
      free.slice(0, spots.length).forEach((m, i) => { spots[i].student_id = m.student_id; });
      if (free.length > spots.length) toast(`${free.length - spots.length} student${free.length - spots.length === 1 ? '' : 's'} still need a desk. Add more desks.`, 'err');
      pick = null; paint(); return;
    }
    if (btn.id === 'clearSeats') {
      if (!(await confirmBox('Take every student off their desk? Desks stay where they are.', { ok: 'Clear seats', danger: true }))) return;
      L.desks.forEach((k) => { k.student_id = null; }); pick = null; paint(); return;
    }
    if (btn.id === 'cp_go') {
      const from = Number($('#cp_f', box).value);
      const src = others.find((o) => o.id === from);
      if (!(await confirmBox(`Replace this class\u2019s layout with the one from \u201c${src.name}\u201d? Any unsaved changes here are lost.`, { ok: 'Copy layout' }))) return;
      try {
        const r = await api(`/classes/${classId}/copy-layout`, { method: 'POST', body: { from_class_id: from, with_students: $('#cp_s', box).checked } });
        toast(`Copied ${r.desks} desks${$('#cp_s', box).checked ? `, seated ${r.seated}${r.skipped ? ` (${r.skipped} not in this class)` : ''}` : ''}.`);
        state.leaveGuard = null; window.onbeforeunload = null; reload();
      } catch (er) { fail(er); }
    }
  });

  box.addEventListener('change', (e) => {
    if (e.target.id !== 'g_c' && e.target.id !== 'g_r') return;
    const isCols = e.target.id === 'g_c';
    const min = Math.max(2, 1 + Math.max(-1, ...L.desks.map((k) => (isCols ? k.x : k.y))));
    const max = isCols ? 16 : 12;
    const v = Math.round(Number(e.target.value));
    if (!Number.isFinite(v) || v < min || v > max) {
      toast(v < min ? `Move or remove the desks in the last ${isCols ? 'columns' : 'rows'} first. The smallest size right now is ${min}.` : `The largest size is ${max}.`, 'err');
    } else if (isCols) L.cols = v; else L.rows = v;
    paint();
  });

  // ---- drag and drop (mouse, pen, and touch) -----------------------------------------
  let drag = null;
  const cellAt = (x, y) => document.elementsFromPoint(x, y).find((n) => n.classList && n.classList.contains('cell'));
  const clearTargets = () => $$('.cell.drop-target', box).forEach((n) => n.classList.remove('drop-target'));
  box.addEventListener('pointerdown', (e) => {
    if (!edit || e.button > 0) return;
    const desk = e.target.closest('.desk');
    if (!desk || e.target.closest('button')) return;
    drag = { key: desk.dataset.key, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, el: desk };
    try { desk.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
    clearTargets();
    const c = cellAt(e.clientX, e.clientY);
    if (c) c.classList.add('drop-target');
  });
  const endDrag = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dg = drag; drag = null;
    clearTargets();
    dg.el.style.transform = '';
    dg.el.classList.remove('dragging');
    if (cancelled) return;
    if (dg.moved) {
      const c = cellAt(e.clientX, e.clientY);
      if (c) { moveDesk(dg.key, Number(c.dataset.x), Number(c.dataset.y)); paint(); refocus(dg.key); }
    } else if (pick) { seatPicked(dg.key); paint(); }
  };
  box.addEventListener('pointerup', (e) => endDrag(e, false));
  box.addEventListener('pointercancel', (e) => endDrag(e, true));

  // ---- keyboard: arrows move the focused desk ---------------------------------------------
  box.addEventListener('keydown', (e) => {
    const desk = e.target.closest && e.target.closest('.desk');
    if (!edit || !desk || e.target !== desk) return;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) {
      e.preventDefault();
      const k = byKey(desk.dataset.key);
      moveDesk(k.key, k.x + dir[0], k.y + dir[1]);
      paint(); refocus(k.key);
    } else if ((e.key === 'Enter' || e.key === ' ') && pick) { e.preventDefault(); seatPicked(desk.dataset.key); paint(); }
  });

  paint();
}

// --------------------------------------------------------------------------------------
// Award or fine from a desk
// --------------------------------------------------------------------------------------
async function deskReward(m, mode, done) {
  let cats;
  try { cats = await loadCategories(); } catch (e) { fail(e); return; }
  const me = state.me;
  const maxAmt = me.user.role === 'admin' ? 1000 : me.settings.teacher_max_p5;
  const amounts = [1, 2, 3, 5, 10].filter((n) => n <= maxAmt);
  let amount = amounts.includes(state.deskAmount) ? state.deskAmount : amounts[0];
  let cat = null, level = null;
  const award = mode === 'award';
  const dlg = modal(`${award ? 'Award' : 'Fine'}: ${m.first_name} ${m.last_name}`, h`
    <p class="muted">Balance: <strong>${m.balance}</strong> P5</p>
    <div class="field"><label>Amount</label><div class="amt-btns" id="amts">${amounts.map((n) => h`<button type="button" class="btn" data-amt="${n}" aria-pressed="${n === amount}">${n}</button>`)}</div></div>
    <div class="field"><label>${award ? 'Tap what it\u2019s for to give the points' : 'What is it for?'}</label>
      <div class="cat-btns" id="cats">${cats.map((c) => h`<button type="button" class="cat-btn cat-${c.id}" data-cat="${c.id}" aria-pressed="false"><span class="em">${c.emoji}</span>${c.name}</button>`)}</div></div>
    <div class="field"><label for="dn">Note (optional)</label><input type="text" id="dn" maxlength="200"></div>
    ${award ? '' : h`<div class="card card-alt"><label class="check"><input type="checkbox" id="dstep"> Also add a step to this student\u2019s record</label>
      <div id="dsteps" class="hidden mt12"><div class="step-btns">${[1, 2, 3, 4, 5].map((n) => h`<button type="button" class="step-btn s${n}" data-step="${n}" aria-pressed="false">Step ${n}</button>`)}</div></div></div>
      <div class="row end"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" id="dgo">Fine points</button></div>`}
    <div class="error-text" id="derr" role="alert"></div>`);
  const err = $('#derr', dlg.el);
  const submit = async () => {
    err.textContent = '';
    const addStep = !award && $('#dstep', dlg.el).checked;
    if (!cat) { err.textContent = 'Choose what it\u2019s for.'; return; }
    if (addStep && !level) { err.textContent = 'Choose a step level, or untick \u201cAlso add a step\u201d.'; return; }
    try {
      const r = await api('/p5', { method: 'POST', body: {
        mode, student_ids: [m.student_id], category_id: cat.id, amount, note: $('#dn', dlg.el).value || null, date: me.today,
        step: addStep ? { add: true, level } : undefined } });
      m.balance = r.results[0].balance;
      state.deskAmount = amount;
      dlg.close();
      toast(`${award ? 'Awarded' : 'Fined'} ${amount} ${cat.name} point${amount === 1 ? '' : 's'}${addStep ? ' and added a step' : ''}. ${m.first_name}: ${m.balance} P5.`);
      done();
    } catch (e) { err.textContent = e.message; }
  };
  $$('#amts [data-amt]', dlg.el).forEach((b) => b.addEventListener('click', () => {
    amount = Number(b.dataset.amt);
    $$('#amts [data-amt]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $$('#cats [data-cat]', dlg.el).forEach((b) => b.addEventListener('click', () => {
    cat = cats.find((c) => c.id === Number(b.dataset.cat));
    $$('#cats [data-cat]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (award) submit();
  }));
  if (!award) {
    $('#dstep', dlg.el).addEventListener('change', (e) => $('#dsteps', dlg.el).classList.toggle('hidden', !e.target.checked));
    $$('[data-step]', dlg.el).forEach((b) => b.addEventListener('click', () => {
      level = Number(b.dataset.step);
      $$('[data-step]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('[data-x]', dlg.el).addEventListener('click', dlg.close);
    $('#dgo', dlg.el).addEventListener('click', submit);
  }
}


// --------------------------------------------------------------------------------------
// Award or fine the whole class at once (untick anyone who is absent)
// --------------------------------------------------------------------------------------
async function classReward(d, mode, done) {
  let cats;
  try { cats = await loadCategories(); } catch (e) { fail(e); return; }
  const me = state.me;
  const maxAmt = me.user.role === 'admin' ? 1000 : me.settings.teacher_max_p5;
  const amounts = [1, 2, 3, 5, 10].filter((n) => n <= maxAmt);
  let amount = amounts.includes(state.classAmount) ? state.classAmount : amounts[0];
  let cat = null, level = null;
  const award = mode === 'award';
  const dlg = modal(`${award ? 'Award' : 'Fine'} the whole class: ${d.class.name}`, h`
    <div class="field"><div class="row jc-between mb8"><label>Who is here? <span id="cnt" class="chip gray"></span></label>
      <div class="row"><button type="button" class="btn small" id="all">All</button><button type="button" class="btn small" id="none">None</button></div></div>
      <div class="check-grid" id="who">${d.members.map((m) => h`<label class="check"><input type="checkbox" data-sid="${m.student_id}" ${raw('checked')}> ${m.last_name}, ${m.first_name}</label>`)}</div>
      <div class="help">Untick anyone who is absent or shouldn\u2019t get this.</div></div>
    <div class="field"><label>Amount each</label><div class="amt-btns" id="amts">${amounts.map((n) => h`<button type="button" class="btn" data-amt="${n}" aria-pressed="${n === amount}">${n}</button>`)}</div></div>
    <div class="field"><label>What is it for?</label>
      <div class="cat-btns" id="cats">${cats.map((c) => h`<button type="button" class="cat-btn cat-${c.id}" data-cat="${c.id}" aria-pressed="false"><span class="em">${c.emoji}</span>${c.name}</button>`)}</div></div>
    <div class="field"><label for="cn">Note (optional)</label><input type="text" id="cn" maxlength="200" placeholder="${award ? 'Great discussion today' : ''}"></div>
    ${award ? '' : h`<div class="card card-alt"><label class="check"><input type="checkbox" id="cstep"> Also add a step to each student\u2019s record</label>
      <div id="csteps" class="hidden mt12"><div class="step-btns">${[1, 2, 3, 4, 5].map((n) => h`<button type="button" class="step-btn s${n}" data-step="${n}" aria-pressed="false">Step ${n}</button>`)}</div></div></div>`}
    <div class="row end"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn ${award ? 'primary' : 'danger'}" id="cgo"></button></div>
    <div class="error-text" id="cerr" role="alert"></div>`);
  const boxes = () => $$('#who input', dlg.el);
  const chosen = () => boxes().filter((b) => b.checked).map((b) => Number(b.dataset.sid));
  const sync = () => {
    const n = chosen().length;
    $('#cnt', dlg.el).textContent = `${n} of ${d.members.length}`;
    const go = $('#cgo', dlg.el);
    go.textContent = `${award ? 'Award' : 'Fine'} ${n} student${n === 1 ? '' : 's'}`;
    go.disabled = n === 0;
  };
  boxes().forEach((b) => b.addEventListener('change', sync));
  $('#all', dlg.el).addEventListener('click', () => { boxes().forEach((b) => { b.checked = true; }); sync(); });
  $('#none', dlg.el).addEventListener('click', () => { boxes().forEach((b) => { b.checked = false; }); sync(); });
  $$('#amts [data-amt]', dlg.el).forEach((b) => b.addEventListener('click', () => {
    amount = Number(b.dataset.amt);
    $$('#amts [data-amt]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $$('#cats [data-cat]', dlg.el).forEach((b) => b.addEventListener('click', () => {
    cat = cats.find((c) => c.id === Number(b.dataset.cat));
    $$('#cats [data-cat]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  if (!award) {
    $('#cstep', dlg.el).addEventListener('change', (e) => $('#csteps', dlg.el).classList.toggle('hidden', !e.target.checked));
    $$('[data-step]', dlg.el).forEach((b) => b.addEventListener('click', () => {
      level = Number(b.dataset.step);
      $$('[data-step]', dlg.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
  }
  $('[data-x]', dlg.el).addEventListener('click', dlg.close);
  $('#cgo', dlg.el).addEventListener('click', async () => {
    const err = $('#cerr', dlg.el);
    err.textContent = '';
    const ids = chosen();
    const addStep = !award && $('#cstep', dlg.el).checked;
    if (!ids.length) { err.textContent = 'Choose at least one student.'; return; }
    if (!cat) { err.textContent = 'Choose what it\u2019s for.'; return; }
    if (addStep && !level) { err.textContent = 'Choose a step level, or untick \u201cAlso add a step\u201d.'; return; }
    const who = ids.length === d.members.length ? `all ${ids.length} students` : `${ids.length} of ${d.members.length} students`;
    const msg = `${award ? 'Award' : 'Fine'} ${amount} ${cat.name} point${amount === 1 ? '' : 's'} ${award ? 'to' : 'from'} ${who}${addStep ? `, and add a Step ${level} to each of their records` : ''}?`;
    if (!(await confirmBox(msg, { ok: award ? 'Award' : 'Fine', danger: !award }))) return;
    const go = $('#cgo', dlg.el);
    go.disabled = true;
    try {
      const r = await api('/p5', { method: 'POST', body: {
        mode, student_ids: ids, category_id: cat.id, amount, note: $('#cn', dlg.el).value || null, date: me.today,
        step: addStep ? { add: true, level } : undefined } });
      const bal = new Map(r.results.map((x) => [x.student_id, x.balance]));
      d.members.forEach((m) => { if (bal.has(m.student_id)) m.balance = bal.get(m.student_id); });
      state.classAmount = amount;
      dlg.close();
      toast(`${award ? 'Awarded' : 'Fined'} ${amount} ${cat.name} point${amount === 1 ? '' : 's'} ${award ? 'to' : 'from'} ${ids.length} student${ids.length === 1 ? '' : 's'}${addStep ? ' and added a step to each' : ''}.`);
      done();
    } catch (e) { err.textContent = e.message; go.disabled = false; }
  });
  sync();
}

// --------------------------------------------------------------------------------------
// Students tab
// --------------------------------------------------------------------------------------
async function studentsTab(box, d, reload) {
  const hr = await api('/homerooms');
  mount(box, h`
    <div class="card"><h2>Add students</h2>
      <p class="muted">Students can join with the class code. You can also add them yourself.</p>
      <div id="pk"></div>
      ${hr.homerooms.length ? h`<div class="row mt8"><select id="hr" aria-label="Add a whole homeroom" class="maxw340"><option value="">Add a whole homeroom\u2026</option>
        ${hr.homerooms.map((x) => h`<option value="${x.grade}|${x.homeroom_teacher}">Grade ${x.grade} \u2022 ${x.homeroom_teacher} (${x.n})</option>`)}</select><button type="button" class="btn small" id="addhr">Pick homeroom</button></div>` : ''}
      <div class="row mt12"><button type="button" class="btn primary" id="addgo">Add to class</button></div></div>
    <div class="card"><div class="row jc-between mb8"><h2 class="m0">${d.members.length} student${d.members.length === 1 ? '' : 's'} in this class</h2>
      <div class="row no-print"><button type="button" class="btn plus-btn" id="clsAward" ${d.members.length ? '' : raw('disabled')}>\u2b50 Award whole class</button><button type="button" class="btn danger" id="clsFine" ${d.members.length ? '' : raw('disabled')}>Fine whole class</button></div></div>
      ${d.members.length ? h`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Gr</th><th>Homeroom</th><th class="num">P5</th><th>Joined</th><th class="no-print"></th></tr></thead><tbody>
        ${d.members.map((m) => h`<tr><td>${m.last_name}, ${m.first_name}</td><td>${m.grade}</td><td>${m.homeroom_teacher || ''}</td><td class="num">${m.balance}</td>
          <td class="small">${m.source === 'code' ? 'With code' : 'Added by teacher'} \u2022 ${fmtDate(m.joined_at.slice(0, 10))}</td>
          <td class="no-print"><button class="btn small danger" data-rm="${m.student_id}">Remove</button></td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>No students yet</strong>Share the class code or add students above.</div>`}</div>`);
  $('#clsAward', box).addEventListener('click', () => classReward(d, 'award', reload));
  $('#clsFine', box).addEventListener('click', () => classReward(d, 'fine', reload));
  const picker = studentPicker($('#pk', box), { multi: true });
  const addhr = $('#addhr', box);
  if (addhr) addhr.addEventListener('click', async () => {
    const v = $('#hr', box).value;
    if (!v) return;
    const [grade, name] = v.split('|');
    try { const { students } = await api(`/homerooms/students?grade=${grade}&homeroom=${encodeURIComponent(name)}`); picker.addMany(students); toast(`Picked ${students.length} students. Click Add to class.`); }
    catch (e) { fail(e); }
  });
  $('#addgo', box).addEventListener('click', async () => {
    const list = picker.get();
    if (!list.length) { toast('Choose at least one student.', 'err'); return; }
    try { const r = await api(`/classes/${d.class.id}/members`, { method: 'POST', body: { student_ids: list.map((s) => s.student_id) } }); toast(`Added ${r.added} student${r.added === 1 ? '' : 's'}.`); reload(); }
    catch (e) { fail(e); }
  });
  $$('[data-rm]', box).forEach((b) => b.addEventListener('click', async () => {
    const m = d.members.find((x) => String(x.student_id) === b.dataset.rm);
    if (!(await confirmBox(`Remove ${m.first_name} ${m.last_name} from this class? Their desk is emptied.`, { ok: 'Remove', danger: true }))) return;
    try { await api(`/classes/${d.class.id}/members/${m.student_id}`, { method: 'DELETE' }); toast('Removed.'); reload(); } catch (e) { fail(e); }
  }));
}

// --------------------------------------------------------------------------------------
// Rewards tab: which store rewards this class offers
// --------------------------------------------------------------------------------------
async function rewardsTab(box, d, reload) {
  const cid = d.class.id;
  const [r, list] = await Promise.all([api(`/classes/${cid}/rewards`), api('/classes?archived=1')]);
  const school = r.items.filter((i) => i.scope === 'school');
  const custom = r.items.filter((i) => i.scope === 'custom');
  const others = list.classes.filter((c) => c.id !== cid);
  const isOn = (id) => (r.configured ? r.selected.includes(id) : school.some((i) => i.id === id));
  const row = (i) => h`<label class="reward-row"><input type="checkbox" data-item="${i.id}" ${isOn(i.id) ? raw('checked') : ''}>
    <span class="rw-em">${i.emoji || '\ud83c\udf81'}</span>
    <span class="rw-main"><strong>${i.name}</strong><span class="muted small">${i.description || ''}</span></span>
    <span class="chip gray">${i.price} P5</span><span class="muted small rw-stock">${i.stock === null ? '' : i.stock + ' left'}</span></label>`;
  mount(box, h`
    ${r.configured ? h`<div class="banner info">Students in this class can buy the rewards ticked below. Change the ticks and save to update them.</div>`
      : h`<div class="banner warn">This class is using the <strong>default</strong>: every school reward. Tick the rewards you want, then save to choose your own.</div>`}
    <div class="card"><div class="row jc-between mb8"><h2 class="m0">School rewards</h2>
      <div class="row"><button type="button" class="btn small" id="rAll">Tick all</button><button type="button" class="btn small" id="rNone">Untick all</button></div></div>
      ${school.length ? h`<div class="reward-list">${school.map(row)}</div>` : h`<div class="empty"><strong>No school rewards yet</strong>An Admin can add some on the Store page.</div>`}</div>
    <div class="card"><div class="row jc-between mb8"><div><h2 class="m0">My class rewards</h2><p class="muted m0">Only students in classes where you tick them can see them.</p></div>
      <button type="button" class="btn" id="rNew">Add a class reward</button></div>
      ${custom.length ? h`<div class="reward-list">${custom.map(row)}</div>` : h`<div class="empty"><strong>No class rewards yet</strong>Add a reward just for your classes, like \u201cFive minutes of extra recess.\u201d</div>`}</div>
    <div class="card"><div class="row jc-between">
      <div class="row"><span class="chip gray" id="rCount"></span>
        ${others.length ? h`<label for="rCopy" class="hidden">Copy from another class</label><select id="rCopy" class="maxw220">${others.map((o) => h`<option value="${o.id}">${o.name}${o.period ? ' (P' + o.period + ')' : ''} \u2022 ${o.school_year}</option>`)}</select><button type="button" class="btn small" id="rCopyGo">Copy ticks</button>` : ''}</div>
      <div class="row">${r.configured ? h`<button type="button" class="btn danger" id="rReset">Back to default</button>` : ''}<button type="button" class="btn primary" id="rSave">Save rewards</button></div></div>
      <div class="help mt8">Students who are in more than one class can buy anything any of their classes offers.</div></div>`);
  const boxes = () => $$('input[data-item]', box);
  const count = () => { const n = boxes().filter((b) => b.checked).length; $('#rCount', box).textContent = `${n} reward${n === 1 ? '' : 's'} on`; };
  boxes().forEach((b) => b.addEventListener('change', count));
  $('#rAll', box).addEventListener('click', () => { $$('input[data-item]', box).forEach((b) => { if (school.some((i) => String(i.id) === b.dataset.item)) b.checked = true; }); count(); });
  $('#rNone', box).addEventListener('click', () => { $$('input[data-item]', box).forEach((b) => { if (school.some((i) => String(i.id) === b.dataset.item)) b.checked = false; }); count(); });
  $('#rNew', box).addEventListener('click', () => itemForm(null, 'mine', () => { toast('Tick it below and save to offer it in this class.'); reload(); }));
  const copy = $('#rCopyGo', box);
  if (copy) copy.addEventListener('click', async () => {
    try {
      const src = await api(`/classes/${Number($('#rCopy', box).value)}/rewards`);
      const on = new Set(src.configured ? src.selected : src.items.filter((i) => i.scope === 'school').map((i) => i.id));
      boxes().forEach((b) => { b.checked = on.has(Number(b.dataset.item)); });
      count();
      toast('Ticks copied. Click Save rewards to keep them.');
    } catch (e) { fail(e); }
  });
  $('#rSave', box).addEventListener('click', async () => {
    const ids = boxes().filter((b) => b.checked).map((b) => Number(b.dataset.item));
    try {
      await api(`/classes/${cid}/rewards`, { method: 'PUT', body: { item_ids: ids } });
      toast(ids.length ? `Saved. This class offers ${ids.length} reward${ids.length === 1 ? '' : 's'}.` : 'Saved. This class has no rewards switched on.');
      reload();
    } catch (e) { fail(e); }
  });
  const reset = $('#rReset', box);
  if (reset) reset.addEventListener('click', async () => {
    if (!(await confirmBox('Go back to the default (every school reward) for this class? Your custom picks for this class are cleared.', { ok: 'Back to default' }))) return;
    try { await api(`/classes/${cid}/rewards`, { method: 'DELETE' }); toast('This class is using the default again.'); reload(); } catch (e) { fail(e); }
  });
  count();
}

// --------------------------------------------------------------------------------------
// Settings tab
// --------------------------------------------------------------------------------------
function settingsTab(box, d, reload) {
  const c = d.class;
  mount(box, h`<div class="card maxw480"><h2>Class settings</h2>
    <div class="field"><label for="s_n">Class name</label><input type="text" id="s_n" value="${c.name}" maxlength="60"></div>
    <div class="field"><label for="s_p">Period (optional)</label><input type="text" id="s_p" value="${c.period || ''}" maxlength="20"></div>
    <div class="field"><label class="check"><input type="checkbox" id="s_j" ${c.join_open ? raw('checked') : ''}> Students can join with the code</label>
      <div class="help">Turn this off once everyone has joined.</div></div>
    <div class="row"><button class="btn primary" id="s_save">Save</button></div><div class="error-text" id="s_err" role="alert"></div></div>
    <div class="card maxw480"><h2>Class code</h2><p class="muted">Making a new code stops the old one from working. Students already in the class stay in it.</p>
      <button class="btn" id="s_code">Make a new code</button></div>
    <div class="card maxw480"><h2>${c.archived ? 'Archived class' : 'Archive this class'}</h2>
      <p class="muted">${c.archived ? 'This class is hidden from students and from your main list. Its seating layout can still be copied to a new class.' : 'Archiving hides the class from students and your main list at the end of a term. You can bring it back, and you can still copy its seating layout.'}</p>
      <button class="btn ${c.archived ? '' : 'danger'}" id="s_arch">${c.archived ? 'Restore class' : 'Archive class'}</button></div>`);
  $('#s_save', box).addEventListener('click', async () => {
    try { await api('/classes/' + c.id, { method: 'PATCH', body: { name: $('#s_n', box).value, period: $('#s_p', box).value || null, join_open: $('#s_j', box).checked } }); toast('Saved.'); reload(); }
    catch (e) { $('#s_err', box).textContent = e.message; }
  });
  $('#s_code', box).addEventListener('click', async () => {
    if (!(await confirmBox('Make a new class code? The current code stops working right away.', { ok: 'Make new code' }))) return;
    try { const r = await api(`/classes/${c.id}/regenerate-code`, { method: 'POST', body: {} }); toast(`New code: ${r.code}`); reload(); } catch (e) { fail(e); }
  });
  $('#s_arch', box).addEventListener('click', async () => {
    if (!c.archived && !(await confirmBox('Archive this class? Students will no longer see it.', { ok: 'Archive', danger: true }))) return;
    try { await api('/classes/' + c.id, { method: 'PATCH', body: { archived: !c.archived } }); toast(c.archived ? 'Class restored.' : 'Class archived.'); reload(); } catch (e) { fail(e); }
  });
}

// ======================================================================================
// Student: join a class
// ======================================================================================
export async function studentClasses(el) {
  loading(el);
  const { classes } = await api('/student/classes');
  mount(el, h`
    <h1>\ud83d\udd11 My classes</h1><p class="muted">Type the code your teacher gave you to join a class.</p>
    <div class="card maxw480"><div class="field"><label for="jc">Class code</label>
      <input type="text" id="jc" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" class="pin-input"></div>
      <button class="btn primary" id="jgo">Join class</button><div class="error-text" id="jerr" role="alert"></div></div>
    <div class="card"><h2>Your classes</h2>
      ${classes.length ? h`<div class="table-wrap"><table><thead><tr><th>Class</th><th>Period</th><th>Teacher</th><th></th></tr></thead><tbody>
        ${classes.map((c) => h`<tr><td><strong>${c.name}</strong></td><td>${c.period || ''}</td><td>${c.teacher}</td><td><button class="btn small danger" data-leave="${c.id}">Leave</button></td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>You haven\u2019t joined a class yet</strong>Ask your teacher for the class code.</div>`}</div>`);
  const input = $('#jc', el);
  const go = async () => {
    const err = $('#jerr', el);
    err.textContent = '';
    try {
      const r = await api('/student/classes/join', { method: 'POST', body: { code: input.value } });
      toast(r.already ? `You\u2019re already in ${r.class.name}.` : `You joined ${r.class.name}!`);
      studentClasses(el).catch(fail);
    } catch (e) { err.textContent = e.message; }
  };
  $('#jgo', el).addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $$('[data-leave]', el).forEach((b) => b.addEventListener('click', async () => {
    const c = classes.find((x) => String(x.id) === b.dataset.leave);
    if (!(await confirmBox(`Leave ${c.name}? You can join again with the code.`, { ok: 'Leave class', danger: true }))) return;
    try { await api('/student/classes/' + c.id, { method: 'DELETE' }); toast('You left the class.'); studentClasses(el).catch(fail); } catch (e) { fail(e); }
  }));
  input.focus();
}
