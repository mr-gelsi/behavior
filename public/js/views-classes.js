import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, studentPicker, loadCategories, fmtDate, lastFirst, downloadCsv, fmtMD,
} from './core.js';
import { randomInt, targetRotation, sliceAtPointer, TAU } from './spinner-core.js';
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
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });
// Periods like "1", "2", "10" sort as numbers; text periods next; classes without a period last.
const periodKey = (p) => { if (!p) return [2, 0, '']; const n = parseFloat(p); return Number.isNaN(n) ? [1, 0, p] : [0, n, '']; };
const cmpPeriod = (a, b) => { const x = periodKey(a), y = periodKey(b); return x[0] - y[0] || x[1] - y[1] || cmp(x[2], y[2]); };
function sortClasses(list, key) {
  const teacher = (a, b) => cmp(a.owner_last_name || a.owner_name, b.owner_last_name || b.owner_name) || cmp(a.owner_name, b.owner_name);
  const out = [...list];
  if (key === 'teacher') out.sort((a, b) => teacher(a, b) || cmpPeriod(a.period, b.period) || cmp(a.name, b.name));
  else if (key === 'name') out.sort((a, b) => cmp(a.name, b.name) || cmpPeriod(a.period, b.period) || teacher(a, b));
  else out.sort((a, b) => cmpPeriod(a.period, b.period) || cmp(a.name, b.name) || teacher(a, b));
  return out;
}

