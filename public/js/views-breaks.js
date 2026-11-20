// Restroom / water breaks: the student pop-up and timer, and the teacher "Break Tracker" page.
import { state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDT, fmtDate, downloadCsv } from './core.js';
import { icon } from './icons.js';

const REASON = { restroom: 'Restroom', water: 'Water' };
const loading = (el) => mount(el, h`<div class="spinner">Loading…</div>`);

export function fmtDur(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  const hrs = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (hrs) return `${hrs}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${hrs ? hrs + ':' : ''}${String(m).padStart(hrs ? 2 : 2, '0')}:${String(s).padStart(2, '0')}`;
};
// Restroom/water warning bands. bands = [15,13,11,8] means green up to 15 trips, yellow the next 13 (to 28), orange the next 11 (to 39),
// red the next 8 (to 47), and black above that.
const BAND_NAMES = ['green', 'yellow', 'orange', 'red', 'black'];
const BAND_WORDS = ['', 'Watch', 'Warning', 'High', 'Over limit'];
export function bandInfo(count, bands) {
  let top = 0; const ranges = [];
  bands.forEach((n, i) => { ranges.push([top + 1, top + n]); top += n; });
  let lvl = 4;
  for (let i = 0; i < bands.length; i++) if (count <= ranges[i][1]) { lvl = i; break; }
  return { lvl, name: BAND_NAMES[lvl], word: BAND_WORDS[lvl], ranges };
}
const bandCount = (count, bands) => { const b = bandInfo(count, bands); return h`<strong class="bk-${b.name}">${count}</strong>${b.word ? h` <span class="chip bkchip-${b.name}">${b.word}</span>` : ''}`; };
const bandLegend = (bands) => {
  const r = bandInfo(0, bands).ranges;
  const txt = [`0\u2013${r[0][1]}`, `${r[1][0]}\u2013${r[1][1]}`, `${r[2][0]}\u2013${r[2][1]}`, `${r[3][0]}\u2013${r[3][1]}`, `${r[3][1] + 1}+`];
  return h`<p class="muted small bk-legend">Trips per student in this date range: ${BAND_NAMES.map((n, i) => h`<span class="bk-${n}">${txt[i]}</span>`)}</p>`;
};
const timeOnly = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

