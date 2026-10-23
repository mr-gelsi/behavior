import {
  state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox, fmtDate, fmtDT, toLocalInput, pct, studentPicker, downloadCsv,
} from './core.js';

const loading = (el) => mount(el, h`<div class="spinner">Loading\u2026</div>`);
const isAdmin = () => state.me.user.role === 'admin';

export async function rewardsStaff(el) {
  loading(el);
  const { days } = await api('/reward-days');
  const wanted = state.rewardDayId && days.find((d) => d.id === state.rewardDayId);
  const today = state.me.today;
  const pick = wanted || days.find((d) => d.status !== 'closed' && d.reward_date >= today) || days[0] || null;
  state.rewardDayId = pick ? pick.id : null;

  mount(el, h`
    <div class="page-head"><div><h1>\ud83c\udf9f\ufe0f Rewards Day</h1><p class="muted">Activities, seats, and rooms for non-qualifiers</p></div>
      <div class="actions">${days.length ? h`<label for="daysel" class="hidden">Rewards Day</label><select class="minw240" id="daysel">${days.map((d) => h`<option value="${d.id}" ${pick && d.id === pick.id ? raw('selected') : ''}>${d.name} \u2022 ${fmtDate(d.reward_date)}</option>`)}</select>` : ''}
        ${isAdmin() ? h`<button class="btn primary" id="newday">New Rewards Day</button>` : ''}</div></div>
    <div id="day">${pick ? '<div class="spinner">Loading\u2026</div>' : ''}</div>
    ${pick ? '' : h`<div class="card"><div class="empty"><strong>No Rewards Day yet</strong>${isAdmin() ? 'Create one, then add activities and rooms.' : 'An Admin needs to create a Rewards Day before activities can be added.'}</div></div>`}`);

  const sel = $('#daysel', el);
  if (sel) sel.addEventListener('change', () => { state.rewardDayId = Number(sel.value); rewardsStaff(el).catch(fail); });
  const nd = $('#newday', el);
  if (nd) nd.addEventListener('click', () => dayForm(null, () => rewardsStaff(el).catch(fail)));
  if (pick) loadDay(el, pick.id);
}

async function dayForm(day, done) {
  const { periods } = await api('/reward-periods');
  const now = new Date();
  const opens = day ? day.booking_opens_at : now.toISOString();
  const closes = day ? day.booking_closes_at : new Date(now.getTime() + 7 * 864e5).toISOString();
  const m = modal(day ? 'Edit Rewards Day' : 'New Rewards Day', h`
    <div class="form-grid">
      <div><label for="d_n">Name</label><input type="text" id="d_n" value="${day ? day.name : ''}" maxlength="80" placeholder="Fall Rewards Day"></div>
      <div><label for="d_d">Rewards Day date</label><input type="date" id="d_d" value="${day ? day.reward_date : ''}"></div>
      <div><label for="d_p">Qualification is based on</label><select id="d_p">${periods.map((p) => h`<option value="${p.id}" ${day && p.id === day.reward_period_id ? raw('selected') : ''}>${p.name} (${p.school_year}) \u2022 ${p.start_date} to ${p.end_date}</option>`)}</select></div>
      <div><label for="d_o">Booking opens</label><input type="datetime-local" id="d_o" value="${toLocalInput(opens)}"></div>
      <div><label for="d_c">Booking closes</label><input type="datetime-local" id="d_c" value="${toLocalInput(closes)}"></div>
    </div>
    <div class="help">When booking closes, non-qualifiers who have no room are assigned automatically.</div>
    <div class="row end mt14"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div><div class="error-text" id="d_err"></div>`);
  $('[data-x]', m.el).addEventListener('click', m.close);
  $('[data-s]', m.el).addEventListener('click', async () => {
    const v = (s) => $(s, m.el).value;
    if (!v('#d_o') || !v('#d_c')) { $('#d_err', m.el).textContent = 'Enter when booking opens and closes.'; return; }
    const body = { name: v('#d_n'), reward_date: v('#d_d'), reward_period_id: Number(v('#d_p')), booking_opens_at: new Date(v('#d_o')).toISOString(), booking_closes_at: new Date(v('#d_c')).toISOString() };
    try { await api(day ? '/reward-days/' + day.id : '/reward-days', { method: day ? 'PATCH' : 'POST', body }); m.close(); toast('Rewards Day saved.'); done(); }
    catch (e) { $('#d_err', m.el).textContent = e.message; }
  });
}

