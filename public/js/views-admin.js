import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDate, fmtDT, parseCsv, normDate, downloadCsv,
} from './core.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);
const TABS = [['roster', 'Roster and PINs'], ['import', 'Import steps'], ['periods', 'Reward periods'], ['settings', 'Settings'], ['users', 'Staff users'], ['audit', 'Audit and export']];

export async function admin(el) {
  const tab = state.adminTab || 'roster';
  mount(el, h`<div class="page-head"><div><h1>\u2699\ufe0f Admin</h1><p class="muted">Roster, imports, reward dates, settings, and staff accounts</p></div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => h`<button role="tab" data-t="${k}" aria-selected="${tab === k}">${l}</button>`)}</div>
    <div id="body"><div class="spinner">Loading\u2026</div></div>`);
  $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { state.adminTab = b.dataset.t; admin(el).catch(fail); }));
  const body = $('#body', el);
  await ({ roster, import: importSteps, periods, settings, users, audit }[tab])(body, () => admin(el).catch(fail));
}

// Excel exports dates as serial numbers in some cases.
function toIso(v) {
  const s = String(v ?? '').trim();
  if (/^\d{5}$/.test(s) && Number(s) > 30000 && Number(s) < 70000) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  return normDate(s);
}
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function readFileText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Couldn\u2019t read that file.')); r.readAsText(file); }); }

