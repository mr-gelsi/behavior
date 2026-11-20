// Parent letters: drafts to review, copy, or open in your email app. The site never sends email itself.
import { state, api, h, raw, mount, $, $$, toast, fail, modal, fmtMD, downloadCsv } from './core.js';
import { icon } from './icons.js';

const STEPS_TPL = {
  subject: 'Behavior update for {first} - week of {week}',
  body: `Dear {parent},

I am writing to let you know that {first} received {count} behavior steps in my class during the week of {week}.{details}

I want every student to be successful, and I would welcome the chance to work together on this. If you have any questions or would like to talk, please reply to this email.

Thank you,
{sender}
{school}`,
};
const RESTROOM_TPL = {
  subject: 'Restroom and water breaks for {first}',
  body: `Dear {parent},

Our school keeps track of how often students leave class for the restroom or water. {first} has now left class {count} times this school year, which has reached the next level of our tracking.

Time out of class can affect learning, and we also want to be sure {first} is doing well. If there is a medical or other reason for the visits, please let us know so we can support {first}.

Thank you,
{sender}
{school}`,
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('tpl_' + k)) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tpl_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('tpl_' + k); } catch { /* ignore */ } },
};
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? `{${k}}` : v[k])).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const mdate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
const emailsOf = (s) => [s.guardian_email, s.guardian_email2].filter(Boolean);
const statusChip = (s, sent) => (s.no_email ? h`<span class="chip c4">Do not email</span>` : !s.guardian_email ? h`<span class="chip c3">No email on file</span>` : sent ? h`<span class="chip ok">Sent</span>` : h`<span class="chip gray">To do</span>`);
const canRestroom = () => state.me.user.role === 'admin' || state.me.user.classification === 'office';

export async function parents(el) {
  const tab = state.parentTab === 'restroom' && canRestroom() ? 'restroom' : 'steps';
  mount(el, h`<div class="page-head"><div><h1>${icon('mail', 28)} <span class="ml6">Parent letters</span></h1>
    <p class="muted">Draft letters to review. Copy the text or open it in your email app, then mark it sent. The site never sends email for you.</p></div></div>
    <div class="tabs" role="tablist"><button role="tab" data-t="steps" aria-selected="${tab === 'steps'}">Behavior steps</button>
      ${canRestroom() ? h`<button role="tab" data-t="restroom" aria-selected="${tab === 'restroom'}">Restroom / water</button>` : ''}</div>
    <div id="pbody"><div class="spinner">Loading…</div></div>`);
  $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { state.parentTab = b.dataset.t; parents(el).catch(fail); }));
  const body = $('#pbody', el);
  if (tab === 'steps') await stepsTab(body); else await restroomTab(body);
}

// One letter: edit, copy, open in email, mark sent.
function letterModal({ s, tpl, vars, kind, sent, onSent, markBody }) {
  const subject0 = fill(tpl.subject, vars), body0 = fill(tpl.body, vars);
  const to = emailsOf(s);
  const m = modal(`Letter for ${s.first_name} ${s.last_name}`, h`
    ${s.no_email ? h`<div class="banner warn">This family is marked <strong>Do not email</strong>. Please do not send this letter by email.</div>` : ''}
    ${!to.length ? h`<div class="banner warn">There is no parent email on file for this student. An admin can add one in Admin → Roster.</div>` : ''}
    <div class="field"><label>To</label><div>${to.length ? to.join(', ') : '—'}</div></div>
    <div class="field"><label for="lt_s">Subject</label><input type="text" id="lt_s" value="${subject0}"></div>
    <div class="field"><label for="lt_b">Message (you can edit it here)</label><textarea id="lt_b" rows="14">${body0}</textarea></div>
    <div class="row end wrap"><button class="btn" id="lt_copy" type="button">Copy message</button>
      <a class="btn" id="lt_mail" href="#" ${!to.length || s.no_email ? raw('aria-disabled="true"') : ''}>Open in email app</a>
      <button class="btn primary" id="lt_sent" type="button">${sent ? 'Marked sent (undo)' : 'Mark as sent'}</button></div>`);
  const body = m.body;
  const sub = () => $('#lt_s', body).value, txt = () => $('#lt_b', body).value;
  $('#lt_copy', body).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`Subject: ${sub()}\n\n${txt()}`); toast('Copied.'); } catch { $('#lt_b', body).select(); toast('Press Ctrl+C to copy the selected text.'); }
  });
  $('#lt_mail', body).addEventListener('click', (e) => {
    e.preventDefault();
    if (!to.length || s.no_email) return;
    const cc = to.length > 1 ? `&cc=${encodeURIComponent(to.slice(1).join(','))}` : '';
    location.href = `mailto:${encodeURIComponent(to[0])}?subject=${encodeURIComponent(sub())}${cc}&body=${encodeURIComponent(txt())}`;
  });
  $('#lt_sent', body).addEventListener('click', async () => {
    try {
      await api(`/parent-reports/${sent ? 'unsent' : 'sent'}`, { method: 'POST', body: markBody });
      m.close(); toast(sent ? 'Mark removed.' : 'Marked as sent.'); onSent();
    } catch (e) { fail(e); }
  });
}