async function loadDay(el, id) {
  const box = $('#day', el);
  const refresh = () => loadDay(el, id).catch(fail);
  let d;
  try { d = await api('/reward-days/' + id); } catch (e) { fail(e); return; }
  const { day, activities, overview: o } = d;
  const regular = activities.filter((a) => a.kind === 'regular');
  const rooms = activities.filter((a) => a.kind === 'nonqual');
  const me = state.me.user;
  const canManage = (a) => isAdmin() || a.created_by === me.email;
  const closed = day.status === 'closed';

  const actTable = (list, nonqual) => list.length ? h`<div class="table-wrap"><table>
    <thead><tr><th>${nonqual ? 'Room' : 'Activity'}</th><th>Location</th><th>Seats</th>${nonqual ? '' : h`<th class="num">P5 cost</th><th>Grades</th>`}<th>Created by</th><th></th></tr></thead><tbody>
    ${list.map((a) => h`<tr><td><strong>${a.name}</strong><div class="muted small">${a.description || ''}</div></td><td>${a.location || ''}</td>
      <td class="minw140">${a.taken} / ${a.capacity}<div class="bar thin ${a.taken >= a.capacity ? '' : 'green'}"><i data-w="${pct(a.taken, a.capacity)}"></i></div></td>
      ${nonqual ? '' : h`<td class="num">${a.p5_cost}</td><td>${a.allowed_grades ? a.allowed_grades.split(',').join(', ') : 'All'}</td>`}
      <td class="small">${a.created_by || ''}</td>
      <td class="nowrap"><button class="btn small" data-roster="${a.id}">Roster</button>
        ${canManage(a) && !closed ? h` <button class="btn small" data-edit="${a.id}">Edit</button> <button class="btn small danger" data-del="${a.id}">Delete</button>` : ''}</td></tr>`)}
    </tbody></table></div>` : h`<div class="empty"><strong>${nonqual ? 'No non-qualifier rooms yet' : 'No activities yet'}</strong>${nonqual ? 'Add a room so non-qualifiers have somewhere to be.' : 'Add something like Movie or Coloring.'}</div>`;

  mount(box, h`
    ${o.shortfall > 0 ? h`<div class="banner danger"><strong>${o.shortfall} non-qualifier${o.shortfall === 1 ? '' : 's'} won\u2019t have a room.</strong> Add a room or raise a room\u2019s number of spots, then run Assign rooms.</div>`
      : o.nonqualifiers_unassigned > 0 ? h`<div class="banner warn">${o.nonqualifiers_unassigned} non-qualifier${o.nonqualifiers_unassigned === 1 ? '' : 's'} not yet assigned a room. They\u2019re assigned automatically when booking closes, or you can assign now.</div>` : ''}
    ${o.locked ? h`<div class="banner info">Qualification is locked. Steps added from now on won\u2019t change who qualifies for this Rewards Day.</div>` : ''}

    <div class="card">
      <div class="page-head mb8"><div><h2 class="mb2">${day.name}</h2>
        <p class="muted m0">${fmtDate(day.reward_date)} \u2022 qualification from ${day.period_name} (${day.start_date} to ${day.end_date})</p>
        <p class="muted small m4-0-0">Booking ${fmtDT(day.booking_opens_at)} \u2192 ${fmtDT(day.booking_closes_at)} \u2022 <span class="chip ${day.status === 'open' ? 'ok' : day.status === 'closed' ? 'gray' : 'step'}">${day.status}</span></p></div>
        <div class="actions">
          ${isAdmin() && day.status === 'draft' ? h`<button class="btn primary" id="open">Open booking</button>` : ''}
          ${!closed ? h`<button class="btn" id="assign">Assign rooms now</button>` : ''}
          ${isAdmin() && day.status === 'open' ? h`<button class="btn" id="close">Close booking and assign</button>` : ''}
          ${isAdmin() && !closed ? h`<button class="btn" id="lock">${o.locked ? 'Unlock qualification' : 'Lock qualification'}</button><button class="btn" id="editday">Edit</button>` : ''}
        </div></div>
      <div class="kpi-grid m0">
        <div class="kpi"><div class="label">Qualifiers booked</div><div class="big">${o.qualifiers_booked}</div><div class="sub">${o.qualifiers_unbooked} of ${o.qualifiers} haven\u2019t booked</div></div>
        <div class="kpi"><div class="label">Non-qualifiers</div><div class="big">${o.nonqualifiers}</div><div class="sub">${o.nonqualifiers_assigned} assigned \u2022 ${o.nonqualifiers_unassigned} waiting</div></div>
        <div class="kpi"><div class="label">Room seats left</div><div class="big">${o.nonqual_room_seats_left}</div><div class="sub">in non-qualifier rooms</div></div>
      </div>
    </div>

    <div class="card"><div class="page-head mb8"><h2 class="m0">Activities for qualifiers</h2>
      ${!closed ? h`<button class="btn primary small" data-add="regular">Add activity</button>` : ''}</div>${actTable(regular, false)}</div>
    <div class="card"><div class="page-head mb8"><h2 class="m0">Non-qualifier rooms</h2>
      ${!closed ? h`<button class="btn primary small" data-add="nonqual">Add room</button>` : ''}</div>${actTable(rooms, true)}</div>

    <details class="card" id="placeBox"><summary class="summary-bold">Place a student by hand</summary>
      <div class="form-grid mt14"><div><label>Student</label><div id="pp"></div></div>
        <div><label for="pa">Put them in</label><select id="pa">${activities.map((a) => h`<option value="${a.id}">${a.name}${a.kind === 'nonqual' ? ' (non-qualifier room)' : ''} \u2022 ${a.capacity - a.taken} left</option>`)}</select></div></div>
      <button class="btn primary" id="place" ${activities.length ? '' : raw('disabled')}>Place student</button>
      <div class="help">Staff placements don\u2019t need enough points. Moving a student refunds their old seat and charges the new activity\u2019s cost.</div></details>`);

  const call = async (path, okMsg) => { try { const r = await api(path, { method: 'POST', body: {} }); toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); refresh(); } catch (e) { fail(e); } };
  const bind = (id, fn) => { const b = $(id, box); if (b) b.addEventListener('click', fn); };
  bind('#open', () => confirmBox('Open booking? Students will be able to reserve seats during the booking window.', { ok: 'Open booking' }).then(async (y) => {
    if (!y) return;
    try { await api('/reward-days/' + id, { method: 'PATCH', body: { status: 'open' } }); toast('Booking is open.'); refresh(); } catch (e) { fail(e); }
  }));
  bind('#assign', () => call(`/reward-days/${id}/auto-assign`, (r) => `Assigned ${r.assigned} student${r.assigned === 1 ? '' : 's'}${r.unassigned ? `. ${r.unassigned} still need a room.` : '.'}`));
  bind('#close', () => confirmBox('Close booking now? Seats can no longer be changed by students, and non-qualifiers without a room are assigned.', { ok: 'Close booking', danger: true }).then((y) => y && call(`/reward-days/${id}/close`, 'Booking closed and rooms assigned.')));
  bind('#lock', async () => {
    try {
      if (o.locked) { await api(`/reward-days/${id}/lock`, { method: 'POST', body: { unlock: true } }); toast('Qualification unlocked.'); }
      else {
        if (!(await confirmBox('Lock the list of non-qualifiers as it is right now? Steps added later won\u2019t change who qualifies for this Rewards Day.', { ok: 'Lock list' }))) return;
        const r = await api(`/reward-days/${id}/lock`, { method: 'POST', body: {} }); toast(`Locked. ${r.nonqualifiers} non-qualifiers.`);
      }
      refresh();
    } catch (e) { fail(e); }
  });
  bind('#editday', () => dayForm(day, refresh));

  $$('[data-add]', box).forEach((b) => b.addEventListener('click', () => activityForm(null, id, b.dataset.add, refresh)));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => activityForm(activities.find((a) => String(a.id) === b.dataset.edit), id, null, refresh)));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    const a = activities.find((x) => String(x.id) === b.dataset.del);
    if (!(await confirmBox(`Delete \u201c${a.name}\u201d?`, { ok: 'Delete', danger: true }))) return;
    try { await api('/reward-activities/' + a.id, { method: 'DELETE' }); toast('Deleted.'); refresh(); } catch (e) { fail(e); }
  }));
  $$('[data-roster]', box).forEach((b) => b.addEventListener('click', () => roster(Number(b.dataset.roster), refresh, closed)));

  const pp = $('#pp', box);
  if (pp) {
    const picker = studentPicker(pp);
    bind('#place', async () => {
      const s = picker.get()[0];
      if (!s) { toast('Choose a student first.', 'err'); return; }
      try { await api(`/reward-days/${id}/place`, { method: 'POST', body: { student_id: s.student_id, activity_id: Number($('#pa', box).value) } }); toast(`${s.first_name} ${s.last_name} placed.`); picker.clear(); refresh(); }
      catch (e) { fail(e); }
    });
  }
}

