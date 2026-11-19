// Charger / computer log, class jobs, and the student-leader orders tab.
import { state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDT, fmtDate, downloadCsv } from './core.js';
import { icon } from './icons.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading…</div>`);
const ITEM = { charger: 'Charger', computer: 'Computer' };
const timeOnly = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

// ---------------------------------------------------------------------------------------
// Student: borrow a charger or computer
// ---------------------------------------------------------------------------------------
function checkoutModal(done) {
  let item = null;
  const m = modal('Borrow a charger or computer', h`
    <p class="muted">Choose what you need, then ask your teacher to type their 4-digit PIN to approve it.</p>
    <div class="reason-btns" role="group" aria-label="What do you need?">
      <button type="button" class="reason-btn" data-i="charger" aria-pressed="false">${icon('plug', 34)}<span>Charger</span></button>
      <button type="button" class="reason-btn" data-i="computer" aria-pressed="false">${icon('laptop', 34)}<span>Computer</span></button>
    </div>
    <div class="field mt16"><label for="eq_pin">Teacher PIN</label>
      <input type="password" id="eq_pin" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••"></div>
    <button class="btn primary w100" id="eq_go" type="button">Check it out</button>
    <div class="error-text" id="eq_err" role="alert"></div>`);
  const body = m.body;
  $$('.reason-btn', body).forEach((b) => b.addEventListener('click', () => {
    item = b.dataset.i;
    $$('.reason-btn', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#eq_pin', body).focus();
  }));
  const go = async () => {
    const err = $('#eq_err', body), btn = $('#eq_go', body);
    err.textContent = '';
    if (!item) { err.textContent = 'Pick Charger or Computer first.'; return; }
    const pin = $('#eq_pin', body).value.trim();
    if (!/^\d{4}$/.test(pin)) { err.textContent = 'The teacher PIN is 4 digits.'; return; }
    btn.disabled = true;
    try {
      const r = await api('/student/equipment/checkout', { method: 'POST', body: { item, pin } });
      m.close();
      toast(`${ITEM[item]} approved by ${r.approved_by}. Remember to return it!`);
      done();
    } catch (e) { err.textContent = e.message; btn.disabled = false; $('#eq_pin', body).value = ''; $('#eq_pin', body).focus(); }
  };
  $('#eq_go', body).addEventListener('click', go);
  $('#eq_pin', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

export async function studentEquipment(el) {
  loading(el);
  const d = await api('/student/equipment');
  const hasAll = ['charger', 'computer'].every((k) => d.out.some((o) => o.item === k));
  mount(el, h`
    <div class="page-head"><div><h1>${icon('plug', 28)} <span class="ml6">Chargers &amp; computers</span></h1><p class="muted">Borrow a charger or computer from a teacher, and return it when you are done.</p></div>
      <div class="actions"><button class="btn primary" id="eq_new" type="button" ${hasAll ? raw('disabled') : ''}>${icon('plug', 18)} Borrow something</button></div></div>
    ${d.out.length ? h`<div class="card out-card"><h2>You have these checked out</h2>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Since</th><th></th></tr></thead><tbody>
      ${d.out.map((o) => h`<tr><td><strong>${ITEM[o.item]}</strong></td><td class="nowrap">${fmtDT(o.checked_out_at)}</td>
        <td class="right"><button class="btn small primary" data-ret="${o.item}" type="button">I returned it</button></td></tr>`)}</tbody></table></div></div>` : ''}
    <div class="card"><h2>Your history</h2>
      ${d.history.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Approved by</th><th>Returned</th></tr></thead><tbody>
        ${d.history.map((x) => h`<tr><td class="nowrap">${fmtDate(x.log_date)}</td><td>${ITEM[x.item]}</td><td>${x.teacher || ''}</td>
          <td>${x.status === 'out' ? h`<span class="chip step">Still out</span>` : timeOnly(x.returned_at)}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>Nothing borrowed yet</strong>When you borrow a charger or computer, it is recorded here.</div>`}</div>`);
  $('#eq_new', el).addEventListener('click', () => checkoutModal(() => studentEquipment(el).catch(fail)));
  $$('[data-ret]', el).forEach((b) => b.addEventListener('click', () => {
    const m = modal(`Return the ${ITEM[b.dataset.ret].toLowerCase()}`, h`
      <p class="muted">Type your student number to show it is back.</p>
      <div class="field"><label for="rt_n">Student number</label><input type="text" id="rt_n" inputmode="numeric" autocomplete="off"></div>
      <button class="btn primary w100" id="rt_go" type="button">Return</button><div class="error-text" id="rt_err" role="alert"></div>`);
    const go = async () => {
      try {
        await api('/student/equipment/return', { method: 'POST', body: { item: b.dataset.ret, student_number: $('#rt_n', m.body).value.trim() } });
        m.close(); toast('Thanks for returning it!'); studentEquipment(el).catch(fail);
      } catch (e) { $('#rt_err', m.body).textContent = e.message; }
    };
    $('#rt_go', m.body).addEventListener('click', go);
    $('#rt_n', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#rt_n', m.body).focus();
  }));
}

// ---------------------------------------------------------------------------------------
// Staff: Charger & computer log
// ---------------------------------------------------------------------------------------
export async function equipmentStaff(el) {
  loading(el);
  const f = { from: '', to: '', grade: '', item: '' };
  let view = 'students';
  let data = await api('/equipment/report');
  f.from = data.from; f.to = data.to;
  const draw = () => {
    const t = data.totals;
    mount(el, h`
      <div class="page-head"><div><h1>Charger &amp; computer log</h1><p class="muted">Every time a student borrowed a charger or computer, and which teacher approved it. Students use the same 4-digit PIN you set on the Break Tracker page.</p></div></div>
      ${data.out_now.length ? h`<div class="card out-card"><h2>${icon('laptop', 20)} <span class="ml6">Still checked out (${data.out_now.length})</span></h2>
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th>Item</th><th>Since</th><th>Approved by</th><th></th></tr></thead><tbody>
        ${data.out_now.map((o) => h`<tr><td>${o.last_name}, ${o.first_name}</td><td>${o.grade}</td><td>${ITEM[o.item]}</td><td class="nowrap">${fmtDT(o.checked_out_at)}</td><td>${o.released_by || ''}</td>
          <td class="right"><button class="btn small" data-back="${o.id}" type="button">Mark returned</button></td></tr>`)}</tbody></table></div></div>` : ''}
      <div class="card"><h2>Report</h2>
        <div class="form-grid">
          <div><label for="ef">From</label><input type="date" id="ef" value="${f.from}"></div>
          <div><label for="et">To</label><input type="date" id="et" value="${f.to}"></div>
          <div><label for="eg">Grade</label><select id="eg"><option value="">All grades</option>${[6, 7, 8].map((g) => h`<option value="${g}" ${String(g) === f.grade ? raw('selected') : ''}>${g}th</option>`)}</select></div>
          <div><label for="ei">Item</label><select id="ei"><option value="">Chargers and computers</option><option value="charger" ${f.item === 'charger' ? raw('selected') : ''}>Chargers</option><option value="computer" ${f.item === 'computer' ? raw('selected') : ''}>Computers</option></select></div>
        </div>
        <div class="row"><button class="btn primary" id="erun" type="button">Update report</button><button class="btn" id="ecsv" type="button">${icon('download', 18)} Download CSV</button></div></div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Total check-outs</div><div class="big">${t.total}</div><div class="sub">${t.students} students</div></div>
        <div class="kpi"><div class="label">Chargers</div><div class="big">${t.chargers}</div></div>
        <div class="kpi"><div class="label">Computers</div><div class="big">${t.computers}</div></div>
      </div>
      <div class="tabs" role="tablist"><button role="tab" data-v="students" aria-selected="${view === 'students'}">By student</button><button role="tab" data-v="log" aria-selected="${view === 'log'}">Every check-out</button></div>
      <div class="card">${view === 'students' ? byStudent() : logTable()}</div>`);
    wire();
  };
  const empty = h`<div class="empty"><strong>Nothing in this range</strong>When students borrow a charger or computer, it shows up here.</div>`;
  const byStudent = () => data.students.length ? h`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th class="num">Total</th><th class="num">Chargers</th><th class="num">Computers</th><th>Last borrowed</th></tr></thead><tbody>
    ${data.students.map((s) => h`<tr><td>${s.last_name}, ${s.first_name}</td><td>${s.grade}</td><td class="num"><strong>${s.total}</strong></td><td class="num">${s.chargers}</td><td class="num">${s.computers}</td><td class="nowrap">${fmtDT(s.last_at)}</td></tr>`)}</tbody></table></div>` : empty;
  const logTable = () => data.log.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Grade</th><th>Item</th><th>Time out</th><th>Returned</th><th>Approved by</th></tr></thead><tbody>
    ${data.log.map((x) => h`<tr><td class="nowrap">${fmtDate(x.log_date)}</td><td>${x.last_name}, ${x.first_name}</td><td>${x.grade}</td><td>${ITEM[x.item]}</td><td class="nowrap">${timeOnly(x.checked_out_at)}</td>
      <td class="nowrap">${x.status === 'out' ? h`<span class="chip step">Still out</span>` : fmtDT(x.returned_at)}${x.return_method === 'staff' ? h` <span class="chip gray">teacher</span>` : ''}</td><td>${x.released_by || ''}</td></tr>`)}</tbody></table></div>
    ${data.log.length >= 2000 ? h`<p class="muted small mt8">Showing the newest 2,000. Narrow the dates to see fewer.</p>` : ''}` : empty;
  const refresh = async () => {
    const qs = new URLSearchParams();
    for (const k of ['from', 'to', 'grade', 'item']) if (f[k]) qs.set(k, f[k]);
    data = await api('/equipment/report?' + qs); draw();
  };
  const wire = () => {
    $$('[data-back]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/equipment/${b.dataset.back}/return`, { method: 'POST', body: {} }); toast('Marked as returned.'); refresh(); } catch (e) { fail(e); refresh(); }
    }));
    $$('.tabs [data-v]', el).forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; draw(); }));
    $('#erun', el).addEventListener('click', () => {
      f.from = $('#ef', el).value; f.to = $('#et', el).value; f.grade = $('#eg', el).value; f.item = $('#ei', el).value;
      refresh().catch(fail);
    });
    $('#ecsv', el).addEventListener('click', () => {
      downloadCsv(`equipment-${f.from}-to-${f.to}.csv`, ['Date', 'Student ID', 'Last name', 'First name', 'Grade', 'Item', 'Checked out', 'Returned', 'Approved by', 'Returned by'],
        data.log.map((x) => [x.log_date, x.student_id, x.last_name, x.first_name, x.grade, ITEM[x.item], x.checked_out_at, x.returned_at || '', x.released_by || '', x.return_method || 'still out']));
    });
  };
  draw();
}