export async function classesList(el) {
  loading(el);
  const admin = state.me.user.role === 'admin';
  const v = state.classView || (state.classView = { owner: 'me', sort: 'period' });
  if (!admin) v.owner = 'me';
  const arch = !!state.showArchivedClasses;
  const data = await api(`/classes?archived=${arch ? 1 : 0}&owner=${encodeURIComponent(v.owner)}`);
  const others = admin && v.owner !== 'me';
  if (v.sort === 'teacher' && !others) v.sort = 'period';
  const classes = sortClasses(data.classes, v.sort);
  const card = (c) => h`<div class="class-card ${c.archived ? 'archived' : ''}">
      <div><strong class="fs18">${c.name}</strong><div class="muted small">${[c.period ? 'Period ' + c.period : '', c.school_year, others && v.sort !== 'teacher' ? lastFirst(c.owner_name, c.owner_last_name) : ''].filter(Boolean).join(' \u2022 ')}</div></div>
      <div class="row"><span class="chip gray">${c.members} student${c.members === 1 ? '' : 's'}</span><span class="chip ${c.join_open && !c.archived ? 'ok' : 'gray'}">${c.archived ? 'Archived' : c.join_open ? 'Joining open' : 'Joining closed'}</span></div>
      <div class="code-box"><span class="code">${c.code}</span><button class="btn small" data-copy="${c.code}">Copy</button></div>
      <div class="row"><a class="btn primary" href="#/class/${c.id}">Open</a></div></div>`;
  let body;
  if (!classes.length) {
    body = h`<div class="card"><div class="empty"><strong>${others ? 'No classes to show' : arch ? 'No classes yet' : 'No active classes yet'}</strong>${others ? 'This teacher has no classes yet.' : 'Create a class, give students its code, then set up your seating chart.'}</div></div>`;
  } else if (others && v.sort === 'teacher') {
    const groups = [];
    for (const c of classes) {
      const g = groups[groups.length - 1];
      if (g && g.id === c.owner_id) g.items.push(c); else groups.push({ id: c.owner_id, label: lastFirst(c.owner_name, c.owner_last_name), items: [c] });
    }
    body = h`${groups.map((g) => h`<h2 class="mt16">${g.label} <span class="muted small">\u2022 ${g.items.length} class${g.items.length === 1 ? '' : 'es'}</span></h2><div class="class-grid">${g.items.map(card)}</div>`)}`;
  } else {
    body = h`<div class="class-grid">${classes.map(card)}</div>`;
  }
  mount(el, h`
    <div class="page-head"><div><h1>\ud83c\udfeb ${others ? 'Classes' : 'My classes'}</h1><p class="muted">${others ? 'Classes made by teachers at your school.' : 'Classes you created. Each has a code students type in to join. Open one for its seating chart.'}</p></div>
      <div class="actions"><button class="btn primary" id="new">New class</button></div></div>
    <div class="card no-print"><div class="form-grid">
      ${admin ? h`<div><label for="cv_owner">Show</label><select id="cv_owner"><option value="me" ${v.owner === 'me' ? raw('selected') : ''}>My classes</option><option value="all" ${v.owner === 'all' ? raw('selected') : ''}>All teachers</option>
        ${data.teachers && data.teachers.length ? h`<optgroup label="One teacher (by last name)">${data.teachers.map((t) => h`<option value="${t.id}" ${String(t.id) === v.owner ? raw('selected') : ''}>${lastFirst(t.name, t.last_name)}</option>`)}</optgroup>` : ''}</select></div>` : ''}
      <div><label for="cv_sort">Sort by</label><select id="cv_sort">
        <option value="period" ${v.sort === 'period' ? raw('selected') : ''}>Period</option>
        <option value="name" ${v.sort === 'name' ? raw('selected') : ''}>Class name</option>
        ${others ? h`<option value="teacher" ${v.sort === 'teacher' ? raw('selected') : ''}>Teacher (last name)</option>` : ''}</select></div>
      <div class="self-end"><label class="check"><input type="checkbox" id="arch" ${arch ? raw('checked') : ''}> Show archived</label></div></div></div>
    ${body}`);
  const ownerSel = $('#cv_owner', el);
  if (ownerSel) ownerSel.addEventListener('change', () => { v.owner = ownerSel.value; v.sort = v.owner === 'all' ? 'teacher' : 'period'; classesList(el).catch(fail); });
  $('#cv_sort', el).addEventListener('change', (e) => { v.sort = e.target.value; classesList(el).catch(fail); });
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
        v.owner = 'me';
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
    <div class="tabs no-print" role="tablist">${[['seating', 'Seating chart'], ['students', 'Students'], ['spinner', 'Name spinner'], ['rewards', 'Rewards'], ['report', 'Report'], ['settings', 'Settings']].map(([k, l]) => h`<button role="tab" data-t="${k}" aria-selected="${tab === k}">${l}</button>`)}</div>
    <div id="tab"></div>`);
  $('#copy', el).addEventListener('click', () => copyText(c.code));
  $$('.tabs button', el).forEach((b) => b.addEventListener('click', async () => {
    if (state.leaveGuard && state.leaveGuard() && !(await confirmBox(state.leaveGuard(), { ok: 'Leave without saving', danger: true }))) return;
    state.classTab = b.dataset.t; state.leaveGuard = null; reload();
  }));
  const box = $('#tab', el);
  if (tab === 'seating') await seating(box, d, reload);
  else if (tab === 'students') await studentsTab(box, d, reload);
  else if (tab === 'spinner') spinnerTab(box, d);
  else if (tab === 'rewards') await rewardsTab(box, d, reload);
  else if (tab === 'report') await reportTab(box, d);
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
// Name spinner: a wheel filled from the class list
// --------------------------------------------------------------------------------------
const WHEEL_COLORS = ['#c8102e', '#1f6fd1', '#23895a', '#b36b00', '#7a4fd1', '#b83272', '#0f7f8f', '#7a4a1e'];

function drawWheel(canvas, list, rotation) {
  const size = 560;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 10;
  const n = list.length;
  if (!n) {
    ctx.fillStyle = '#3a3d44'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#aeb2b9'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No names on the wheel', cx, cy + 8);
    return;
  }
  const step = TAU / n;
  const fontSize = n <= 10 ? 28 : n <= 18 ? 22 : n <= 28 ? 17 : n <= 40 ? 14 : 11;
  ctx.font = `800 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  list.forEach((e, i) => {
    const a0 = rotation + i * step - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    if (n === 1) ctx.arc(cx, cy, r, 0, TAU); else ctx.arc(cx, cy, r, a0, a0 + step);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(a0 + step / 2);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
    let label = e.label;
    const maxW = r - 62;
    while (label.length > 3 && ctx.measureText(label).width > maxW) label = label.slice(0, -2) + '\u2026';
    ctx.fillText(label, r - 16, fontSize * 0.34);
    ctx.restore();
  });
  ctx.beginPath(); ctx.arc(cx, cy, 34, 0, TAU); ctx.fillStyle = '#1b1c1f'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
}