function activityForm(a, dayId, kind, done) {
  const k = a ? a.kind : kind;
  const grades = a && a.allowed_grades ? a.allowed_grades.split(',').map(Number) : [];
  const m = modal(a ? `Edit ${k === 'nonqual' ? 'room' : 'activity'}` : `Add ${k === 'nonqual' ? 'a non-qualifier room' : 'an activity'}`, h`
    <div class="form-grid">
      <div><label for="a_n">Name</label><input type="text" id="a_n" value="${a ? a.name : ''}" maxlength="80" placeholder="${k === 'nonqual' ? 'Study hall' : 'Movie'}"></div>
      <div><label for="a_l">Room or location</label><input type="text" id="a_l" value="${a ? a.location || '' : ''}" maxlength="80"></div>
      <div><label for="a_c">Number of spots</label><input type="number" id="a_c" min="1" value="${a ? a.capacity : 30}"></div>
      ${k === 'nonqual' ? '' : h`<div><label for="a_p">P5 cost</label><input type="number" id="a_p" min="0" value="${a ? a.p5_cost : 0}"></div>`}
    </div>
    <div class="field"><label for="a_d">Description (optional)</label><input type="text" id="a_d" value="${a ? a.description || '' : ''}" maxlength="300"></div>
    ${k === 'nonqual' ? '' : h`<div class="field"><label>Open to grades (leave all unticked for everyone)</label>
      <div class="row">${[6, 7, 8].map((g) => h`<label class="check"><input type="checkbox" data-g="${g}" ${grades.includes(g) ? raw('checked') : ''}> ${g}th</label>`)}</div></div>`}
    <div class="row end"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div><div class="error-text" id="a_err"></div>`);
  $('[data-x]', m.el).addEventListener('click', m.close);
  $('[data-s]', m.el).addEventListener('click', async () => {
    const v = (s) => $(s, m.el).value;
    const body = { kind: k, name: v('#a_n'), location: v('#a_l') || null, capacity: Number(v('#a_c')), description: v('#a_d') || null };
    if (k !== 'nonqual') { body.p5_cost = Number(v('#a_p')); const g = $$('[data-g]', m.el).filter((x) => x.checked).map((x) => Number(x.dataset.g)); body.allowed_grades = g.length ? g : null; }
    try { await api(a ? '/reward-activities/' + a.id : `/reward-days/${dayId}/activities`, { method: a ? 'PATCH' : 'POST', body }); m.close(); toast('Saved.'); done(); }
    catch (e) { $('#a_err', m.el).textContent = e.message; }
  });
}