// ---------------------------------------------------------------------------------------
// Student: jobs in a class
// ---------------------------------------------------------------------------------------
export async function studentJobs(el, classId) {
  loading(el);
  const d = await api(`/student/classes/${classId}/jobs`);
  mount(el, h`
    <div class="page-head"><div><h1>${icon('briefcase', 28)} <span class="ml6">Class jobs</span></h1><p class="muted">${d.class.name}${d.class.period ? ' · Period ' + d.class.period : ''} · ${d.class.teacher}. Jobs pay P5 tickets every Friday.</p></div>
      <div class="actions"><a class="btn" href="#/classes">← My classes</a></div></div>
    ${d.jobs.length ? h`<div class="job-grid">${d.jobs.map((j) => {
      const m = j.mine;
      const full = j.filled >= j.slots;
      return h`<div class="card job-card"><h3>${j.title}</h3><p class="muted">${j.description || ''}</p>
        <p><span class="chip ok">${j.salary} P5 per week</span> <span class="chip gray">${j.filled}/${j.slots} filled</span></p>
        ${m && m.status === 'hired' ? h`<p><span class="chip ok">You have this job!</span></p>`
          : m && m.status === 'pending' ? h`<p><span class="chip step">Application sent</span></p><button class="btn small danger" data-wd="${m.id}" type="button">Withdraw</button>`
          : d.has_job ? h`<p class="muted small">You already have a job in this class.</p>`
          : full ? h`<p class="muted small">All openings are filled.</p>`
          : h`<button class="btn primary" data-apply="${j.id}" type="button">Apply</button>`}</div>`;
    })}</div>` : h`<div class="card"><div class="empty"><strong>No jobs posted yet</strong>Your teacher has not added any class jobs. Check back later.</div></div>`}`);
  $$('[data-apply]', el).forEach((b) => b.addEventListener('click', () => {
    const j = d.jobs.find((x) => String(x.id) === b.dataset.apply);
    const m = modal(`Apply: ${j.title}`, h`
      <p class="muted">${j.description || ''} Pays ${j.salary} P5 a week.</p>
      <div class="field"><label for="ap_msg">Why would you be good at this job?</label>
        <textarea id="ap_msg" rows="5" maxlength="600" placeholder="Tell your teacher what makes you a good fit."></textarea></div>
      <button class="btn primary w100" id="ap_go" type="button">Send application</button><div class="error-text" id="ap_err" role="alert"></div>`);
    $('#ap_go', m.body).addEventListener('click', async () => {
      try {
        await api(`/student/classes/${classId}/jobs/${j.id}/apply`, { method: 'POST', body: { message: $('#ap_msg', m.body).value } });
        m.close(); toast('Application sent!'); studentJobs(el, classId).catch(fail);
      } catch (e) { $('#ap_err', m.body).textContent = e.message; }
    });
    $('#ap_msg', m.body).focus();
  }));
  $$('[data-wd]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Withdraw this application?', { ok: 'Withdraw', danger: true }))) return;
    try { await api('/student/applications/' + b.dataset.wd, { method: 'DELETE' }); toast('Application withdrawn.'); studentJobs(el, classId).catch(fail); } catch (e) { fail(e); }
  }));
}