// ======================================================================================
// Roster and PINs
// ======================================================================================
async function roster(body, again) {
  const info = await api('/admin/students');
  const total = info.counts.reduce((n, c) => n + c.n, 0);
  const withPin = info.counts.reduce((n, c) => n + (c.with_pin || 0), 0);
  mount(body, h`
    <div class="kpi-grid">
      ${[6, 7, 8].map((g) => { const c = info.counts.find((x) => x.grade === g) || { n: 0, with_pin: 0 }; return h`<div class="kpi"><div class="label">${g}th grade</div><div class="big">${c.n}</div><div class="sub">${c.with_pin || 0} have a PIN</div></div>`; })}
    </div>

    <div class="card"><h2>Import the roster</h2>
      <p class="muted">A CSV with the columns <strong>Student ID, Last Name, First Name, GD</strong> (grade 6\u20138). Optional: <strong>Homeroom Teacher, Room</strong> (needed for the Reward Day report). In Excel, use File \u2192 Save As \u2192 CSV. Re-importing updates existing students and never deletes steps or points.</p>
      <div class="field"><label for="rf">CSV file</label><input type="file" id="rf" accept=".csv,.txt,text/csv"></div>
      <label class="check mb12"><input type="checkbox" id="deact"> Make students who are <em>not</em> in this file inactive (use for a new school year)</label>
      <div id="rprev"></div></div>

    <div class="card"><h2>Student PINs</h2>
      <p class="muted">Students sign in with their Student ID and a 6-digit PIN. A PIN is shown <strong>only once</strong>, right after you generate it, so print the sheet before you leave the page. Generating a new PIN signs that student out everywhere.</p>
      <div class="row"><button class="btn primary" id="pinmiss" ${total ? '' : raw('disabled')}>Generate PINs for students without one (${total - withPin})</button>
        <button class="btn danger" id="pinall" ${total ? '' : raw('disabled')}>Reset every student\u2019s PIN</button></div></div>

    <div class="card"><h2>Find a student</h2>
      <div class="row"><div class="grow-200"><label for="fs" class="hidden">Search</label><input type="search" id="fs" placeholder="Search name or ID"></div>
        <label class="check"><input type="checkbox" id="inact"> Show inactive</label></div>
      <div class="mt12" id="flist"></div></div>`);

  // --- roster import
  $('#rf', body).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const rows = parseCsv(await readFileText(f));
      if (!rows.length) throw new Error('That file is empty.');
      const hdr = rows[0].map(key);
      const hasHeader = !/^\d+$/.test(String(rows[0][0]).trim());
      const find = (...names) => hdr.findIndex((x) => names.includes(x));
      const idx = hasHeader
        ? { id: find('studentid', 'id', 'studentnumber'), last: find('lastname', 'last'), first: find('firstname', 'first'), grade: find('gd', 'grade', 'gradelevel'), hr: find('homeroomteacher', 'homeroom', 'teacher'), room: find('room', 'roomnumber') }
        : { id: 0, last: 1, first: 2, grade: 3, hr: 4, room: 5 };
      if (idx.id < 0 || idx.last < 0 || idx.first < 0 || idx.grade < 0) throw new Error('Couldn\u2019t find the columns Student ID, Last Name, First Name, and GD (grade) in the first row.');
      const data = rows.slice(hasHeader ? 1 : 0).map((r) => ({
        student_id: r[idx.id], last_name: r[idx.last], first_name: r[idx.first], grade: r[idx.grade],
        homeroom_teacher: idx.hr >= 0 ? r[idx.hr] : null, room: idx.room >= 0 ? r[idx.room] : null,
      }));
      const prev = await api('/admin/students/import', { method: 'POST', body: { rows: data, dry_run: true } });
      mount($('#rprev', body), h`<div class="banner ${prev.error_count ? 'danger' : 'info'}">
        <strong>${prev.total} rows read.</strong> ${prev.new_students} new, ${prev.updated} existing students will be updated, ${prev.duplicates_skipped} repeated ID${prev.duplicates_skipped === 1 ? '' : 's'} skipped${prev.error_count ? `, ${prev.error_count} row${prev.error_count === 1 ? '' : 's'} with problems` : ''}.</div>
        ${prev.errors.length ? h`<ul>${prev.errors.map((x) => h`<li>Row ${x.row}: ${x.message}</li>`)}</ul>` : ''}
        <button class="btn primary" id="rgo" ${prev.error_count ? raw('disabled') : ''}>Import roster</button>`);
      const go = $('#rgo', body);
      if (go) go.addEventListener('click', async () => {
        if ($('#deact', body).checked && !(await confirmBox('Students who are not in this file will be made inactive. Their history is kept. Continue?', { ok: 'Import and deactivate', danger: true }))) return;
        go.disabled = true;
        try {
          const r = await api('/admin/students/import', { method: 'POST', body: { rows: data, deactivate_missing: $('#deact', body).checked } });
          toast(`Imported ${r.imported} students${r.deactivated ? `, ${r.deactivated} made inactive` : ''}.`);
          again();
        } catch (er) { fail(er); go.disabled = false; }
      });
    } catch (er) { fail(er); }
  });

  // --- PIN generation
  async function genPins(scope) {
    const all = [];
    let after = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await api('/admin/pins', { method: 'POST', body: { scope, after } });
        all.push(...r.pins);
        after = r.next_after;
        if (r.done) break;
      }
    } catch (e) { fail(e); }
    if (!all.length) { toast('Everyone already has a PIN.'); return; }
    state.pinSheet = all; // held in memory only; never stored
    location.hash = '#/pin-sheet';
  }
  $('#pinmiss', body).addEventListener('click', () => genPins('missing'));
  $('#pinall', body).addEventListener('click', async () => {
    if (await confirmBox('Reset the PIN of EVERY student? Everyone is signed out and old PINs stop working.', { ok: 'Reset all PINs', danger: true })) genPins('all');
  });

  // --- student finder
  let t = null;
  async function find() {
    const q = $('#fs', body).value.trim();
    const inactive = $('#inact', body).checked;
    try {
      const { students } = await api(`/admin/students?q=${encodeURIComponent(q)}${inactive ? '&inactive=1' : ''}`);
      mount($('#flist', body), students.length ? h`<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Gr</th><th>Homeroom</th><th>PIN</th><th></th></tr></thead><tbody>
        ${students.map((s) => h`<tr><td>${s.student_id}</td><td>${s.last_name}, ${s.first_name} ${s.active ? '' : h`<span class="chip gray">inactive</span>`}</td><td>${s.grade}</td><td>${s.homeroom_teacher || ''}</td>
          <td>${s.has_pin ? h`<span class="chip ok">set</span>` : h`<span class="chip gray">none</span>`}</td>
          <td class="nowrap"><button class="btn small" data-pin="${s.student_id}">New PIN</button> <button class="btn small" data-edit="${s.student_id}">Edit</button></td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>No students found</strong>${q ? 'Try a different search.' : 'Import the roster above to get started.'}</div>`);
      $$('[data-pin]', body).forEach((b) => b.addEventListener('click', async () => {
        try {
          const r = await api(`/admin/students/${b.dataset.pin}/pin`, { method: 'POST', body: {} });
          const m = modal('New PIN', h`<p><strong>${r.student.first_name} ${r.student.last_name}</strong> (ID ${r.student.student_id})</p>
            <p class="balance-hero"><span class="big">${r.pin}</span></p><p class="muted">Write this down now. It won\u2019t be shown again. The student was signed out everywhere.</p><div class="row end"><button class="btn primary" data-ok>Done</button></div>`);
          $('[data-ok]', m.el).addEventListener('click', () => { m.close(); find(); });
        } catch (e) { fail(e); }
      }));
      $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => editStudent(students.find((s) => String(s.student_id) === b.dataset.edit), find)));
    } catch (e) { fail(e); }
  }
  $('#fs', body).addEventListener('input', () => { clearTimeout(t); t = setTimeout(find, 220); });
  $('#inact', body).addEventListener('change', find);
  find();
}

function editStudent(s, done) {
  const m = modal(`Edit ${s.first_name} ${s.last_name}`, h`
    <div class="form-grid">
      <div><label for="s_l">Last name</label><input type="text" id="s_l" value="${s.last_name}" maxlength="60"></div>
      <div><label for="s_f">First name</label><input type="text" id="s_f" value="${s.first_name}" maxlength="60"></div>
      <div><label for="s_g">Grade</label><select id="s_g">${[6, 7, 8].map((g) => h`<option value="${g}" ${g === s.grade ? raw('selected') : ''}>${g}</option>`)}</select></div>
      <div><label for="s_h">Homeroom teacher</label><input type="text" id="s_h" value="${s.homeroom_teacher || ''}" maxlength="80"></div>
      <div><label for="s_r">Room</label><input type="text" id="s_r" value="${s.room || ''}" maxlength="20"></div>
    </div>
    <label class="check"><input type="checkbox" id="s_a" ${s.active ? raw('checked') : ''}> Active (shows in lists and can sign in)</label>
    <div class="row end mt14"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div><div class="error-text" id="s_err"></div>`);
  $('[data-x]', m.el).addEventListener('click', m.close);
  $('[data-s]', m.el).addEventListener('click', async () => {
    const v = (x) => $(x, m.el).value;
    try {
      await api('/admin/students/' + s.student_id, { method: 'PATCH', body: { last_name: v('#s_l'), first_name: v('#s_f'), grade: Number(v('#s_g')), homeroom_teacher: v('#s_h') || null, room: v('#s_r') || null, active: $('#s_a', m.el).checked } });
      m.close(); toast('Student updated.'); done();
    } catch (e) { $('#s_err', m.el).textContent = e.message; }
  });
}

// ======================================================================================
// Import steps (workbook "Paste" layout or a simple layout)
// ======================================================================================
async function importSteps(body) {
  mount(body, h`
    <div class="card"><h2>Import steps</h2>
      <p class="muted">Use this to load this year\u2019s workbook and to add earlier school years for the monthly comparison. Importing the same file twice is safe: repeats are skipped.</p>
      <div class="form-grid">
        <div><label for="lay">File layout</label><select id="lay">
          <option value="wide">Workbook \u201cPaste\u201d sheet (one row per student, up to five steps)</option>
          <option value="long">Simple list (student_id, step_level, date, teacher, period, notes, code, grade)</option></select></div>
        <div><label for="yr">Only accept dates from school year (optional)</label><input type="text" id="yr" placeholder="2024-25" maxlength="7"></div>
      </div>
      <div class="help" id="layhelp"></div>
      <div class="field mt12"><label for="sf">CSV file</label><input type="file" id="sf" accept=".csv,.txt,text/csv"></div>
      <label class="check mb12"><input type="checkbox" id="cm" checked> If a student isn\u2019t on the roster (for example, someone who left), add them as an inactive \u201cFormer student\u201d so their steps still count in the monthly report (needs a grade in the file)</label>
      <div id="sprev"></div></div>`);
  const help = () => {
    $('#layhelp', body).textContent = $('#lay', body).value === 'wide'
      ? 'Columns by position, no header needed: A = Student ID, E = grade, G = teacher, then Step 1 in H\u2013J, Step 2 in K\u2013M, Step 3 in N\u2013P, Step 4 in Q\u2013S, Step 5 in T\u2013V (flag, date, code). Any step with a date is imported.'
      : 'First row must be a header. Dates can be 3/17/2026 or 2026-03-17.';
  };
  $('#lay', body).addEventListener('change', help); help();

  $('#sf', body).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const rows = parseCsv(await readFileText(f));
      let steps = [], warn = 0;
      if ($('#lay', body).value === 'wide') {
        const start = /^\d+$/.test(String(rows[0] && rows[0][0]).trim()) ? 0 : 1;
        for (const r of rows.slice(start)) {
          [[7, 8, 9], [10, 11, 12], [13, 14, 15], [16, 17, 18], [19, 20, 21]].forEach(([fl, dt, cd], i) => {
            const date = toIso(r[dt]);
            if (!date) return;
            if (String(r[fl] || '').trim() !== '1') warn++;
            steps.push({ student_id: r[0], grade: r[4], step_level: i + 1, step_date: date, teacher: r[6], code: r[cd] || null });
          });
        }
      } else {
        const hdr = rows[0].map(key);
        const ix = (...n) => hdr.findIndex((x) => n.includes(x));
        const c = { id: ix('studentid', 'id'), lvl: ix('steplevel', 'step', 'level'), dt: ix('date', 'stepdate'), t: ix('teacher'), p: ix('period'), n: ix('notes'), cd: ix('code'), g: ix('grade', 'gd') };
        if (c.id < 0 || c.lvl < 0 || c.dt < 0) throw new Error('The first row needs the headings student_id, step_level, and date.');
        steps = rows.slice(1).map((r) => ({ student_id: r[c.id], step_level: String(r[c.lvl]).replace(/\D/g, ''), step_date: toIso(r[c.dt]) || r[c.dt], teacher: c.t >= 0 ? r[c.t] : null, period: c.p >= 0 ? r[c.p] : null, notes: c.n >= 0 ? r[c.n] : null, code: c.cd >= 0 ? r[c.cd] : null, grade: c.g >= 0 ? r[c.g] : null }));
      }
      if (!steps.length) throw new Error('No steps were found in that file. Check the layout setting.');
      const opts = { school_year: $('#yr', body).value.trim() || undefined, create_missing: $('#cm', body).checked };
      const prev = await api('/admin/steps/import', { method: 'POST', body: { rows: steps, dry_run: true, ...opts } });
      mount($('#sprev', body), h`
        <div class="banner ${prev.error_count || prev.unmatched_count ? 'warn' : 'info'}"><strong>${prev.total} steps found.</strong> ${prev.importable} ready to import, ${prev.duplicates_skipped} already in the system (skipped)${prev.placeholder_students ? `, ${prev.placeholder_students} former student${prev.placeholder_students === 1 ? '' : 's'} will be added` : ''}.</div>
        ${warn ? h`<div class="banner info">${warn} step${warn === 1 ? ' has' : 's have'} a date but a blank \u201c1\u201d flag. They\u2019re imported as steps. Check the file if that\u2019s not what you want.</div>` : ''}
        ${prev.unmatched_count ? h`<div class="banner warn"><strong>${prev.unmatched_count} student ID${prev.unmatched_count === 1 ? '' : 's'} not on the roster</strong> and left out: ${prev.unmatched_ids.join(', ')}${prev.unmatched_count > 50 ? '\u2026' : ''}. Import the roster first, or tick the \u201cformer student\u201d box and include a grade.</div>` : ''}
        ${prev.errors.length ? h`<div class="banner danger"><strong>${prev.error_count} row${prev.error_count === 1 ? '' : 's'} with problems (left out):</strong><ul>${prev.errors.map((x) => h`<li>Row ${x.row}: ${x.message}</li>`)}</ul></div>` : ''}
        <button class="btn primary" id="sgo" ${prev.importable || prev.placeholder_students ? '' : raw('disabled')}>Import ${prev.importable} steps</button><div id="prog" class="muted mt8"></div>`);
      const go = $('#sgo', body);
      go.addEventListener('click', async () => {
        go.disabled = true;
        let done = 0;
        try {
          for (let i = 0; i < steps.length; i += 400) {
            const r = await api('/admin/steps/import', { method: 'POST', body: { rows: steps.slice(i, i + 400), ...opts } });
            done += r.imported;
            $('#prog', body).textContent = `Imported ${done} so far\u2026`;
          }
          toast(`Imported ${done} steps.`);
          $('#prog', body).textContent = `Done. ${done} steps imported.`;
        } catch (er) { fail(er); go.disabled = false; }
      });
    } catch (er) { fail(er); }
  });
}

// ======================================================================================
// Reward periods
// ======================================================================================
async function periods(body, again) {
  const { periods: list } = await api('/reward-periods');
  const years = [...new Set(list.map((p) => p.school_year))];
  mount(body, h`<div class="card"><div class="row end mb10"><button class="btn primary" id="np">Add reward period</button></div>
    ${list.length ? years.map((y) => h`<h3 class="mt14">${y}</h3><div class="table-wrap"><table><thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th></th></tr></thead><tbody>
      ${list.filter((p) => p.school_year === y).map((p) => h`<tr><td>${p.name}</td><td>${fmtDate(p.start_date)}</td><td>${fmtDate(p.end_date)}</td><td class="nowrap"><button class="btn small" data-e="${p.id}">Edit</button> <button class="btn small danger" data-d="${p.id}">Delete</button></td></tr>`)}</tbody></table></div>`)
      : h`<div class="empty"><strong>No reward periods yet</strong>Add the dates for this school year.</div>`}
    <div class="help">Both dates are included. A step dated on the end date counts in that period. The school year is worked out from the start date.</div></div>`);
  const form = (p) => {
    const m = modal(p ? 'Edit reward period' : 'Add reward period', h`<div class="form-grid">
      <div><label for="p_n">Name</label><input type="text" id="p_n" value="${p ? p.name : ''}" maxlength="40" placeholder="Rewards 1"></div>
      <div><label for="p_s">Starts</label><input type="date" id="p_s" value="${p ? p.start_date : ''}"></div>
      <div><label for="p_e">Ends</label><input type="date" id="p_e" value="${p ? p.end_date : ''}"></div></div>
      <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div><div class="error-text" id="p_err"></div>`);
    $('[data-x]', m.el).addEventListener('click', m.close);
    $('[data-s]', m.el).addEventListener('click', async () => {
      const v = (x) => $(x, m.el).value;
      try { await api(p ? '/reward-periods/' + p.id : '/reward-periods', { method: p ? 'PATCH' : 'POST', body: { name: v('#p_n'), start_date: v('#p_s'), end_date: v('#p_e') } }); m.close(); toast('Saved.'); again(); }
      catch (e) { $('#p_err', m.el).textContent = e.message; }
    });
  };
  $('#np', body).addEventListener('click', () => form(null));
  $$('[data-e]', body).forEach((b) => b.addEventListener('click', () => form(list.find((p) => String(p.id) === b.dataset.e))));
  $$('[data-d]', body).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Delete this reward period?', { ok: 'Delete', danger: true }))) return;
    try { await api('/reward-periods/' + b.dataset.d, { method: 'DELETE' }); toast('Deleted.'); again(); } catch (e) { fail(e); }
  }));
}

// ======================================================================================
// Settings
// ======================================================================================
async function settings(body, again) {
  const { settings: s } = await api('/admin/settings');
  mount(body, h`<div class="card"><h2>Settings</h2>
    <div class="form-grid">
      <div><label for="t_n">School name</label><input type="text" id="t_n" value="${s.school_name}" maxlength="80"></div>
      <div><label for="t_c">Label for the extra \u201cCode\u201d on steps</label><input type="text" id="t_c" value="${s.code_label}" maxlength="30"></div>
      <div><label for="t_m">Teacher maximum P5 per entry</label><input type="number" id="t_m" min="1" max="1000" value="${s.teacher_max_p5}"></div>
    </div>
    <h3 class="mt6">Who does not qualify for Rewards Day</h3>
    <div class="form-grid">
      <div><label for="t_s">Any step at or above</label><select id="t_s">${[1, 2, 3, 4, 5].map((n) => h`<option value="${n}" ${n === s.nonqual_min_step ? raw('selected') : ''}>Step ${n}</option>`)}</select></div>
      <div><label for="t_o">Or this many Step 1s</label><input type="number" id="t_o" min="2" max="20" value="${s.nonqual_step1_count}"></div>
    </div>
    <label class="check"><input type="checkbox" id="t_neg" ${s.allow_negative_balance ? raw('checked') : ''}> A fine may take a student\u2019s P5 balance below zero</label>
    <div class="help">If this is off, a fine takes only as many points as the student has.</div>
    <div class="row mt14"><button class="btn primary" id="tsave">Save settings</button></div><div class="error-text" id="t_err"></div></div>`);
  $('#tsave', body).addEventListener('click', async () => {
    const v = (x) => $(x, body).value;
    try {
      await api('/admin/settings', { method: 'PUT', body: { school_name: v('#t_n'), code_label: v('#t_c'), teacher_max_p5: Number(v('#t_m')), nonqual_min_step: Number(v('#t_s')), nonqual_step1_count: Number(v('#t_o')), allow_negative_balance: $('#t_neg', body).checked } });
      toast('Settings saved. Reload the page to see the new school name.');
    } catch (e) { $('#t_err', body).textContent = e.message; }
  });
}

// ======================================================================================
// Staff users
// ======================================================================================
async function users(body, again) {
  const { users: list } = await api('/admin/users');
  mount(body, h`<div class="card"><div class="row end mb10"><button class="btn primary" id="nu">Add staff account</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((u) => h`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td><td><span class="chip ${u.active ? 'ok' : 'gray'}">${u.active ? 'Active' : 'Inactive'}</span></td><td><button class="btn small" data-e="${u.id}">Edit</button></td></tr>`)}</tbody></table></div>
    <div class="help">Teachers can record steps, award and fine P5, run the store, and manage their own Rewards Day activities. Admins can also change settings, import data, and manage accounts. Passwords need at least 12 characters.</div></div>`);
  const form = (u) => {
    const m = modal(u ? 'Edit staff account' : 'Add staff account', h`<div class="form-grid">
      <div><label for="u_n">Name</label><input type="text" id="u_n" value="${u ? u.name : ''}" maxlength="80"></div>
      <div><label for="u_e">Email</label><input type="email" id="u_e" value="${u ? u.email : ''}" ${u ? raw('disabled') : ''} maxlength="120"></div>
      <div><label for="u_r">Role</label><select id="u_r"><option value="teacher" ${u && u.role === 'teacher' ? raw('selected') : ''}>Teacher</option><option value="admin" ${u && u.role === 'admin' ? raw('selected') : ''}>Admin</option></select></div>
      <div><label for="u_p">${u ? 'New password (leave blank to keep)' : 'Password'}</label><input type="password" id="u_p" autocomplete="new-password" minlength="12"></div></div>
      ${u ? h`<label class="check"><input type="checkbox" id="u_a" ${u.active ? raw('checked') : ''}> Active</label>` : ''}
      <div class="row end mt14"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div><div class="error-text" id="u_err"></div>`);
    $('[data-x]', m.el).addEventListener('click', m.close);
    $('[data-s]', m.el).addEventListener('click', async () => {
      const v = (x) => $(x, m.el).value;
      const payload = { name: v('#u_n'), role: v('#u_r') };
      if (v('#u_p')) payload.password = v('#u_p');
      try {
        if (u) { payload.active = $('#u_a', m.el).checked; await api('/admin/users/' + u.id, { method: 'PATCH', body: payload }); }
        else { payload.email = v('#u_e'); await api('/admin/users', { method: 'POST', body: payload }); }
        m.close(); toast('Saved.'); again();
      } catch (e) { $('#u_err', m.el).textContent = e.message; }
    });
  };
  $('#nu', body).addEventListener('click', () => form(null));
  $$('[data-e]', body).forEach((b) => b.addEventListener('click', () => form(list.find((u) => String(u.id) === b.dataset.e))));
}

// ======================================================================================
// Audit log and export
// ======================================================================================
async function audit(body) {
  const { entries } = await api('/admin/audit?limit=200');
  mount(body, h`
    <div class="card"><h2>Download a backup</h2><p class="muted">Each file is a CSV you can open in Excel or Sheets. PIN codes and passwords are never included. Downloads are recorded in the audit log below.</p>
      <div class="pills">${['students', 'steps', 'p5_transactions', 'store_orders', 'reward_bookings', 'audit_log'].map((t) => h`<a class="pill-btn" href="/api/admin/export?table=${t}" download>${t.replace(/_/g, ' ')}</a>`)}</div></div>
    <div class="card"><h2>Audit log (latest 200)</h2>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${entries.map((e) => h`<tr><td class="nowrap">${fmtDT(e.ts)}</td><td>${e.actor}</td><td>${e.action}</td><td class="small">${e.detail || ''}</td></tr>`)}</tbody></table></div></div>`);
}

// ======================================================================================
// PIN sheet (printable). PINs live only in memory on this page.
// ======================================================================================
export function pinSheet(el) {
  const list = state.pinSheet;
  if (!list || !list.length) {
    mount(el, h`<div class="card"><div class="empty"><strong>No PINs to show</strong>PINs are only shown once, right after they\u2019re generated. Generate new ones from Admin \u2192 Roster and PINs.</div>
      <div class="row jc-center"><a class="btn" href="#/admin">Back to Admin</a></div></div>`);
    return;
  }
  const groups = {};
  list.forEach((s) => ((groups[`${s.grade}|${s.homeroom_teacher || 'No homeroom'}`] = groups[`${s.grade}|${s.homeroom_teacher || 'No homeroom'}`] || []).push(s)));
  const keys = Object.keys(groups).sort();
  mount(el, h`
    <div class="page-head"><div><h1>Student PIN sheet</h1><p class="muted">${list.length} PINs. This is the only time they\u2019re shown. Print or download before leaving this page, and keep the printout private.</p></div>
      <div class="actions no-print"><button class="btn primary" id="print">Print</button><button class="btn" id="csv">Download CSV</button><a class="btn" href="#/admin">Done</a></div></div>
    ${keys.map((k, i) => { const [g, hr] = k.split('|'); return h`<div class="card ${i ? 'page-break' : ''}"><h2>Grade ${g} \u2022 ${hr}</h2>
      <table><thead><tr><th>Student</th><th>Student ID</th><th>PIN</th></tr></thead><tbody>
      ${groups[k].sort((a, b) => a.last_name.localeCompare(b.last_name)).map((s) => h`<tr><td>${s.last_name}, ${s.first_name}</td><td>${s.student_id}</td><td><strong class="pin">${s.pin}</strong></td></tr>`)}</tbody></table></div>`; })}`);
  $('#print', el).addEventListener('click', () => window.print());
  $('#csv', el).addEventListener('click', () => downloadCsv('student-pins.csv', ['Grade', 'Homeroom', 'Last name', 'First name', 'Student ID', 'PIN'], list.map((s) => [s.grade, s.homeroom_teacher, s.last_name, s.first_name, s.student_id, s.pin])));
  window.addEventListener('hashchange', () => { state.pinSheet = null; }, { once: true });
}