async function roster(id, done, closed) {
  try {
    const r = await api(`/reward-activities/${id}/roster`);
    const m = modal(`${r.activity.name}: ${r.students.length} / ${r.activity.capacity} seats`, h`
      <p class="muted">${r.activity.location || 'No location set'}${r.activity.kind === 'regular' ? ' \u2022 ' + r.activity.p5_cost + ' P5' : ' \u2022 non-qualifier room'}</p>
      <div class="row no-print mb10"><button class="btn small" id="rcsv">Download CSV</button><button class="btn small" id="rprint">Print</button></div>
      ${r.students.length ? h`<div class="table-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Gr</th><th>Homeroom</th><th>Placed</th><th class="no-print"></th></tr></thead><tbody>
        ${r.students.map((s, i) => h`<tr><td>${i + 1}</td><td>${s.last_name}, ${s.first_name}</td><td>${s.grade}</td><td>${s.homeroom_teacher || ''}</td><td>${{ self: 'Booked', auto: 'Auto', manual: 'By staff' }[s.assignment]}</td>
          <td class="no-print">${closed ? '' : h`<button class="btn small danger" data-rm="${s.booking_id}">Remove</button>`}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty"><strong>Nobody yet</strong>Students will appear here as they book.</div>`}`, { wide: true });
    $('#rprint', m.el).addEventListener('click', () => window.print());
    $('#rcsv', m.el).addEventListener('click', () => downloadCsv(`${r.activity.name}-roster.csv`, ['Last name', 'First name', 'Grade', 'Homeroom', 'Placed'], r.students.map((s) => [s.last_name, s.first_name, s.grade, s.homeroom_teacher, s.assignment])));
    $$('[data-rm]', m.el).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('Remove this student from the activity? Their points are refunded.', { ok: 'Remove', danger: true }))) return;
      try { await api('/reward-bookings/' + b.dataset.rm, { method: 'DELETE' }); toast('Removed.'); m.close(); done(); } catch (e) { fail(e); }
    }));
  } catch (e) { fail(e); }
}