function spinnerTab(box, d) {
  const members = d.members;
  const book = state.spin || (state.spin = {});
  const S = book[d.class.id] || (book[d.class.id] = { off: new Set(), picked: new Set(), extras: [], nextExtra: 1, remove: true, rotation: 0, result: null, history: [] });
  S.spinning = false;
  const entries = () => {
    const list = members.filter((m) => !S.off.has(m.student_id))
      .map((m) => ({ key: 's' + m.student_id, label: shortName(m), full: `${m.first_name} ${m.last_name}`, member: m }))
      .concat(S.extras.map((x) => ({ key: 'x' + x.id, label: x.name, full: x.name, member: null })));
    return S.remove ? list.filter((e) => !S.picked.has(e.key)) : list;
  };
  let drawn = entries();

  mount(box, h`
    <div class="spin-layout">
      <div class="card spin-stage">
        <div class="wheel-wrap"><div class="wheel-pointer" aria-hidden="true"></div><canvas class="wheel-canvas" id="wheel" role="img"></canvas></div>
        <div class="row jc-center mt12"><button type="button" class="btn primary spin-btn" id="spinBtn">Spin the wheel</button></div>
        <div id="spinResult" class="spin-result" role="status" aria-live="polite"></div>
      </div>
      <aside class="spin-side" id="spinSide"></aside>
    </div>`);
  const canvas = $('#wheel', box);

  function paintWheel() {
    canvas.setAttribute('aria-label', `Name wheel with ${drawn.length} name${drawn.length === 1 ? '' : 's'}`);
    drawWheel(canvas, drawn, S.rotation);
    $('#spinBtn', box).disabled = S.spinning || entries().length === 0;
  }
  function paintResult() {
    const el = $('#spinResult', box);
    if (!members.length && !S.extras.length) { mount(el, h`<div class="empty"><strong>No students yet</strong>Add students on the <strong>Students</strong> tab, or type some names on the right.</div>`); return; }
    if (!drawn.length && !S.result) { mount(el, h`<p class="muted center">Nobody is on the wheel. Tick some names on the right.</p>`); return; }
    if (S.spinning) { mount(el, h`<p class="muted center">Spinning\u2026</p>`); return; }
    if (!S.result) { mount(el, h`<p class="muted center">${drawn.length} name${drawn.length === 1 ? '' : 's'} on the wheel. Press the button to pick one.</p>`); return; }
    const r = S.result;
    mount(el, h`<div class="result-card"><div class="muted small">\ud83c\udf89 The wheel picked</div><div class="result-name">${r.full}</div>
      <div class="row jc-center">
        ${r.member ? h`<button type="button" class="btn plus-btn" data-res="award">+ Award points</button><button type="button" class="btn danger" data-res="fine">\u2212 Fine points</button>` : ''}
        ${S.remove && S.picked.has(r.key) ? h`<button type="button" class="btn" data-res="back">Put back on the wheel</button>` : ''}</div>
      ${S.remove && !drawn.some((e) => e.key !== r.key) && S.picked.has(r.key) ? h`<p class="muted small center mt8">Everyone has had a turn. Press Reset wheel to start again.</p>` : ''}</div>`);
  }
  function paintSide() {
    const typed = $('#spExtra', box) ? $('#spExtra', box).value : '';
    const on = entries().length;
    mount($('#spinSide', box), h`
      <div class="card"><div class="row jc-between mb8"><h3 class="m0">Who is here? <span class="chip gray">${on} on the wheel</span></h3>
        <div class="row"><button type="button" class="btn small" id="spAll">All</button><button type="button" class="btn small" id="spNone">None</button></div></div>
        ${members.length ? h`<div class="check-grid" id="spWho">${members.map((m) => h`<label class="check"><input type="checkbox" data-sid="${m.student_id}" ${S.off.has(m.student_id) ? '' : raw('checked')}> ${m.last_name}, ${m.first_name}</label>`)}</div>
          <div class="help">The wheel fills itself from this class. Untick anyone who is absent.</div>` : h`<p class="muted small">No students in this class yet.</p>`}</div>
      <div class="card"><h3>Add other names</h3>
        <label for="spExtra" class="hidden">Other names, one per line</label><textarea id="spExtra" rows="3" placeholder="One name per line (for groups, helpers, or guests)"></textarea>
        <div class="row mt8"><button type="button" class="btn small" id="spAdd">Add to wheel</button></div>
        ${S.extras.length ? h`<div class="chips mt8">${S.extras.map((x) => h`<span class="chip removable">${x.name}<button type="button" data-rmx="${x.id}" aria-label="Remove ${x.name}">\u00d7</button></span>`)}</div>` : ''}</div>
      <div class="card"><label class="check"><input type="checkbox" id="spRemove" ${S.remove ? raw('checked') : ''}> Take each winner off the wheel so everyone gets a turn</label>
        <div class="row mt12"><button type="button" class="btn" id="spReset">Reset wheel</button></div>
        ${S.history.length ? h`<h3 class="mt14">Picked so far (${S.history.length})</h3><ol class="pick-list">${S.history.map((n) => h`<li>${n}</li>`)}</ol>` : ''}</div>`);
    if (typed) $('#spExtra', box).value = typed;
  }
  function refresh(redrawWheel = true) {
    if (redrawWheel && !S.spinning) drawn = entries();
    paintWheel(); paintResult(); paintSide();
  }

  function spin() {
    if (S.spinning) return;
    drawn = entries();
    if (!drawn.length) { refresh(); return; }
    S.spinning = true;
    S.result = null;
    const n = drawn.length;
    const from = Math.random() * TAU;                      // cosmetic start position
    const to = targetRotation(randomInt(n), n, from);      // the pick itself uses secure random numbers
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 0 : 4200 + Math.random() * 900;
    const t0 = performance.now();
    paintResult(); $('#spinBtn', box).disabled = true;
    const frame = (t) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      S.rotation = from + (to - from) * (1 - Math.pow(1 - k, 3));
      drawWheel(canvas, drawn, S.rotation);
      if (k < 1) { requestAnimationFrame(frame); return; }
      S.spinning = false;
      const win = drawn[sliceAtPointer(S.rotation, n)];     // read the winner off the wheel the teacher is looking at
      S.result = win; S.history.push(win.full);
      if (S.remove) S.picked.add(win.key);
      paintWheel(); paintResult(); paintSide();
    };
    requestAnimationFrame(frame);
  }

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.id === 'spinBtn') return spin();
    if (S.spinning) return;
    if (b.id === 'spAll') { S.off.clear(); return refresh(); }
    if (b.id === 'spNone') { members.forEach((m) => S.off.add(m.student_id)); return refresh(); }
    if (b.id === 'spAdd') {
      const names = $('#spExtra', box).value.split('\n').map((x) => x.trim().slice(0, 30)).filter(Boolean);
      if (!names.length) { toast('Type at least one name first.', 'err'); return; }
      names.slice(0, 60).forEach((name) => S.extras.push({ id: S.nextExtra++, name }));
      return refresh();
    }
    if (b.dataset.rmx) { S.extras = S.extras.filter((x) => String(x.id) !== b.dataset.rmx); S.picked.delete('x' + b.dataset.rmx); return refresh(); }
    if (b.id === 'spReset') { S.picked.clear(); S.result = null; S.history = []; return refresh(); }
    if (b.dataset.res === 'back' && S.result) { S.picked.delete(S.result.key); S.history = S.history.slice(0, -1); S.result = null; return refresh(); }
    if ((b.dataset.res === 'award' || b.dataset.res === 'fine') && S.result && S.result.member) deskReward(S.result.member, b.dataset.res, () => {});
  });
  box.addEventListener('change', (e) => {
    if (S.spinning) return;
    if (e.target.dataset && e.target.dataset.sid) {
      const id = Number(e.target.dataset.sid);
      if (e.target.checked) S.off.delete(id); else S.off.add(id);
      refresh();
    } else if (e.target.id === 'spRemove') { S.remove = e.target.checked; if (!S.remove) S.picked.clear(); refresh(); }
  });
  refresh();
}

