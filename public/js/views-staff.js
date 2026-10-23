import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDate, fmtMD, fmtDT, pct, studentPicker,
  hashQuery, downloadCsv, catChip,
} from './core.js';

const GRADES = [6, 7, 8];
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gl = (g) => `${g}th`;
const chipForStep = (n) => h`<span class="chip step">Step ${n}</span>`;

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);

// ======================================================================================
// Dashboard
// ======================================================================================
export async function dashboard(el) {
  loading(el);
  const r = state.dashRange || { from: '', to: '' };
  const qs = `year=${encodeURIComponent(state.year)}${r.from ? '&from=' + r.from : ''}${r.to ? '&to=' + r.to : ''}`;
  const d = await api('/dashboard?' + qs);
  const first = state.me.user.name.split(' ')[0];
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
  const levels = [1, 2, 3, 4, 5];
  const maxEv = Math.max(1, ...levels.flatMap((l) => GRADES.map((g) => d.steps[l].events_by_grade[g])));
  const gradeTotals = (g) => levels.reduce((n, l) => n + d.steps[l].events_by_grade[g], 0);
  const levelTotal = (l) => GRADES.reduce((n, g) => n + d.steps[l].events_by_grade[g], 0);
  const grandTotal = levels.reduce((n, l) => n + levelTotal(l), 0);

  mount(el, h`
    <h1>Good ${greet}, ${first}! \ud83d\udc4b</h1>
    <p class="muted">${state.me.settings.school_name} \u2022 Behavior Tracker \u2022 ${d.year}</p>

    ${d.banners.map((b) => h`<div class="banner ${b.kind}">${b.text} <a href="${b.link}">${b.link_text} \u2192</a></div>`)}

    <div class="card no-print">
      <div class="row">
        <div><label for="df">From</label><input type="date" id="df" value="${r.from}"></div>
        <div><label for="dt">To</label><input type="date" id="dt" value="${r.to}"></div>
        <div class="row self-end"><button class="btn" id="apply">Apply dates</button><button class="btn" id="reset">Whole year</button></div>
      </div>
      <div class="help">Widgets count each student once per step level. Total events are shown underneath.</div>
    </div>

    <div class="kpi-grid">
      ${levels.map((l) => {
        const s = d.steps[l];
        return h`<div class="kpi">
          <div class="label">Step ${l}</div>
          <div class="big">${s.students}</div>
          <div class="sub">students \u2022 ${s.events} total step${s.events === 1 ? '' : 's'}</div>
          <div class="grade-rows">${GRADES.map((g) => h`<div class="grade-row"><span>${gl(g)}</span><span class="num">${s.by_grade[g]}</span><div class="bar thin"><i data-w="${pct(s.by_grade[g], s.students)}"></i></div></div>`)}</div>
        </div>`;
      })}
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="label">P5 awarded this month</div><div class="big">${d.p5.awarded}</div><div class="sub">points given to students</div></div>
      <div class="kpi"><div class="label">P5 fined this month</div><div class="big">${d.p5.fined}</div><div class="sub">points taken</div></div>
      <div class="kpi"><div class="label">P5 spent this month</div><div class="big">${Math.max(0, d.p5.spent)}</div><div class="sub">in the store and on Rewards Day seats</div></div>
      <div class="kpi"><div class="label">Top P5 this month</div><div class="big">${d.p5.top_category ? d.p5.top_category.emoji : '\u2014'}</div><div class="sub">${d.p5.top_category ? d.p5.top_category.name + ' \u2022 ' + d.p5.top_category.points + ' points' : 'No awards yet'}</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>\ud83d\udcca Steps by grade</h2>
        <div class="chart" role="img" aria-label="Bar chart of steps by grade">
          ${GRADES.map((g) => h`<div class="group"><div class="bars">${levels.map((l) => h`<div class="b s${l}" data-h="${pct(d.steps[l].events_by_grade[g], maxEv)}" title="Step ${l}: ${d.steps[l].events_by_grade[g]}"></div>`)}</div><div class="lab">${gl(g)} grade</div></div>`)}
        </div>
        <div class="legend">${levels.map((l) => h`<span><i class="s${l}"></i>Step ${l}</span>`)}</div>
      </div>
      <div class="card">
        <h2>\ud83e\uddee Totals by grade</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Grade</th>${levels.map((l) => h`<th class="num">Step ${l}</th>`)}<th class="num">Total</th></tr></thead>
          <tbody>
            ${GRADES.map((g) => h`<tr><td>${gl(g)}</td>${levels.map((l) => h`<td class="num">${d.steps[l].events_by_grade[g]}</td>`)}<td class="num"><strong>${gradeTotals(g)}</strong></td></tr>`)}
            <tr class="totals"><td>All</td>${levels.map((l) => h`<td class="num">${levelTotal(l)}</td>`)}<td class="num">${grandTotal}</td></tr>
          </tbody></table></div>
        <div class="help">Step events, not students. Dates: ${r.from || r.to ? (r.from || 'start') + ' to ' + (r.to || 'today') : 'whole school year'}.</div>
      </div>
    </div>

    <div class="card mt16">
      <h2>\ud83c\udf81 Steps by Rewards Period</h2>
      ${d.periods.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Grade</th>${d.periods.map((p) => h`<th class="num" title="${p.start_date} to ${p.end_date}">${p.name.replace('Rewards ', 'R')}</th>`)}</tr></thead>
        <tbody>
          ${GRADES.map((g) => h`<tr><td>${gl(g)}</td>${d.periods.map((p) => h`<td class="num">${p.by_grade[g]}</td>`)}</tr>`)}
          <tr class="totals"><td>Total</td>${d.periods.map((p) => h`<td class="num">${GRADES.reduce((n, g) => n + p.by_grade[g], 0)}</td>`)}</tr>
        </tbody></table></div>
        <div class="help">Counts steps dated from each period\u2019s start date through its end date. A step on a shared boundary date counts in both periods, like the original workbook.</div>`
        : h`<div class="empty"><strong>No reward periods for ${d.year} yet</strong>An Admin can add them under Admin \u2192 Reward periods.</div>`}
    </div>

    ${d.next_day ? h`<div class="card"><h2>\ud83c\udf9f\ufe0f Next Rewards Day: ${d.next_day.name}</h2>
      <p class="muted">${fmtDate(d.next_day.reward_date)} \u2022 ${d.next_day.status === 'open' ? 'Booking is open' : 'Booking not open yet'}</p>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Qualifiers booked</div><div class="big">${d.next_day.qualifiers_booked}</div><div class="sub">of ${d.next_day.qualifiers}</div></div>
        <div class="kpi"><div class="label">Non-qualifiers</div><div class="big">${d.next_day.nonqualifiers}</div><div class="sub">${d.next_day.nonqualifiers_assigned} assigned to rooms</div></div>
      </div></div>` : ''}

    <div class="card no-print"><h2><span class="emoji">\u26a1</span>Quick Actions</h2>
      <div class="pills">
        <a class="pill-btn primary" href="#/record">Record a step</a>
        <a class="pill-btn" href="#/p5">Award P5</a>
        <a class="pill-btn" href="#/reward-report">Reward Day report</a>
        <a class="pill-btn" href="#/rewards">Rewards Day</a>
      </div></div>`);

  $('#apply', el).addEventListener('click', () => { state.dashRange = { from: $('#df', el).value, to: $('#dt', el).value }; dashboard(el).catch(fail); });
  $('#reset', el).addEventListener('click', () => { state.dashRange = { from: '', to: '' }; dashboard(el).catch(fail); });
}

// ======================================================================================
// Record steps
// ======================================================================================
const canEditStep = (s) => state.me.user.role === 'admin' || (s.created_by === state.me.user.email && Date.now() - Date.parse(s.created_at) < 7 * 864e5);
const PERIODS = ['', '1', '2', '3', '4', '5', '6', '7'];

export async function record(el) {
  const me = state.me;
  const q = hashQuery();
  mount(el, h`
    <div class="page-head"><div><h1>Record steps</h1><p class="muted">Pick a student, choose the step, and save.</p></div></div>
    <div class="card">
      <div class="field"><label>Student</label><div id="picker"></div></div>
      <div id="context"></div>
      <div class="field"><label>Step level</label>
        <div class="step-btns" id="stepbtns">${[1, 2, 3, 4, 5].map((n) => h`<button type="button" class="step-btn s${n}" data-step="${n}" aria-pressed="false">Step ${n}</button>`)}</div></div>
      <div class="form-grid">
        <div><label for="sd">Date</label><input type="date" id="sd" value="${me.today}"></div>
        <div><label for="st">Teacher</label><input type="text" id="st" value="${me.user.name}" maxlength="80"></div>
        <div><label for="sp">Period (optional)</label><select id="sp">${PERIODS.map((p) => h`<option value="${p}">${p || 'None'}</option>`)}</select></div>
        <div><label for="sn">Notes (optional)</label><input type="text" id="sn" maxlength="300" placeholder="What happened?"></div>
      </div>
      <div class="row"><button class="btn primary" id="save">Save step</button><span class="error-text" id="err" role="alert"></span></div>
    </div>
    <div class="card">
      <h2>Recent entries</h2>
      <div class="form-grid no-print">
        <div><label for="fg">Grade</label><select id="fg"><option value="">All</option>${GRADES.map((g) => h`<option value="${g}">${gl(g)}</option>`)}</select></div>
        <div><label for="ft">Teacher</label><input type="text" id="ft" placeholder="Exact name"></div>
        <div><label for="ff">From</label><input type="date" id="ff"></div>
        <div><label for="fto">To</label><input type="date" id="fto"></div>
      </div>
      <div class="row no-print mb10"><button class="btn small" id="filter">Filter</button>
        ${me.user.role === 'admin' ? h`<span class="muted small">Bulk add from a spreadsheet: Admin \u2192 Import steps.</span>` : ''}</div>
      <div id="recent"></div>
    </div>`);

  let level = null;
  const err = $('#err', el);
  $$('#stepbtns button', el).forEach((b) => b.addEventListener('click', () => {
    level = Number(b.dataset.step);
    $$('#stepbtns button', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  const ctx = $('#context', el);
  const picker = studentPicker($('#picker', el), {
    onChange: async (list) => {
      if (!list.length) { mount(ctx, h``); return; }
      try {
        const d = await api('/students/' + list[0].student_id);
        const thisYear = d.steps.filter((s) => s.school_year === state.year);
        const per = me.current_period;
        const hot = per ? d.steps.filter((s) => s.step_date >= per.start_date && s.step_date <= per.end_date && s.step_level >= me.settings.nonqual_min_step) : [];
        mount(ctx, h`
          ${hot.length ? h`<div class="banner warn">This student already has a Step ${Math.max(...hot.map((s) => s.step_level))} in ${per.name}.</div>` : ''}
          <div class="field"><label>Steps this year (${thisYear.length})</label>
            <div class="chips">${thisYear.length ? thisYear.slice(0, 20).map((s) => h`<span class="chip step">Step ${s.step_level} \u2022 ${fmtMD(s.step_date)}</span>`) : h`<span class="muted small">No steps yet this year.</span>`}</div></div>`);
      } catch (e) { fail(e); }
    },
  });
  if (q.student) {
    try { const d = await api('/students/' + Number(q.student)); picker.add(d.student); } catch { /* ignore */ }
  }

  $('#save', el).addEventListener('click', async () => {
    err.textContent = '';
    const s = picker.get()[0];
    if (!s) { err.textContent = 'Choose a student.'; return; }
    if (!level) { err.textContent = 'Choose a step level.'; return; }
    const body = {
      student_id: s.student_id, step_level: level, step_date: $('#sd', el).value, teacher: $('#st', el).value,
      period: $('#sp', el).value || null, notes: $('#sn', el).value || null,
    };
    const btn = $('#save', el);
    btn.disabled = true;
    try {
      try {
        await api('/steps', { method: 'POST', body });
      } catch (e) {
        if (e.status === 409 && e.data && e.data.duplicate) {
          if (!(await confirmBox(`${s.first_name} already has Step ${level} on this date. Save another one anyway?`, { ok: 'Save anyway' }))) { btn.disabled = false; return; }
          await api('/steps', { method: 'POST', body: { ...body, force: true } });
        } else throw e;
      }
      toast(`Step ${level} saved for ${s.first_name} ${s.last_name}.`);
      picker.clear(); level = null;
      $$('#stepbtns button', el).forEach((x) => x.setAttribute('aria-pressed', 'false'));
      $('#sn', el).value = '';
      picker.focus();
      loadRecent();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  });

  async function loadRecent() {
    const p = new URLSearchParams();
    for (const [id, k] of [['fg', 'grade'], ['ft', 'teacher'], ['ff', 'from'], ['fto', 'to']]) { const v = $('#' + id, el).value.trim(); if (v) p.set(k, v); }
    try {
      const { steps } = await api('/steps/recent?' + p);
      mount($('#recent', el), steps.length ? h`<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Student</th><th>Gr</th><th>Step</th><th>Teacher</th><th>Per</th><th>Notes</th><th class="no-print"></th></tr></thead><tbody>
        ${steps.map((s) => h`<tr><td class="nowrap">${fmtMD(s.step_date)}</td><td>${s.last_name}, ${s.first_name}</td><td>${s.grade}</td>
          <td>${chipForStep(s.step_level)} ${s.source === 'p5_fine' ? h`<span class="chip gray" title="Created by a P5 fine">P5 fine</span>` : ''}</td>
          <td>${s.teacher || ''}</td><td>${s.period || ''}</td><td>${s.notes || ''}</td>
          <td class="no-print nowrap">${canEditStep(s) ? h`<button class="btn small" data-edit="${s.id}">Edit</button> <button class="btn small danger" data-del="${s.id}">Delete</button>` : ''}</td></tr>`)}
        </tbody></table></div>` : h`<div class="empty"><strong>No steps yet</strong>Steps you record will show up here.</div>`);
      $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => editStep(steps.find((s) => String(s.id) === b.dataset.edit))));
      $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
        const s = steps.find((x) => String(x.id) === b.dataset.del);
        const extra = s.source === 'p5_fine' ? ' This step came from a P5 fine. The fine stays in place unless you reverse it on the P5 page.' : '';
        if (!(await confirmBox(`Delete Step ${s.step_level} for ${s.first_name} ${s.last_name} on ${fmtMD(s.step_date)}?${extra}`, { ok: 'Delete step', danger: true }))) return;
        try { await api('/steps/' + s.id, { method: 'DELETE' }); toast('Step deleted.'); loadRecent(); } catch (e) { fail(e); }
      }));
    } catch (e) { fail(e); }
  }
  $('#filter', el).addEventListener('click', loadRecent);

  function editStep(s) {
    const m = modal(`Edit step: ${s.first_name} ${s.last_name}`, h`
      <div class="form-grid">
        <div><label for="e_l">Step level</label><select id="e_l">${[1, 2, 3, 4, 5].map((n) => h`<option value="${n}" ${n === s.step_level ? raw('selected') : ''}>Step ${n}</option>`)}</select></div>
        <div><label for="e_d">Date</label><input type="date" id="e_d" value="${s.step_date}"></div>
        <div><label for="e_t">Teacher</label><input type="text" id="e_t" value="${s.teacher || ''}" maxlength="80"></div>
        <div><label for="e_p">Period</label><select id="e_p">${PERIODS.map((p) => h`<option value="${p}" ${p === (s.period || '') ? raw('selected') : ''}>${p || 'None'}</option>`)}</select></div>
      </div>
      <div class="field"><label for="e_n">Notes</label><input type="text" id="e_n" value="${s.notes || ''}" maxlength="300"></div>
      <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save changes</button></div><div class="error-text" id="e_err"></div>`);
    $('[data-x]', m.el).addEventListener('click', m.close);
    $('[data-s]', m.el).addEventListener('click', async () => {
      try {
        await api('/steps/' + s.id, { method: 'PATCH', body: { step_level: Number($('#e_l', m.el).value), step_date: $('#e_d', m.el).value, teacher: $('#e_t', m.el).value, period: $('#e_p', m.el).value || null, notes: $('#e_n', m.el).value || null } });
        m.close(); toast('Step updated.'); loadRecent();
      } catch (e) { $('#e_err', m.el).textContent = e.message; }
    });
  }
  loadRecent();
}

// ======================================================================================
// Grade tabs
// ======================================================================================
export async function grade(el, g) {
  loading(el);
  const d = await api(`/grade/${g}?year=${encodeURIComponent(state.year)}`);
  let sortKey = 'last_name', dir = 1, query = '', onlySteps = false;
  const cols = [['student_id', 'Student ID'], ['last_name', 'Last name'], ['first_name', 'First name'], ['s1', 'Step 1'], ['s2', 'Step 2'], ['s3', 'Step 3'], ['s4', 'Step 4'], ['s5', 'Step 5'], ['total', 'Total'], ['balance', 'P5']];
  mount(el, h`
    <div class="page-head"><div><h1>${gl(g)} grade</h1><p class="muted">${d.students.length} students \u2022 ${d.year}</p></div>
      <div class="actions no-print"><button class="btn" id="csv">Download CSV</button><button class="btn" id="print">Print</button></div></div>
    <div class="card">
      <div class="row no-print mb12">
        <div class="grow-200"><label for="gs" class="hidden">Search</label><input type="search" id="gs" placeholder="Search name or ID"></div>
        <label class="check"><input type="checkbox" id="only"> Only students with steps</label>
      </div>
      <div class="table-wrap" id="tbl"></div>
    </div>`);
  const paint = () => {
    let rows = d.students.filter((s) => (!onlySteps || s.total > 0) &&
      (!query || `${s.student_id} ${s.first_name} ${s.last_name}`.toLowerCase().includes(query)));
    rows = rows.slice().sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir || a.last_name.localeCompare(b.last_name);
    });
    mount($('#tbl', el), rows.length ? h`<table>
      <thead><tr>${cols.map(([k, label]) => h`<th class="sortable ${typeof d.students[0]?.[k] === 'number' && k !== 'student_id' ? 'num' : ''}" data-k="${k}" aria-sort="${sortKey === k ? (dir === 1 ? 'ascending' : 'descending') : 'none'}">${label}${sortKey === k ? (dir === 1 ? ' \u25b2' : ' \u25bc') : ''}</th>`)}</tr>
      <tr class="totals"><td></td><td colspan="2">All ${gl(g)} graders</td>${['s1', 's2', 's3', 's4', 's5', 'total'].map((k) => h`<td class="num">${d.totals[k]}</td>`)}<td></td></tr></thead>
      <tbody>${rows.map((s) => h`<tr class="clickable" tabindex="0" data-id="${s.student_id}"><td>${s.student_id}</td><td>${s.last_name}</td><td>${s.first_name}</td>
        ${['s1', 's2'].map((k) => h`<td class="num">${s[k]}</td>`)}${['s3', 's4', 's5'].map((k) => (s[k] ? h`<td class="num hot">${s[k]}</td>` : h`<td class="num">0</td>`))}
        <td class="num"><strong>${s.total}</strong></td><td class="num">${s.balance}</td></tr>`)}</tbody></table>`
      : h`<div class="empty"><strong>No students to show</strong>${d.students.length ? 'Try clearing the search or filter.' : 'An Admin can import the roster under Admin \u2192 Roster.'}</div>`);
    $$('th.sortable', el).forEach((th) => th.addEventListener('click', () => { if (sortKey === th.dataset.k) dir = -dir; else { sortKey = th.dataset.k; dir = 1; } paint(); }));
    $$('tr.clickable', el).forEach((tr) => {
      const open = () => studentPanel(Number(tr.dataset.id));
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  };
  paint();
  $('#gs', el).addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); paint(); });
  $('#only', el).addEventListener('change', (e) => { onlySteps = e.target.checked; paint(); });
  $('#print', el).addEventListener('click', () => window.print());
  $('#csv', el).addEventListener('click', () => downloadCsv(`grade-${g}-${d.year}.csv`,
    ['Student ID', 'Last name', 'First name', 'Grade', 'Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Total', 'P5 balance'],
    d.students.map((s) => [s.student_id, s.last_name, s.first_name, g, s.s1, s.s2, s.s3, s.s4, s.s5, s.total, s.balance])));
}

async function studentPanel(id) {
  try {
    const d = await api('/students/' + id);
    const s = d.student;
    const m = modal(`${s.first_name} ${s.last_name}`, h`
      <p class="muted">ID ${s.student_id} \u2022 Grade ${s.grade}${s.homeroom_teacher ? ' \u2022 ' + s.homeroom_teacher : ''}${s.room ? ' \u2022 Room ' + s.room : ''}</p>
      <div class="row mb14"><span class="chip ok">P5 balance: ${d.balance}</span>
        <a class="btn small" href="#/record?student=${s.student_id}">Record a step</a> <a class="btn small" href="#/p5?student=${s.student_id}">Award or fine P5</a></div>
      <h3>Step history (${d.steps.length})</h3>
      ${d.steps.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Step</th><th>Teacher</th><th>Per</th><th>${state.me.settings.code_label}</th><th>Notes</th></tr></thead><tbody>
        ${d.steps.map((x) => h`<tr><td class="nowrap">${fmtDate(x.step_date)}</td><td>${chipForStep(x.step_level)}</td><td>${x.teacher || ''}</td><td>${x.period || ''}</td><td>${x.code || ''}</td><td>${x.notes || ''}</td></tr>`)}</tbody></table></div>`
        : h`<p class="muted">No steps on record.</p>`}
      <h3 class="mt18">P5 ledger</h3>
      ${d.ledger.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>For</th><th class="num">Points</th><th>Note</th></tr></thead><tbody>
        ${d.ledger.map((x) => h`<tr><td class="nowrap">${fmtMD(x.tx_date)}</td><td>${x.category ? x.category : x.type}</td><td class="num ${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${x.amount}</td><td>${x.note || ''}${x.reversed_by ? ' (reversed)' : ''}</td></tr>`)}</tbody></table></div>`
        : h`<p class="muted">No P5 activity yet.</p>`}`, { wide: true });
    $$('a', m.el).forEach((a) => a.addEventListener('click', m.close));
  } catch (e) { fail(e); }
}

// ======================================================================================
// Monthly report
// ======================================================================================
export async function monthly(el) {
  const f = state.monthlyFilter || (state.monthlyFilter = { grade: '', step: '', metric: 'events' });
  loading(el);
  const qs = `year=${encodeURIComponent(state.year)}&metric=${f.metric}${f.grade ? '&grade=' + f.grade : ''}${f.step ? '&step=' + f.step : ''}`;
  const d = await api('/reports/monthly?' + qs);
  const vals = d.years.flatMap((y) => d.months.map((m) => d.data[y][m] || 0));
  const max = Math.max(1, ...vals);
  const any = d.years.some((y) => d.has_data[y]);
  const cur = d.years[2], prev = d.years[1];
  mount(el, h`
    <div class="page-head"><div><h1>Monthly report</h1><p class="muted">${f.metric === 'events' ? 'Total steps' : 'Students with steps'} by month, last three school years</p></div>
      <div class="actions no-print"><button class="btn" id="csv">Download CSV</button><button class="btn" id="print">Print</button></div></div>
    <div class="card no-print"><div class="form-grid">
      <div><label for="mg">Grade</label><select id="mg"><option value="">All grades</option>${GRADES.map((g) => h`<option value="${g}" ${String(g) === String(f.grade) ? raw('selected') : ''}>${gl(g)}</option>`)}</select></div>
      <div><label for="ms">Step level</label><select id="ms"><option value="">All steps</option>${[1, 2, 3, 4, 5].map((n) => h`<option value="${n}" ${String(n) === String(f.step) ? raw('selected') : ''}>Step ${n}</option>`)}</select></div>
      <div><label for="mm">Count</label><select id="mm"><option value="events" ${f.metric === 'events' ? raw('selected') : ''}>Total steps</option><option value="students" ${f.metric === 'students' ? raw('selected') : ''}>Unique students</option></select></div>
    </div></div>
    ${!any ? h`<div class="card"><div class="empty"><strong>Nothing to compare yet</strong>Import prior years in Admin \u2192 Import steps to see comparisons.</div></div>` : ''}
    <div class="card">
      <div class="chart" role="img" aria-label="Grouped bar chart of steps per month for three school years">
        ${d.months.map((m) => h`<div class="group"><div class="bars">${d.years.map((y, i) => h`<div class="b y${i}" data-h="${pct(d.data[y][m] || 0, max)}" title="${y}: ${d.data[y][m] ?? '\u2014'}"></div>`)}</div><div class="lab">${MONTH_NAMES[m]}</div></div>`)}
      </div>
      <div class="legend">${d.years.map((y, i) => h`<span><i class="l${i}"></i>${y}${i === 2 ? ' (selected)' : ''}</span>`)}</div>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Month</th>${d.years.map((y) => h`<th class="num">${y}</th>`)}<th class="num">${cur} vs ${prev}</th></tr></thead><tbody>
      ${d.months.map((m) => {
        const c = d.data[cur][m], p = d.data[prev][m];
        const diff = c === null ? null : c - p;
        return h`<tr><td>${MONTH_NAMES[m]}</td>${d.years.map((y) => h`<td class="num">${d.data[y][m] ?? '\u2014'}</td>`)}<td class="num ${diff > 0 ? 'neg' : diff < 0 ? 'pos' : ''}">${diff === null ? '\u2014' : (diff > 0 ? '+' : '') + diff}</td></tr>`;
      })}
      <tr class="totals"><td>School year total</td>${d.years.map((y) => h`<td class="num">${d.months.reduce((n, m) => n + (d.data[y][m] || 0), 0)}</td>`)}<td></td></tr>
      </tbody></table></div>
      <div class="help">August through June. Months that haven\u2019t happened yet this year show \u2014. Grade is each student\u2019s current grade. For the difference column, fewer steps than last year shows in green.</div></div>`);
  const upd = () => { state.monthlyFilter = { grade: $('#mg', el).value, step: $('#ms', el).value, metric: $('#mm', el).value }; monthly(el).catch(fail); };
  ['#mg', '#ms', '#mm'].forEach((s) => $(s, el).addEventListener('change', upd));
  $('#print', el).addEventListener('click', () => window.print());
  $('#csv', el).addEventListener('click', () => downloadCsv('monthly-steps.csv', ['Month', ...d.years],
    d.months.map((m) => [MONTH_NAMES[m], ...d.years.map((y) => d.data[y][m] ?? '')])));
}

// ======================================================================================
// Reward Day report (non-qualifier list)
// ======================================================================================
export async function rewardReport(el) {
  loading(el);
  const { periods } = await api('/reward-periods');
  const cur = state.me.current_period;
  const defPeriod = cur ? cur.id : (periods.find((p) => p.school_year === state.year) || periods[0] || {}).id;
  const sel = state.rewardSel || (state.rewardSel = { period: defPeriod ? String(defPeriod) : '', custom: false, start: '', end: '' });
  mount(el, h`
    <div class="page-head"><div><h1>Reward Day report</h1><p class="muted">Students who do not qualify for Rewards Day</p></div>
      <div class="actions no-print"><button class="btn" id="csv" disabled>Download CSV</button><button class="btn" id="print" disabled>Print</button></div></div>
    <div class="card no-print">
      <div class="form-grid">
        <div ${sel.custom ? raw('class="hidden"') : ''}><label for="rp">Reward period</label>
          <select id="rp">${periods.length ? periods.map((p) => h`<option value="${p.id}" ${String(p.id) === sel.period ? raw('selected') : ''}>${p.name} (${p.school_year}) \u2022 ${fmtMD(p.start_date)}\u2013${fmtMD(p.end_date)}</option>`) : h`<option value="">No periods yet</option>`}</select></div>
        <div ${sel.custom ? '' : raw('class="hidden"')}><label for="rs">Start date</label><input type="date" id="rs" value="${sel.start}"></div>
        <div ${sel.custom ? '' : raw('class="hidden"')}><label for="re">End date</label><input type="date" id="re" value="${sel.end}"></div>
        <div class="self-end"><label class="check"><input type="checkbox" id="cust" ${sel.custom ? raw('checked') : ''}> Use custom dates</label></div>
      </div>
      <button class="btn primary" id="run">Show report</button>
    </div>
    <div id="out"></div>`);
  let last = null;
  async function run() {
    sel.custom = $('#cust', el).checked;
    sel.period = $('#rp', el).value; sel.start = $('#rs', el).value; sel.end = $('#re', el).value;
    const qs = sel.custom ? `start=${sel.start}&end=${sel.end}` : `period_id=${sel.period}`;
    if (!sel.custom && !sel.period) return;
    try {
      const d = await api('/reports/reward-day?' + qs);
      last = d;
      $('#csv', el).disabled = false; $('#print', el).disabled = false;
      const rule = `Any Step ${d.rule.min_step} or higher, or ${d.rule.step1_count} or more Step 1s`;
      mount($('#out', el), h`
        <div class="card"><h2>${d.period ? d.period.name : 'Custom dates'}: ${fmtDate(d.start)} \u2013 ${fmtDate(d.end)}</h2>
          ${d.reward_day ? h`<p class="muted">Rewards Day: ${d.reward_day.name} on ${fmtDate(d.reward_day.reward_date)}</p>` : ''}
          <p class="muted">${rule}.</p>
          <div class="chips"><span class="chip gray">6th: ${d.counts[6]}</span><span class="chip gray">7th: ${d.counts[7]}</span><span class="chip gray">8th: ${d.counts[8]}</span><span class="chip step">Total: ${d.counts.total}</span></div></div>
        ${GRADES.map((g, i) => h`<div class="card ${i ? 'page-break' : ''}"><h2>${gl(g)} grade \u2022 ${d.counts[g]} student${d.counts[g] === 1 ? '' : 's'}</h2>
          ${d.grades[g].length ? h`<div class="table-wrap"><table><thead><tr><th>#</th><th>Last name</th><th>First name</th><th>Homeroom teacher</th><th>Room</th><th>Why</th><th class="num">Highest</th><th class="num">Steps</th><th>Assigned room</th></tr></thead><tbody>
            ${d.grades[g].map((s, n) => h`<tr><td>${n + 1}</td><td>${s.last_name}</td><td>${s.first_name}</td><td>${s.homeroom_teacher || ''}</td><td>${s.room || ''}</td><td>${s.why}</td><td class="num">${s.highest_step}</td><td class="num">${s.step_count}</td><td>${s.assigned_room || ''}</td></tr>`)}</tbody></table></div>`
            : h`<div class="empty"><strong>No non-qualifiers</strong>Every ${gl(g)} grader qualifies for this period.</div>`}</div>`)}`);
    } catch (e) { fail(e); }
  }
  $('#run', el).addEventListener('click', run);
  $('#cust', el).addEventListener('change', () => { sel.custom = $('#cust', el).checked; sel.period = $('#rp', el).value; sel.start = $('#rs', el).value; sel.end = $('#re', el).value; reportToggle(); });
  function reportToggle() { rewardReport(el).catch(fail); }
  $('#print', el).addEventListener('click', () => window.print());
  $('#csv', el).addEventListener('click', () => {
    if (!last) return;
    downloadCsv(`reward-day-nonqualifiers-${last.start}.csv`, ['Grade', 'Last name', 'First name', 'Homeroom teacher', 'Room', 'Why', 'Highest step', 'Steps', 'Assigned room'],
      GRADES.flatMap((g) => last.grades[g].map((s) => [g, s.last_name, s.first_name, s.homeroom_teacher, s.room, s.why, s.highest_step, s.step_count, s.assigned_room])));
  });
  if (sel.custom ? sel.start && sel.end : sel.period) run();
}