// ---------------------------------------------------------------------------------------
// Student: "Restroom / Water" pop-up
// ---------------------------------------------------------------------------------------
export async function openBreakModal() {
  try {
    if ((await api('/student/break')).active) { location.hash = '#/timer'; return; }
  } catch (e) { fail(e); return; }
  let reason = null;
  const m = modal('Leave class', h`
    <p class="muted">Choose why you are leaving, then ask your teacher to type their 4-digit PIN. Your timer starts when the PIN is accepted.</p>
    <div class="reason-btns" role="group" aria-label="Reason for leaving">
      <button type="button" class="reason-btn" data-r="restroom" aria-pressed="false">${icon('person', 34)}<span>Restroom</span></button>
      <button type="button" class="reason-btn" data-r="water" aria-pressed="false">${icon('drop', 34)}<span>Water</span></button>
    </div>
    <div class="field mt16"><label for="bk_pin">Teacher PIN</label>
      <input type="password" id="bk_pin" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <button class="btn primary w100" id="bk_go" type="button">Start timer</button>
    <div class="error-text" id="bk_err" role="alert"></div>`);
  const body = m.body;
  $$('.reason-btn', body).forEach((b) => b.addEventListener('click', () => {
    reason = b.dataset.r;
    $$('.reason-btn', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#bk_pin', body).focus();
  }));
  const go = async () => {
    const err = $('#bk_err', body), btn = $('#bk_go', body);
    err.textContent = '';
    if (!reason) { err.textContent = 'Pick Restroom or Water first.'; return; }
    const pin = $('#bk_pin', body).value.trim();
    if (!/^\d{4}$/.test(pin)) { err.textContent = 'The teacher PIN is 4 digits.'; return; }
    btn.disabled = true;
    try {
      await api('/student/break/start', { method: 'POST', body: { reason, pin } });
      m.close();
      location.hash = '#/timer';
      if (location.hash === '#/timer') window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) {
      err.textContent = e.message; btn.disabled = false;
      $('#bk_pin', body).value = ''; $('#bk_pin', body).focus();
    }
  };
  $('#bk_go', body).addEventListener('click', go);
  $('#bk_pin', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ---------------------------------------------------------------------------------------
// Student: the timer page (stopped by typing the student number)
// ---------------------------------------------------------------------------------------
export async function studentTimer(el) {
  loading(el);
  const d = await api('/student/break');
  if (!d.active) { location.hash = '#/me'; return; }
  const skew = Date.parse(d.server_now) - Date.now(); // use the server's clock, not the laptop's
  const left = Date.parse(d.active.left_at);
  const elapsed = () => (Date.now() + skew - left) / 1000;
  mount(el, h`
    <div class="timer-wrap"><div class="card timer-card">
      <div class="timer-badge">${icon(d.active.reason === 'water' ? 'drop' : 'person', 26)}<span>${REASON[d.active.reason]} break</span></div>
      <div class="timer-label">Time out of class</div>
      <div class="timer-clock" id="tclock" role="timer" aria-live="off">${clock(elapsed())}</div>
      <p class="muted">You left at ${timeOnly(d.active.left_at)}.</p>
      <div class="field mt16"><label for="tnum">When you are back, type your student number</label>
        <input type="text" id="tnum" class="pin-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Student number"></div>
      <button class="btn primary w100" id="tgo" type="button">I’m back – stop the timer</button>
      <div class="error-text" id="terr" role="alert"></div>
    </div></div>`);
  const clk = $('#tclock', el);
  const tick = setInterval(() => { if (!document.body.contains(clk)) { clearInterval(tick); return; } clk.textContent = clock(elapsed()); }, 500);
  const input = $('#tnum', el);
  input.focus();
  const stop = async () => {
    const err = $('#terr', el), btn = $('#tgo', el);
    err.textContent = '';
    if (!input.value.trim()) { err.textContent = 'Type your student number.'; return; }
    btn.disabled = true;
    try {
      const r = await api('/student/break/return', { method: 'POST', body: { student_number: input.value.trim() } });
      clearInterval(tick);
      mount(el, h`<div class="timer-wrap"><div class="card timer-card center">
        <div class="timer-badge ok">${icon('check', 26)}<span>Welcome back!</span></div>
        <div class="timer-label">You were out for</div><div class="timer-clock">${fmtDur(r.last.seconds)}</div>
        <a class="btn primary mt16" href="#/me">Back to my P5</a></div></div>`);
    } catch (e) { err.textContent = e.message; btn.disabled = false; input.value = ''; input.focus(); }
  };
  $('#tgo', el).addEventListener('click', stop);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') stop(); });
}

// ---------------------------------------------------------------------------------------
// Staff: Break Tracker (PIN + out now + report)
// ---------------------------------------------------------------------------------------
export async function breaksStaff(el) {
  loading(el);
  const admin = state.me.user.role === 'admin';
  const f = { from: '', to: '', grade: '', reason: '' };
  let view = 'students';
  let tickId = null;
  const [pin, pins] = await Promise.all([api('/breaks/pin'), admin ? api('/breaks/pins') : Promise.resolve(null)]);
  let data = await api('/breaks/report');
  f.from = data.from; f.to = data.to;

  const drawAll = () => {
    const t = data.totals;
    const avg = t.finished ? t.seconds / t.finished : null;
    mount(el, h`
      <div class="page-head"><div><h1>Break tracker</h1><p class="muted">Restroom and water trips: who left, when, and how long they were out.</p></div></div>

      <div class="card"><h2>${icon('lock', 20)} <span class="ml6">My release PIN</span></h2>
        <p class="muted">Students ask you to type this 4-digit PIN when they leave for the restroom or water. Each teacher needs a different PIN. ${pin.has_pin ? 'Your PIN is set. For safety it is never shown again, but you can change it any time.' : 'You have not set a PIN yet, so students cannot be released by you.'}</p>
        <div class="row">
          <div class="minw140"><label for="mypin">${pin.has_pin ? 'New PIN' : 'Choose a PIN'}</label><input type="password" id="mypin" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••"></div>
          <button class="btn primary self-end" id="savepin" type="button">${pin.has_pin ? 'Change PIN' : 'Save PIN'}</button>
          ${pin.has_pin ? h`<button class="btn danger self-end" id="clearpin" type="button">Remove my PIN</button>` : ''}
        </div><div class="error-text" id="pinerr" role="alert"></div></div>

      ${admin && pins ? h`<div class="card"><h2>${icon('users', 20)} <span class="ml6">Teacher PIN status</span></h2>
        <p class="muted">You can see who has a PIN, but never the PIN itself. Reset one if a teacher forgets it or a student learns it.</p>
        <div class="table-wrap"><table><thead><tr><th>Teacher</th><th>PIN</th><th>Last changed</th><th></th></tr></thead><tbody>
        ${pins.teachers.map((u) => h`<tr><td>${u.name}</td><td>${u.has_pin ? h`<span class="chip ok">Set</span>` : h`<span class="chip gray">Not set</span>`}</td>
          <td class="nowrap">${u.updated_at ? fmtDT(u.updated_at) : ''}</td><td class="right">${u.has_pin ? h`<button class="btn small danger" data-reset="${u.id}" type="button">Reset</button>` : ''}</td></tr>`)}
        </tbody></table></div></div>` : ''}

      ${data.out_now.length ? h`<div class="card out-card"><h2>${icon('timer', 20)} <span class="ml6">Out of class right now (${data.out_now.length})</span></h2>
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th>Reason</th><th>Left</th><th>Out for</th><th>Released by</th><th class="num">Trips</th><th></th></tr></thead><tbody>
        ${data.out_now.map((o) => h`<tr><td>${o.last_name}, ${o.first_name}</td><td>${o.grade}</td><td>${REASON[o.reason]}</td><td class="nowrap">${timeOnly(o.left_at)}</td>
          <td class="nowrap"><strong data-since="${o.left_at}">${fmtDur((Date.now() + skew() - Date.parse(o.left_at)) / 1000)}</strong></td><td>${o.released_by || ''}</td><td class="num">${bandCount(o.trips, data.bands)}</td>
          <td class="right"><button class="btn small" data-back="${o.id}" type="button">Mark back</button></td></tr>`)}
        </tbody></table></div></div>` : ''}

      <div class="card"><h2>Report</h2>
        <div class="form-grid">
          <div><label for="bf">From</label><input type="date" id="bf" value="${f.from}"></div>
          <div><label for="bt">To</label><input type="date" id="bt" value="${f.to}"></div>
          <div><label for="bg">Grade</label><select id="bg"><option value="">All grades</option>${[6, 7, 8].map((g) => h`<option value="${g}" ${String(g) === f.grade ? raw('selected') : ''}>${g}th</option>`)}</select></div>
          <div><label for="br">Reason</label><select id="br"><option value="">Restroom and water</option><option value="restroom" ${f.reason === 'restroom' ? raw('selected') : ''}>Restroom</option><option value="water" ${f.reason === 'water' ? raw('selected') : ''}>Water</option></select></div>
        </div>
        <div class="row"><button class="btn primary" id="runrep" type="button">Update report</button><button class="btn" id="bcsv" type="button">${icon('download', 18)} Download CSV</button></div>
      </div>

      <div class="kpi-grid">
        <div class="kpi"><div class="label">Total breaks</div><div class="big">${t.breaks}</div><div class="sub">${t.students} students</div></div>
        <div class="kpi"><div class="label">Restroom</div><div class="big">${t.restroom}</div><div class="sub">trips</div></div>
        <div class="kpi"><div class="label">Water</div><div class="big">${t.water}</div><div class="sub">trips</div></div>
        <div class="kpi"><div class="label">Average time out</div><div class="big">${avg === null ? '—' : fmtDur(avg)}</div><div class="sub">per finished break</div></div>
      </div>

      <div class="tabs" role="tablist"><button role="tab" data-v="students" aria-selected="${view === 'students'}">By student</button><button role="tab" data-v="log" aria-selected="${view === 'log'}">Every break</button></div>
      <div class="card">${bandLegend(data.bands)}${view === 'students' ? byStudent() : logTable()}</div>`);
    wire();
  };

  const skew = () => Date.parse(data.server_now) - Date.now();
  const byStudent = () => data.students.length ? h`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th class="num">Breaks</th><th class="num">Restroom</th><th class="num">Water</th><th class="num">Total time out</th><th class="num">Average</th><th>Last left</th></tr></thead><tbody>
      ${data.students.map((s) => h`<tr><td>${s.last_name}, ${s.first_name}</td><td>${s.grade}</td><td class="num">${bandCount(s.breaks, data.bands)}</td><td class="num">${s.restroom}</td><td class="num">${s.water}</td>
        <td class="num">${fmtDur(s.seconds)}</td><td class="num">${s.finished ? fmtDur(s.seconds / s.finished) : ''}</td><td class="nowrap">${fmtDT(s.last_left)}</td></tr>`)}</tbody></table></div>`
    : h`<div class="empty"><strong>No breaks in this range</strong>When students leave for the restroom or water, they show up here.</div>`;
  const logTable = () => data.log.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Grade</th><th>Reason</th><th>Left</th><th>Returned</th><th class="num">Time out</th><th>Released by</th></tr></thead><tbody>
      ${data.log.map((x) => h`<tr><td class="nowrap">${fmtDate(x.break_date)}</td><td>${x.last_name}, ${x.first_name}</td><td>${x.grade}</td><td>${REASON[x.reason]}</td>
        <td class="nowrap">${timeOnly(x.left_at)}</td><td class="nowrap">${x.status === 'out' ? h`<span class="chip step">Still out</span>` : timeOnly(x.returned_at)}${x.return_method === 'auto' ? h` <span class="chip gray" title="Nobody marked this student back, so it was closed automatically after 3 hours">auto-closed</span>` : x.return_method === 'staff' ? h` <span class="chip gray">teacher</span>` : ''}</td>
        <td class="num">${x.status === 'out' ? '' : fmtDur(x.seconds)}</td><td>${x.released_by || ''}</td></tr>`)}</tbody></table></div>
      ${data.log.length >= 2000 ? h`<p class="muted small mt8">Showing the newest 2,000 breaks. Narrow the dates to see fewer.</p>` : ''}`
    : h`<div class="empty"><strong>No breaks in this range</strong>When students leave for the restroom or water, they show up here.</div>`;

  const refresh = async () => {
    const qs = new URLSearchParams();
    for (const k of ['from', 'to', 'grade', 'reason']) if (f[k]) qs.set(k, f[k]);
    data = await api('/breaks/report?' + qs);
    drawAll();
  };
  const wire = () => {
    const pinErr = $('#pinerr', el);
    $('#savepin', el).addEventListener('click', async () => {
      pinErr.textContent = '';
      try {
        await api('/breaks/pin', { method: 'PUT', body: { pin: $('#mypin', el).value.trim() } });
        toast('Your release PIN is saved.');
        pin.has_pin = true; pin.updated_at = new Date().toISOString(); drawAll();
      } catch (e) { pinErr.textContent = e.message; }
    });
    const cp = $('#clearpin', el);
    if (cp) cp.addEventListener('click', async () => {
      if (!(await confirmBox('Remove your PIN? Students will not be able to leave with your PIN until you set a new one.', { ok: 'Remove PIN', danger: true }))) return;
      try { await api('/breaks/pin', { method: 'DELETE' }); pin.has_pin = false; drawAll(); toast('PIN removed.'); } catch (e) { fail(e); }
    });
    $$('[data-reset]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('Reset this teacher’s PIN? They will need to choose a new one.', { ok: 'Reset PIN', danger: true }))) return;
      try { await api(`/breaks/pins/${b.dataset.reset}`, { method: 'DELETE' }); const u = pins.teachers.find((x) => String(x.id) === b.dataset.reset); if (u) { u.has_pin = 0; u.updated_at = null; } drawAll(); toast('PIN reset.'); } catch (e) { fail(e); }
    }));
    $$('[data-back]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/breaks/${b.dataset.back}/return`, { method: 'POST', body: {} }); toast('Marked as back.'); refresh(); } catch (e) { fail(e); refresh(); }
    }));
    $$('.tabs [data-v]', el).forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; drawAll(); }));
    $('#runrep', el).addEventListener('click', () => {
      f.from = $('#bf', el).value; f.to = $('#bt', el).value; f.grade = $('#bg', el).value; f.reason = $('#br', el).value;
      refresh().catch(fail);
    });
    $('#bcsv', el).addEventListener('click', () => {
      if (view === 'log') {
        downloadCsv(`breaks-${f.from}-to-${f.to}.csv`, ['Date', 'Student ID', 'Last name', 'First name', 'Grade', 'Reason', 'Left', 'Returned', 'Seconds out', 'Released by', 'Closed by'],
          data.log.map((x) => [x.break_date, x.student_id, x.last_name, x.first_name, x.grade, REASON[x.reason], x.left_at, x.returned_at || '', x.seconds ?? '', x.released_by || '', x.return_method || 'still out']));
      } else {
        downloadCsv(`breaks-by-student-${f.from}-to-${f.to}.csv`, ['Student ID', 'Last name', 'First name', 'Grade', 'Breaks', 'Restroom', 'Water', 'Total seconds out', 'Average seconds', 'Last left'],
          data.students.map((s) => [s.student_id, s.last_name, s.first_name, s.grade, s.breaks, s.restroom, s.water, s.seconds, s.finished ? Math.round(s.seconds / s.finished) : '', s.last_left]));
      }
    });
    // live "out for" timers
    clearInterval(tickId);
    tickId = setInterval(() => {
      const cells = $$('[data-since]', el);
      if (!document.body.contains(el)) { clearInterval(tickId); return; }
      if (!cells.length) return;
      for (const c of cells) c.textContent = fmtDur((Date.now() + skew() - Date.parse(c.dataset.since)) / 1000);
    }, 1000);
  };
  drawAll();
}