// --------------------------------------------------------------------------------------
// Report tab: one class, one school year (or any dates)
// --------------------------------------------------------------------------------------
const TYPE_LABEL = { award: 'Award', fine: 'Fine', purchase: 'Store purchase', refund: 'Store refund', seat: 'Rewards Day seat', seat_refund: 'Seat refund', adjustment: 'Reversal' };
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';

async function reportTab(box, d) {
  const cid = d.class.id;
  const me = state.me;
  const saved = state.reportView || (state.reportView = {});
  const v = saved[cid] || (saved[cid] = { year: state.year || me.school_year, from: '', to: '' });
  const years = [...new Set([v.year, ...me.years])].sort().reverse();
  mount(box, h`
    <div class="card no-print"><h2>Class report</h2>
      <p class="muted">Steps, P5 points, store orders, and Rewards Day for everyone in this class.</p>
      <div class="form-grid">
        <div><label for="rp_y">School year</label><select id="rp_y">${years.map((y) => h`<option value="${y}" ${y === v.year ? raw('selected') : ''}>${y}</option>`)}</select></div>
        <div><label for="rp_f">From (optional)</label><input type="date" id="rp_f" value="${v.from}"></div>
        <div><label for="rp_t">To (optional)</label><input type="date" id="rp_t" value="${v.to}"></div>
      </div>
      <div class="help mb12">Leave the dates empty to cover the whole school year (August 1 to July 31). Dates limit steps, points, and orders.</div>
      <div class="row"><button type="button" class="btn primary" id="rpRun">Show report</button></div></div>
    <div id="rpOut"></div>`);
  const out = $('#rpOut', box);
  let data = null;

  async function run() {
    v.year = $('#rp_y', box).value; v.from = $('#rp_f', box).value; v.to = $('#rp_t', box).value;
    mount(out, h`<div class="spinner">Building the report\u2026</div>`);
    try {
      const qs = `year=${encodeURIComponent(v.year)}${v.from ? '&from=' + v.from : ''}${v.to ? '&to=' + v.to : ''}`;
      data = await api(`/classes/${cid}/report?${qs}`);
    } catch (e) { mount(out, h``); fail(e); return; }
    paint();
  }

  function paint() {
    const r = data, t = r.totals, c = r.class;
    const nm = (x) => `${x.last_name}, ${x.first_name}`;
    const range = `${fmtDate(r.from)} \u2013 ${fmtDate(r.to)}`;
    const cut = Object.entries(r.truncated).filter(([, v2]) => v2).map(([k]) => ({ steps: 'step history', p5: 'P5 history', orders: 'store orders' }[k]));
    mount(out, h`
      <div class="report-print">
        <div class="print-only report-head"><h1>${state.me.settings.school_name}: class report</h1>
          <p>${c.name}${c.period ? ' \u2022 Period ' + c.period : ''} \u2022 Teacher: ${c.owner_name} \u2022 ${range} \u2022 Printed ${fmtDate(new Date().toISOString().slice(0, 10))}</p></div>
        <div class="card"><div class="row jc-between mb8"><div><h2 class="m0">${c.name}${c.period ? ' (Period ' + c.period + ')' : ''}</h2><p class="muted m0">${range} \u2022 ${r.students.length} student${r.students.length === 1 ? '' : 's'}</p></div>
          <div class="row no-print"><button type="button" class="btn primary" id="rpPrint">Print or save as PDF</button></div></div>
          <div class="no-print row mb8"><span class="muted small">Download as a spreadsheet:</span>
            <button type="button" class="btn small" data-csv="summary">Student summary</button><button type="button" class="btn small" data-csv="steps">Step history</button>
            <button type="button" class="btn small" data-csv="p5">P5 points</button><button type="button" class="btn small" data-csv="orders">Store orders</button></div>
          ${cut.length ? h`<div class="banner warn">This is a very large report, so the ${cut.join(', ')} list${cut.length === 1 ? ' shows' : 's show'} only the first 20,000 rows. Try a shorter date range.</div>` : ''}
          <div class="kpi-grid report-kpis">
            <div class="kpi"><div class="label">Steps</div><div class="big">${t.steps_total}</div><div class="sub">1: ${t.s1} \u2022 2: ${t.s2} \u2022 3: ${t.s3} \u2022 4: ${t.s4} \u2022 5: ${t.s5}</div></div>
            <div class="kpi"><div class="label">P5 awarded</div><div class="big">${t.awarded}</div><div class="sub">${t.fined} fined</div></div>
            <div class="kpi"><div class="label">P5 spent</div><div class="big">${t.spent}</div><div class="sub">${t.orders} store order${t.orders === 1 ? '' : 's'}</div></div>
            <div class="kpi"><div class="label">P5 balances</div><div class="big">${t.balance}</div><div class="sub">held by the class now</div></div></div></div>
        <div class="card"><h2>Student summary</h2>
          ${r.students.length ? h`<div class="table-wrap"><table class="report-table"><thead><tr><th>Student</th><th>Gr</th><th class="num">S1</th><th class="num">S2</th><th class="num">S3</th><th class="num">S4</th><th class="num">S5</th><th class="num">Steps</th><th class="num">Awarded</th><th class="num">Fined</th><th class="num">Spent</th><th class="num">Balance</th><th class="num">Orders</th><th>Rewards Day</th></tr></thead><tbody>
            ${r.students.map((s) => h`<tr><td>${nm(s)}</td><td>${s.grade}</td>${['s1', 's2'].map((k) => h`<td class="num">${s[k]}</td>`)}${['s3', 's4', 's5'].map((k) => (s[k] ? h`<td class="num hot">${s[k]}</td>` : h`<td class="num">0</td>`))}
              <td class="num"><strong>${s.steps_total}</strong></td><td class="num">${s.awarded}</td><td class="num">${s.fined}</td><td class="num">${s.spent}</td><td class="num">${s.balance}</td><td class="num">${s.orders}</td><td class="small">${s.rewards_day || '\u2014'}</td></tr>`)}
            <tr class="totals"><td>Class total</td><td></td>${['s1', 's2', 's3', 's4', 's5', 'steps_total', 'awarded', 'fined', 'spent', 'balance', 'orders'].map((k) => h`<td class="num">${t[k]}</td>`)}<td></td></tr></tbody></table></div>
            <div class="help">S1 to S5 are the number of Step 1 to Step 5 entries. Balance is each student\u2019s current P5 balance. Awarded and fined are net of any entries you reversed.</div>`
            : h`<div class="empty"><strong>No students in this class yet</strong>Add students on the Students tab.</div>`}</div>
        <details class="card"><summary class="summary-bold">Step history (${r.steps.length})</summary>
          ${r.steps.length ? h`<div class="table-wrap mt8"><table><thead><tr><th>Date</th><th>Student</th><th>Step</th><th>Teacher</th><th>Per</th><th>Notes</th></tr></thead><tbody>
            ${r.steps.map((x) => h`<tr><td class="nowrap">${fmtMD(x.step_date)}</td><td>${nm(x)}</td><td>Step ${x.step_level}</td><td>${x.teacher || ''}</td><td>${x.period || ''}</td><td>${x.notes || ''}</td></tr>`)}</tbody></table></div>` : h`<p class="muted mt8">No steps in this period.</p>`}</details>
        <details class="card"><summary class="summary-bold">P5 points history (${r.p5.length})</summary>
          ${r.p5.length ? h`<div class="table-wrap mt8"><table><thead><tr><th>Date</th><th>Student</th><th>What</th><th>For</th><th class="num">Points</th><th>Note</th><th>Teacher</th></tr></thead><tbody>
            ${r.p5.map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${nm(x)}</td><td>${TYPE_LABEL[x.type] || x.type}</td><td>${x.category || ''}</td><td class="num ${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${x.amount}</td><td>${x.note || ''}</td><td>${x.teacher || ''}</td></tr>`)}</tbody></table></div>` : h`<p class="muted mt8">No P5 activity in this period.</p>`}</details>
        <details class="card"><summary class="summary-bold">Store orders (${r.orders.length})</summary>
          ${r.orders.length ? h`<div class="table-wrap mt8"><table><thead><tr><th>Date</th><th>Student</th><th>Reward</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>
            ${r.orders.map((x) => h`<tr><td class="nowrap">${fmtMD(x.day)}</td><td>${nm(x)}</td><td>${x.item}</td><td class="num">${x.price_paid}</td><td>${x.status}</td></tr>`)}</tbody></table></div>` : h`<p class="muted mt8">No store orders in this period.</p>`}</details>
      </div>`);
  }

  const rows = {
    summary: () => [['Student ID', 'Last name', 'First name', 'Grade', 'Homeroom teacher', 'Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Total steps', 'P5 awarded', 'P5 fined', 'P5 spent', 'P5 balance', 'Store orders', 'Rewards Day'],
      data.students.map((s) => [s.student_id, s.last_name, s.first_name, s.grade, s.homeroom_teacher, s.s1, s.s2, s.s3, s.s4, s.s5, s.steps_total, s.awarded, s.fined, s.spent, s.balance, s.orders, s.rewards_day])],
    steps: () => [['Date', 'Student ID', 'Last name', 'First name', 'Grade', 'Step', 'Teacher', 'Period', 'Notes'],
      data.steps.map((x) => [x.step_date, x.student_id, x.last_name, x.first_name, x.grade, x.step_level, x.teacher, x.period, x.notes])],
    p5: () => [['Date', 'Student ID', 'Last name', 'First name', 'Grade', 'What', 'For', 'Points', 'Note', 'Teacher'],
      data.p5.map((x) => [x.tx_date, x.student_id, x.last_name, x.first_name, x.grade, TYPE_LABEL[x.type] || x.type, x.category, x.amount, x.note, x.teacher])],
    orders: () => [['Date', 'Student ID', 'Last name', 'First name', 'Grade', 'Reward', 'Points paid', 'Status'],
      data.orders.map((x) => [x.day, x.student_id, x.last_name, x.first_name, x.grade, x.item, x.price_paid, x.status])],
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'rpRun') return run();
    if (!data) return;
    if (b.id === 'rpPrint') { $$('details', box).forEach((x) => { x.open = true; }); window.print(); return; }
    if (b.dataset.csv) {
      const [head, body] = rows[b.dataset.csv]();
      downloadCsv(`${slug(data.class.name)}${data.class.period ? '-p' + slug(data.class.period) : ''}-${data.year}-${b.dataset.csv}.csv`, head, body);
    }
  });
  run();
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
    <h1>\ud83d\udd11 My classes</h1><p class="muted">Type the code your teacher gave you to join a class. You can only see classes you have joined.</p>
    <div class="card maxw480"><div class="field"><label for="jc">Class code</label>
      <input type="text" id="jc" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" class="pin-input"></div>
      <button class="btn primary" id="jgo">Join class</button><div class="error-text" id="jerr" role="alert"></div></div>
    <div class="card"><h2>Classes you\u2019ve joined</h2>
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