function tplEditor(kind, def, onChange) {
  const cur = store.get(kind, def);
  return h`<details class="mt12"><summary>Edit the letter template</summary>
    <p class="muted small">Words in {braces} are filled in for each student: {parent} {first} {student} {count} {week} {details} {sender} {school}.</p>
    <div class="field"><label for="tp_s">Subject</label><input type="text" id="tp_s" value="${cur.subject}"></div>
    <div class="field"><label for="tp_b">Message</label><textarea id="tp_b" rows="11">${cur.body}</textarea></div>
    <div class="row"><button class="btn small primary" id="tp_save" type="button">Save template</button><button class="btn small" id="tp_reset" type="button">Reset to the default</button></div></details>`;
}
function wireTpl(root, kind, def, onChange) {
  $('#tp_save', root).addEventListener('click', () => { store.set(kind, { subject: $('#tp_s', root).value, body: $('#tp_b', root).value }); toast('Template saved on this computer.'); onChange(); });
  $('#tp_reset', root).addEventListener('click', () => { store.del(kind); toast('Template reset.'); onChange(); });
}
const parentName = (s) => s.guardian_name || 'Parent/Guardian';

// ---------------------------------------------------------------------------------------
async function stepsTab(box) {
  const o = state.parentSteps || (state.parentSteps = { week: '', min: 2, teacher: '', dates: false, notes: false });
  const qs = new URLSearchParams({ min: String(o.min) });
  if (o.week) qs.set('week', o.week);
  if (o.teacher) qs.set('teacher_id', o.teacher);
  const d = await api('/parent-reports/steps?' + qs);
  o.week = d.week_start;
  const teachers = state.me.user.role === 'admin' ? (await api('/admin/users')).users.filter((u) => u.active) : [];
  const tpl = store.get('steps', STEPS_TPL);
  const school = state.me.settings.school_name;
  const sender = d.teacher.name;
  const vars = (s) => ({
    parent: parentName(s), first: s.first_name, student: `${s.first_name} ${s.last_name}`, count: String(s.count), week: mdate(d.week_start), sender, school,
    details: !(o.dates || o.notes) ? '' : '\n\nDetails:\n' + s.steps.map((x) => `- ${mdate(x.date)}${o.dates ? `: Step ${x.level}` : ''}${o.notes && x.notes ? ` (${x.notes})` : ''}`).join('\n'),
  });
  const again = () => parents(box.closest('#page') || box.parentElement).catch(fail);
  const mark = (s) => ({ kind: 'steps', student_id: s.student_id, week: d.week_start, teacher_id: d.teacher.id });
  mount(box, h`
    <div class="card"><h2>Weekly behavior letters</h2>
      <p class="muted">Students who received multiple steps from ${state.me.user.role === 'admin' && o.teacher ? d.teacher.name : 'you'} during the week. Step details are <strong>left out</strong> unless you tick them below.</p>
      <div class="form-grid">
        <div><label for="pw">Week of (any day)</label><input type="date" id="pw" value="${d.week_start}"></div>
        <div><label for="pm">Minimum steps</label><input type="number" id="pm" min="1" max="5" value="${o.min}"></div>
        ${teachers.length ? h`<div><label for="pt">Teacher</label><select id="pt"><option value="">Me</option>${teachers.map((t) => h`<option value="${t.id}" ${String(t.id) === String(o.teacher) ? raw('selected') : ''}>${t.name}</option>`)}</select></div>` : ''}
      </div>
      <div class="row wrap"><button class="btn small" id="pprev" type="button">← Previous week</button><button class="btn small" id="pnext" type="button">Next week →</button><button class="btn small primary" id="prun" type="button">Update</button></div>
      <p class="muted small mt8">${mdate(d.week_start)} – ${mdate(d.week_end)}</p>
      <label class="check"><input type="checkbox" id="od" ${o.dates ? raw('checked') : ''}> Include the date and step level of each step</label>
      <label class="check"><input type="checkbox" id="on" ${o.notes ? raw('checked') : ''}> Include my notes on each step (check them first; they may contain private details)</label>
      ${tplEditor('steps', STEPS_TPL)}</div>
    <div class="card">${d.students.length ? h`<div class="row between mb10"><strong>${d.students.length} student${d.students.length === 1 ? '' : 's'}</strong><button class="btn small" id="pcsv" type="button">${icon('download', 16)} Download for mail merge</button></div>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Gr</th><th class="num">Steps</th><th>Parent</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.students.map((s) => h`<tr><td><strong>${s.last_name}, ${s.first_name}</strong></td><td>${s.grade}</td><td class="num"><strong>${s.count}</strong></td>
        <td>${s.guardian_name || ''}<div class="muted small">${s.guardian_email || ''}</div></td><td>${statusChip(s, s.sent)}</td>
        <td class="right"><button class="btn small primary" data-l="${s.student_id}" type="button">Review letter</button></td></tr>`)}</tbody></table></div>`
      : h`<div class="empty"><strong>No students this week</strong>No student has ${o.min} or more steps from ${state.me.user.role === 'admin' && o.teacher ? d.teacher.name : 'you'} for this week.</div>`}</div>`);
  wireTpl(box, 'steps', STEPS_TPL, again);
  const apply = () => { o.week = $('#pw', box).value; o.min = Math.max(1, Math.min(5, Number($('#pm', box).value) || 2)); if ($('#pt', box)) o.teacher = $('#pt', box).value; o.dates = $('#od', box).checked; o.notes = $('#on', box).checked; again(); };
  $('#prun', box).addEventListener('click', apply);
  $('#pprev', box).addEventListener('click', () => { $('#pw', box).value = new Date(Date.parse(d.week_start + 'T00:00:00Z') - 7 * 864e5).toISOString().slice(0, 10); apply(); });
  $('#pnext', box).addEventListener('click', () => { $('#pw', box).value = new Date(Date.parse(d.week_start + 'T00:00:00Z') + 7 * 864e5).toISOString().slice(0, 10); apply(); });
  $('#od', box).addEventListener('change', () => { o.dates = $('#od', box).checked; });
  $('#on', box).addEventListener('change', () => { o.notes = $('#on', box).checked; });
  $$('[data-l]', box).forEach((b) => b.addEventListener('click', () => {
    const s = d.students.find((x) => String(x.student_id) === b.dataset.l);
    o.dates = $('#od', box).checked; o.notes = $('#on', box).checked;
    letterModal({ s, tpl, vars: vars(s), kind: 'steps', sent: s.sent, onSent: again, markBody: mark(s) });
  }));
  const csv = $('#pcsv', box);
  if (csv) csv.addEventListener('click', () => {
    o.dates = $('#od', box).checked; o.notes = $('#on', box).checked;
    downloadCsv(`behavior-letters-${d.week_start}.csv`, ['Student ID', 'Student', 'Grade', 'Parent name', 'Email', 'Second email', 'Do not email', 'Subject', 'Message'],
      d.students.map((s) => [s.student_id, `${s.first_name} ${s.last_name}`, s.grade, s.guardian_name || '', s.guardian_email || '', s.guardian_email2 || '', s.no_email ? 'YES' : '', fill(tpl.subject, vars(s)), fill(tpl.body, vars(s))]));
  });
}