// ---------------------------------------------------------------------------------------
// Teacher: Jobs tab inside a class
// ---------------------------------------------------------------------------------------
export async function jobsTab(box, d, reload) {
  const classId = d.class.id;
  loading(box);
  const data = await api(`/classes/${classId}/jobs`);
  const active = data.jobs.filter((j) => j.active);
  const total = active.reduce((a, j) => a + j.hired.length * j.salary, 0);
  mount(box, h`
    <div class="card"><h2>${icon('briefcase', 20)} <span class="ml6">Class jobs</span></h2>
      <p class="muted">Students in this class can apply for the jobs you post here. Hired students are paid their job's salary in P5 tickets automatically every Friday (or the last school day of that week if Friday is a day off). ${active.length ? `This class's weekly payroll is ${total} P5.` : ''}</p>
      <div class="row"><button class="btn primary" id="jb_add" type="button">Add a job</button></div></div>
    ${active.length ? active.map((j) => h`<div class="card" data-job="${j.id}">
      <div class="row between"><div><h3>${j.title} <span class="chip ok">${j.salary} P5 / week</span> <span class="chip gray">${j.hired.length}/${j.slots} filled</span></h3><p class="muted">${j.description || ''}</p></div>
        <div class="row"><button class="btn small" data-edit="${j.id}" type="button">Edit</button><button class="btn small danger" data-del="${j.id}" type="button">Remove</button></div></div>
      ${j.hired.length ? h`<h4>Hired</h4><div class="table-wrap"><table><thead><tr><th>Student</th><th>Since</th><th>Application</th><th></th></tr></thead><tbody>
        ${j.hired.map((a) => h`<tr><td><strong>${a.last_name}, ${a.first_name}</strong></td><td class="nowrap">${a.hired_on ? fmtDate(a.hired_on) : ''}</td><td class="muted small">${a.message}</td>
          <td class="right"><button class="btn small danger" data-end="${a.id}" type="button">End job</button></td></tr>`)}</tbody></table></div>` : ''}
      ${j.pending.length ? h`<h4>Applications (${j.pending.length})</h4><div class="table-wrap"><table><thead><tr><th>Student</th><th>Why they would be good</th><th></th></tr></thead><tbody>
        ${j.pending.map((a) => h`<tr><td class="nowrap"><strong>${a.last_name}, ${a.first_name}</strong>${a.has_job ? h`<div><span class="chip gray">already has a job</span></div>` : ''}</td><td>${a.message}</td>
          <td class="right nowrap"><button class="btn small primary" data-hire="${a.id}" type="button" ${a.has_job || j.hired.length >= j.slots ? raw('disabled') : ''}>Hire</button> <button class="btn small" data-no="${a.id}" type="button">Decline</button></td></tr>`)}</tbody></table></div>`
        : h`<p class="muted small">No applications waiting.</p>`}</div>`)
      : h`<div class="card"><div class="empty"><strong>No jobs yet</strong>Add a job and students in this class can apply for it.</div></div>`}`);

  const act = async (path, msg) => { try { await api(path, { method: 'POST', body: {} }); toast(msg); reload(); } catch (e) { fail(e); } };
  $$('[data-hire]', box).forEach((b) => b.addEventListener('click', () => act(`/classes/${classId}/applications/${b.dataset.hire}/hire`, 'Hired!')));
  $$('[data-no]', box).forEach((b) => b.addEventListener('click', () => act(`/classes/${classId}/applications/${b.dataset.no}/decline`, 'Application declined.')));
  $$('[data-end]', box).forEach((b) => b.addEventListener('click', async () => {
    if (await confirmBox('End this student’s job? They will not be paid after this. Pay already given stays.', { ok: 'End job', danger: true })) act(`/classes/${classId}/applications/${b.dataset.end}/end`, 'Job ended.');
  }));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    if (await confirmBox('Remove this job? Everyone in it stops being paid and waiting applications are declined.', { ok: 'Remove job', danger: true })) {
      try { await api(`/classes/${classId}/jobs/${b.dataset.del}`, { method: 'DELETE' }); toast('Job removed.'); reload(); } catch (e) { fail(e); }
    }
  }));
  const form = (job) => {
    const isNew = !job;
    job = job || { title: '', description: '', salary: 5, slots: 1 };
    const m = modal(isNew ? 'Add a class job' : 'Edit job', h`
      ${isNew ? h`<div class="field"><label for="jb_pre">Start from a preset</label><select id="jb_pre"><option value="">Choose…</option>${data.presets.map((p, i) => h`<option value="${i}">${p.title} (${p.salary} P5)</option>`)}</select></div>` : ''}
      <div class="form-grid">
        <div><label for="jb_t">Job title</label><input type="text" id="jb_t" maxlength="60" value="${job.title}"></div>
        <div><label for="jb_s">Weekly salary (P5)</label><input type="number" id="jb_s" min="1" max="100" value="${job.salary}"></div>
        <div><label for="jb_n">Openings</label><input type="number" id="jb_n" min="1" max="10" value="${job.slots}"></div>
      </div>
      <div class="field"><label for="jb_d">What does the job involve?</label><textarea id="jb_d" rows="3" maxlength="300">${job.description || ''}</textarea></div>
      <div class="row end mt14"><button class="btn" data-x type="button">Cancel</button><button class="btn primary" data-s type="button">Save</button></div><div class="error-text" id="jb_err" role="alert"></div>`);
    const pre = $('#jb_pre', m.body);
    if (pre) pre.addEventListener('change', () => {
      const p = data.presets[Number(pre.value)];
      if (p) { $('#jb_t', m.body).value = p.title; $('#jb_s', m.body).value = p.salary; $('#jb_d', m.body).value = p.description; }
    });
    $('[data-x]', m.body).addEventListener('click', m.close);
    $('[data-s]', m.body).addEventListener('click', async () => {
      const body = { title: $('#jb_t', m.body).value, salary: Number($('#jb_s', m.body).value), slots: Number($('#jb_n', m.body).value), description: $('#jb_d', m.body).value };
      try {
        await api(isNew ? `/classes/${classId}/jobs` : `/classes/${classId}/jobs/${job.id}`, { method: isNew ? 'POST' : 'PATCH', body });
        m.close(); toast('Saved.'); reload();
      } catch (e) { $('#jb_err', m.body).textContent = e.message; }
    });
  };
  $('#jb_add', box).addEventListener('click', () => form(null));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => form(active.find((j) => String(j.id) === b.dataset.edit))));
}

// ---------------------------------------------------------------------------------------
// Student leaders: store orders
// ---------------------------------------------------------------------------------------
export const leaderTabs = (current) => h`<nav class="tabs tab-links no-print" aria-label="Bank page">
  <a href="#/me" ${current === 'me' ? raw('aria-current="page"') : ''}>My bank</a>
  <a href="#/leader" ${current === 'leader' ? raw('aria-current="page"') : ''}>Store orders</a></nav>`;

export async function studentLeader(el) {
  loading(el);
  let status = state.leaderStatus || 'pending';
  const draw = async () => {
    const { orders } = await api('/student/leader/orders?status=' + status);
    mount(el, h`
      ${leaderTabs('leader')}
      <div class="page-head"><div><h1>${icon('box', 28)} <span class="ml6">Store orders</span></h1><p class="muted">You are a student leader. Hand out each order, then press <strong>Mark handed out</strong>. You cannot hand out your own order.</p></div></div>
      <div class="tabs" role="tablist"><button role="tab" data-s="pending" aria-selected="${status === 'pending'}">Waiting</button><button role="tab" data-s="fulfilled" aria-selected="${status === 'fulfilled'}">Handed out</button></div>
      <div class="card">${orders.length ? h`<div class="table-wrap"><table><thead><tr><th>Student</th><th>Grade</th><th>Homeroom</th><th>Item</th><th>Ordered</th><th></th></tr></thead><tbody>
        ${orders.map((o) => h`<tr><td><strong>${o.last_name}, ${o.first_name}</strong></td><td>${o.grade}</td><td>${o.homeroom_teacher || ''}${o.room ? ' · ' + o.room : ''}</td><td>${o.emoji || ''} ${o.item}</td><td class="nowrap">${fmtDT(o.created_at)}</td>
          <td class="right">${status === 'pending' ? (o.mine ? h`<span class="muted small">Your order</span>` : h`<button class="btn small primary" data-f="${o.id}" type="button">Mark handed out</button>`) : h`<span class="muted small">${o.fulfilled_by || ''}</span>`}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>${status === 'pending' ? 'No orders waiting' : 'Nothing handed out yet'}</strong>${status === 'pending' ? 'New store orders appear here.' : ''}</div>`}</div>`);
    $$('.tabs [data-s]', el).forEach((b) => b.addEventListener('click', () => { status = b.dataset.s; state.leaderStatus = status; draw().catch(fail); }));
    $$('[data-f]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/student/leader/orders/${b.dataset.f}/fulfill`, { method: 'POST', body: {} }); toast('Marked as handed out.'); draw().catch(fail); } catch (e) { fail(e); draw().catch(fail); }
    }));
  };
  await draw();
}