// ---------------------------------------------------------------------------------------
async function restroomTab(box) {
  const d = await api('/parent-reports/restroom');
  const tpl = store.get('restroom', RESTROOM_TPL);
  const school = state.me.settings.school_name, sender = state.me.user.name;
  const vars = (s) => ({ parent: parentName(s), first: s.first_name, student: `${s.first_name} ${s.last_name}`, count: String(s.trips), week: '', details: '', sender, school });
  const again = () => parents(box.closest('#page') || box.parentElement).catch(fail);
  const LV = ['', 'Yellow', 'Orange', 'Red', 'Black'];
  const row = (s, doneRow) => h`<tr><td><strong>${s.last_name}, ${s.first_name}</strong></td><td>${s.grade}</td>
    <td class="num"><strong class="bk-${['green', 'yellow', 'orange', 'red', 'black'][s.level]}">${s.trips}</strong></td><td><span class="chip bkchip-${['green', 'yellow', 'orange', 'red', 'black'][s.level]}">${LV[s.level]}</span></td>
    <td>${s.guardian_name || ''}<div class="muted small">${s.guardian_email || ''}</div></td><td>${statusChip(s, doneRow)}</td>
    <td class="right"><button class="btn small ${doneRow ? '' : 'primary'}" data-l="${s.student_id}" type="button">${doneRow ? 'View' : 'Review letter'}</button></td></tr>`;
  const head = h`<thead><tr><th>Student</th><th>Gr</th><th class="num">Trips</th><th>Level</th><th>Parent</th><th>Status</th><th></th></tr></thead>`;
  mount(box, h`
    <div class="card"><h2>Restroom / water letters</h2>
      <p class="muted">Every trip out of class this school year (${d.school_year}) is counted, from every teacher and every day. A student appears here when they reach a new warning level: yellow at ${d.bands[0] + 1} trips, orange at ${d.bands[0] + d.bands[1] + 1}, red at ${d.bands[0] + d.bands[1] + d.bands[2] + 1}, black at ${d.bands[0] + d.bands[1] + d.bands[2] + d.bands[3] + 1}. After you mark a letter sent, the student returns to this list only when they move up another level.</p>
      ${d.exempt_count ? h`<div class="banner info">${d.exempt_count} student${d.exempt_count === 1 ? ' is' : 's are'} marked exempt from restroom letters and left out.</div>` : ''}
      ${tplEditor('restroom', RESTROOM_TPL)}</div>
    <div class="card"><div class="row between mb10"><h2>Needs a letter (${d.pending.length})</h2>${d.pending.length ? h`<button class="btn small" id="pcsv" type="button">${icon('download', 16)} Download for mail merge</button>` : ''}</div>
      ${d.pending.length ? h`<div class="table-wrap"><table>${head}<tbody>${d.pending.map((s) => row(s, false))}</tbody></table></div>`
        : h`<div class="empty"><strong>Nobody is waiting</strong>When a student reaches a new level, they show up here.</div>`}</div>
    ${d.done.length ? h`<div class="card"><h2>Already notified at this level (${d.done.length})</h2><div class="table-wrap"><table>${head}<tbody>${d.done.map((s) => row(s, true))}</tbody></table></div></div>` : ''}`);
  wireTpl(box, 'restroom', RESTROOM_TPL, again);
  const all = [...d.pending.map((s) => [s, false]), ...d.done.map((s) => [s, true])];
  $$('[data-l]', box).forEach((b) => b.addEventListener('click', () => {
    const [s, sent] = all.find(([x]) => String(x.student_id) === b.dataset.l);
    letterModal({ s, tpl, vars: vars(s), kind: 'restroom', sent, onSent: again, markBody: { kind: 'restroom', student_id: s.student_id } });
  }));
  const csv = $('#pcsv', box);
  if (csv) csv.addEventListener('click', () => downloadCsv(`restroom-letters-${d.school_year}.csv`, ['Student ID', 'Student', 'Grade', 'Trips', 'Level', 'Parent name', 'Email', 'Second email', 'Do not email', 'Subject', 'Message'],
    d.pending.map((s) => [s.student_id, `${s.first_name} ${s.last_name}`, s.grade, s.trips, LV[s.level], s.guardian_name || '', s.guardian_email || '', s.guardian_email2 || '', s.no_email ? 'YES' : '', fill(tpl.subject, vars(s)), fill(tpl.body, vars(s))])));
}
