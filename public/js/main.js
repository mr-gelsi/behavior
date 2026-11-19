import { state, api, h, raw, mount, $, $$, toast, fail, modal, confirmBox } from './core.js';
import * as S from './views-staff.js';
import * as P from './views-p5.js';
import { rewardsStaff } from './views-rewards.js';
import { admin, pinSheet } from './views-admin.js';
import { studentHome, studentStore, studentSeat } from './views-student.js';
import { icon } from './icons.js';
import { breaksStaff, studentTimer, openBreakModal } from './views-breaks.js';
import { classesList, classDetail, studentClasses } from './views-classes.js';

const root = document.getElementById('root');

// ---------------------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------------------
async function showLogin(message) {
  document.body.classList.remove('menu-open');
  let setup = false;
  try { setup = (await api('/setup/status')).needed; } catch { /* offline */ }
  let kind = 'student';
  const paint = () => {
    mount(root, h`<div class="login-wrap"><div class="login-card">
      <div class="logo-tile login-logo"><img src="/logo.png" width="640" height="289" alt="Panther logo"></div>
      <h1 class="login-title">Behavior Tracker</h1>
      ${setup ? h`<p class="muted">Welcome! Create the first Admin account to get started. You\u2019ll need the setup token from your Cloudflare settings.</p>
        <div class="field"><label for="su_t">Setup token</label><input type="password" id="su_t" autocomplete="off"></div>
        <div class="field"><label for="su_n">Your name</label><input type="text" id="su_n" autocomplete="name"></div>
        <div class="field"><label for="su_e">Email</label><input type="email" id="su_e" autocomplete="username"></div>
        <div class="field"><label for="su_p">Password (12 or more characters)</label><input type="password" id="su_p" autocomplete="new-password"></div>
        <button class="btn primary w100" id="go">Create Admin account</button>`
      : h`<p class="muted center">Sign in to continue.</p>
        <div class="seg mb16" id="kind" role="group" aria-label="Who is signing in"><button type="button" data-k="student" aria-pressed="${kind === 'student'}">Student</button><button type="button" data-k="staff" aria-pressed="${kind === 'staff'}">Staff</button></div>
        ${kind === 'staff' ? h`<div class="field"><label for="l_e">Email</label><input type="email" id="l_e" autocomplete="username"></div>
          <div class="field"><label for="l_p">Password</label><input type="password" id="l_p" autocomplete="current-password"></div>`
        : h`<div class="field"><label for="l_s">Student ID</label><input type="text" id="l_s" inputmode="numeric" autocomplete="username"></div>
          <div class="field"><label for="l_n">PIN or password</label><input type="password" id="l_n" autocomplete="current-password" maxlength="200"><div class="help">First time? Use the 6-digit PIN your teacher gave you. After you make your own password, use that instead.</div></div>`}
        <button class="btn primary w100" id="go">Sign in</button>`}
      <div class="error-text" id="lerr" role="alert">${message || ''}</div></div></div>`);
    $$('#kind button', root).forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; paint(); }));
    const submit = async () => {
      const err = $('#lerr', root), btn = $('#go', root);
      err.textContent = '';
      btn.disabled = true;
      try {
        if (setup) {
          await api('/setup', { method: 'POST', body: { token: $('#su_t', root).value, name: $('#su_n', root).value, email: $('#su_e', root).value, password: $('#su_p', root).value } });
          setup = false; kind = 'staff'; paint(); toast('Admin account created. Please sign in.');
          return;
        }
        const body = kind === 'staff'
          ? { kind, email: $('#l_e', root).value, password: $('#l_p', root).value }
          : { kind, student_id: $('#l_s', root).value, pin: $('#l_n', root).value };
        await api('/login', { method: 'POST', body });
        await boot();
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    };
    $('#go', root).addEventListener('click', submit);
    $$('input', root).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    const first = $('input', root); if (first) first.focus();
  };
  paint();
}

// ---------------------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------------------
const STAFF_NAV = [
  ['dashboard', 'dashboard', 'Dashboard'], ['record', 'record', 'Record Steps'], ['reports', 'reports', 'Behavior Reports'],
  ['reward-report', 'gift', 'Reward Day Report'],
  ['p5', 'star', 'P5 Points'], ['store', 'store', 'Store'], ['rewards', 'ticket', 'Rewards Day'], ['classes', 'classes', 'My Classes'], ['breaks', 'clock', 'Break Tracker'],
];
const STUDENT_NAV = [['me', 'bank', 'My P5'], ['shop', 'store', 'Store'], ['seat', 'ticket', 'Reserve a Seat'], ['classes', 'key', 'My Classes']];

function defaultNav(me) {
  return me.type === 'staff' ? [...STAFF_NAV, ...(me.user.role === 'admin' ? [['admin', 'admin', 'Admin']] : [])] : STUDENT_NAV;
}
// The person's saved order first; anything they haven't placed (for example a tab added later) follows in the default order.
function orderedNav(me) {
  const base = defaultNav(me);
  const byPath = new Map(base.map((n) => [n[0], n]));
  const out = [];
  for (const p of (me.prefs && me.prefs.nav_order) || []) if (byPath.has(p)) { out.push(byPath.get(p)); byPath.delete(p); }
  for (const n of base) if (byPath.has(n[0])) out.push(n);
  return out;
}

let navDraft = null; // the order being edited while "Reorder menu" is on

function currentPath() {
  return (location.hash.replace(/^#\/?/, '').split('?')[0]) || (state.me && state.me.type === 'staff' ? 'dashboard' : 'me');
}
function markActive() {
  const path = currentPath();
  $$('.nav a', root).forEach((a) => a.classList.toggle('active', a.dataset.path === path || a.dataset.path === path.split('/')[0] || (path === 'pin-sheet' && a.dataset.path === 'admin') || (path.startsWith('class/') && a.dataset.path === 'classes')));
}
function drawNav(focusSel) {
  const nav = $('#nav', root);
  const tools = $('#navtools', root);
  const bar = $('#navbar', root);
  if (!navDraft) {
    mount(bar, h``);
    mount(nav, h`${orderedNav(state.me).map(([path, ico, label]) => h`<a href="#/${path}" data-path="${path}"><span class="ico">${icon(ico)}</span><span class="nav-text">${label}</span></a>`)}`);
    mount(tools, h`<button type="button" class="link-btn" id="navEdit">\u2195 Reorder menu</button>`);
    markActive();
    return;
  }
  mount(nav, h`${navDraft.map(([path, ico, label], i) => h`<div class="nav-row" data-path="${path}">
      <span class="nav-handle" title="Drag to move" aria-hidden="true">\u22ee\u22ee</span><span class="ico">${icon(ico)}</span><span class="nav-label" title="${label}">${label}</span>
      <span class="nav-move"><button type="button" data-up="${path}" aria-label="Move ${label} up" ${i === 0 ? raw('disabled') : ''}>\u25b2</button><button type="button" data-down="${path}" aria-label="Move ${label} down" ${i === navDraft.length - 1 ? raw('disabled') : ''}>\u25bc</button></span></div>`)}`);
  mount(tools, h``);
  mount(bar, h`<div class="row"><button type="button" class="btn small primary" id="navSave">Save</button><button type="button" class="btn small" id="navReset">Reset</button><button type="button" class="btn small" id="navCancel">Cancel</button></div>
    <p class="nav-help">Drag \u22ee\u22ee or use the arrows, then Save.</p>`);
  if (focusSel) { const f = $(focusSel, nav); if (f && !f.disabled) f.focus(); }
}

function wireNavEditing() {
  const side = $('#sidebar', root);
  const moveItem = (from, to) => { if (from === to || from < 0 || to < 0 || to >= navDraft.length) return; const [it] = navDraft.splice(from, 1); navDraft.splice(to, 0, it); };
  side.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'navEdit') { navDraft = orderedNav(state.me).map((n) => n.slice()); drawNav(); return; }
    if (!navDraft) return;
    if (b.id === 'navCancel') { navDraft = null; drawNav(); return; }
    if (b.id === 'navReset') {
      try { await api('/me/nav-order', { method: 'DELETE' }); state.me.prefs.nav_order = null; navDraft = null; drawNav(); toast('The menu is back to its original order.'); } catch (er) { fail(er); }
      return;
    }
    if (b.id === 'navSave') {
      try {
        const r = await api('/me/nav-order', { method: 'PUT', body: { order: navDraft.map((n) => n[0]) } });
        state.me.prefs.nav_order = r.order; navDraft = null; drawNav(); toast('Menu order saved.');
      } catch (er) { fail(er); }
      return;
    }
    const path = b.dataset.up || b.dataset.down;
    if (path) {
      const i = navDraft.findIndex((n) => n[0] === path);
      moveItem(i, b.dataset.up ? i - 1 : i + 1);
      drawNav(`[data-${b.dataset.up ? 'up' : 'down'}="${path}"]`);
      if (!$(`[data-${b.dataset.up ? 'up' : 'down'}="${path}"]`, side) || $(`[data-${b.dataset.up ? 'up' : 'down'}="${path}"]`, side).disabled) { const o = $(`[data-${b.dataset.up ? 'down' : 'up'}="${path}"]`, side); if (o) o.focus(); }
    }
  });
  // Drag a row by its handle (mouse, pen, or touch).
  let drag = null;
  side.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.nav-handle');
    if (!handle || !navDraft || e.button > 0) return;
    const rows = $$('.nav-row', side);
    const row = handle.closest('.nav-row');
    drag = { id: e.pointerId, row, from: rows.indexOf(row), sy: e.clientY, rects: rows.map((r) => r.getBoundingClientRect()) };
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    row.classList.add('dragging');
  });
  const indexAt = (y, r) => { if (y <= r[0].top) return 0; for (let i = 0; i < r.length; i++) if (y >= r[i].top && y < r[i].bottom) return i; return r.length - 1; };
  side.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.row.style.transform = `translateY(${e.clientY - drag.sy}px)`;
    const rows = $$('.nav-row', side);
    rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    const to = indexAt(e.clientY, drag.rects);
    if (to !== drag.from) rows[to].classList.add(to < drag.from ? 'drop-before' : 'drop-after');
  });
  const end = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.row.style.transform = '';
    const to = cancel ? d.from : indexAt(e.clientY, d.rects);
    if (to !== d.from) { moveItem(d.from, to); drawNav(); }
    else { d.row.classList.remove('dragging'); $$('.nav-row', side).forEach((r) => r.classList.remove('drop-before', 'drop-after')); }
  };
  side.addEventListener('pointerup', (e) => end(e, false));
  side.addEventListener('pointercancel', (e) => end(e, true));
}

function shell() {
  const me = state.me;
  const staff = me.type === 'staff';
  navDraft = null;
  const who = staff ? me.user.role[0].toUpperCase() + me.user.role.slice(1) : 'Student';
  mount(root, h`<div class="app">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation"><div class="brand"><span class="logo-tile"><img src="/logo.png" width="640" height="289" alt="Panther logo"></span><span>BEHAVIOR<br>TRACKER</span></div>
      <div class="nav-edit-bar no-print" id="navbar"></div>
      <nav class="nav" id="nav" aria-label="Pages"></nav>
      <div class="nav-tools no-print" id="navtools"></div>
      <div class="sidebar-foot">${me.settings.school_name}<br>${staff ? h`<a class="c-inherit" href="#/password">Change password</a>` : h`<a class="c-inherit" href="#/me" id="stuPw">${me.needs_password ? 'Create a password' : 'Change password'}</a>`}</div></aside>
    <div class="main">
      <header class="topbar"><div class="title"><button class="menu-btn" id="menu" aria-label="Open menu">${icon('menu', 22)}</button><span class="title-text">Behavior Tracker Command Center</span></div>
        <div class="right-side">
          ${staff ? h`<label for="yearsel" class="hidden">School year</label><select class="year-select" id="yearsel">${me.years.map((y) => h`<option value="${y}" ${y === state.year ? raw('selected') : ''}>${y}</option>`)}</select>` : ''}
          ${staff ? '' : h`<button class="top-btn" id="leaveClass" type="button">${icon('drop', 18)}<span class="top-btn-text">Restroom / Water</span></button>`}<span class="role-label">${who}</span><button class="signout" id="signout">Sign out</button><span class="pill-status" id="sync-pill">\u2713 Synced</span></div></header>
      <main class="page" id="page" tabindex="-1"></main></div></div>`);
  drawNav();
  wireNavEditing();
  $('#menu', root).addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $('#sidebar', root).addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('menu-open'); });
  $('#signout', root).addEventListener('click', async () => { try { await api('/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } state.me = null; showLogin(); });
  const sp = $('#stuPw', root);
  if (sp) sp.addEventListener('click', (e) => { e.preventDefault(); studentPasswordModal(); });
  const lc = $('#leaveClass', root);
  if (lc) lc.addEventListener('click', () => openBreakModal());
  const ys = $('#yearsel', root);
  if (ys) ys.addEventListener('change', () => { state.year = ys.value; route(); });
}

const STAFF_ROUTES = {
  dashboard: (el) => S.dashboard(el), record: (el) => S.record(el), monthly: (el) => S.monthly(el),
  'reward-report': (el) => S.rewardReport(el), p5: (el) => P.p5(el), store: (el) => P.storeStaff(el),
  rewards: (el) => rewardsStaff(el), classes: (el) => classesList(el), breaks: (el) => breaksStaff(el), admin: (el) => admin(el), 'pin-sheet': (el) => pinSheet(el),
  password: (el) => passwordPage(el),
};
const STUDENT_ROUTES = { me: studentHome, shop: studentStore, seat: studentSeat, classes: studentClasses, timer: studentTimer };

async function route() {
  if (!state.me) return;
  const staff = state.me.type === 'staff';
  const path = (location.hash.replace(/^#\/?/, '').split('?')[0]) || (staff ? 'dashboard' : 'me');
  const page = $('#page', root);
  if (!page) return;
  state.leaveGuard = null; window.onbeforeunload = null;
  markActive();
  try {
    if (staff) {
      const g = /^grade\/([678])$/.exec(path);
      if (path === 'monthly') { location.hash = '#/reports/monthly'; return; }
      const rp = /^reports(?:\/(6|7|8|monthly|reward))?$/.exec(path);
      const cd = /^class\/(\d+)$/.exec(path);
      if (g) location.hash = `#/reports/${g[1]}`;
      else if (rp) await reportsPage(page, rp[1] || '6');
      else if (cd) await classDetail(page, Number(cd[1]));
      else if (STAFF_ROUTES[path] && !(path === 'admin' && state.me.user.role !== 'admin') && !(path === 'pin-sheet' && state.me.user.role !== 'admin')) await STAFF_ROUTES[path](page);
      else location.hash = '#/dashboard';
    } else if (STUDENT_ROUTES[path]) {
      // A student who is out of class always lands on the timer until they are back.
      if (path !== 'timer' && (await api('/student/break')).active) { location.hash = '#/timer'; return; }
      await STUDENT_ROUTES[path](page);
    }
    else location.hash = '#/me';
    window.scrollTo(0, 0);
  } catch (e) { fail(e); mount(page, h`<div class="card"><div class="empty"><strong>Couldn\u2019t load this page</strong>${e.message}</div></div>`); }
}

// Behavior Reports: the 6th, 7th and 8th grade lists live here as tabs, next to the monthly and Rewards Day reports.
const REPORT_TABS = [['6', '6th Grade'], ['7', '7th Grade'], ['8', '8th Grade'], ['monthly', 'Monthly Report'], ['reward', 'Reward Day Report']];
async function reportsPage(el, tab) {
  mount(el, h`<nav class="tabs tab-links no-print" aria-label="Behavior reports">${REPORT_TABS.map(([k, label]) => h`<a href="#/reports/${k}" ${k === tab ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav><div id="tabbody"></div>`);
  const body = $('#tabbody', el);
  if (tab === 'monthly') await S.monthly(body);
  else if (tab === 'reward') await S.rewardReport(body);
  else await S.grade(body, Number(tab));
}

// Students make their own password. Until they do, the PIN from school is their password.
function studentPasswordModal() {
  const first = state.me.needs_password;
  const m = modal(first ? 'Create your own password' : 'Change your password', h`
    <p class="muted">${first ? 'Pick a password only you know. After this, you sign in with your student ID and your new password, and the PIN stops working.' : 'You will be signed out and asked to sign in with your new password.'}</p>
    <div class="field"><label for="sp_c">${first ? 'Your PIN from school' : 'Current password'}</label><input type="password" id="sp_c" autocomplete="current-password" maxlength="200"></div>
    <div class="field"><label for="sp_n">New password (8 or more characters)</label><input type="password" id="sp_n" autocomplete="new-password" maxlength="200"></div>
    <div class="field"><label for="sp_n2">Type the new password again</label><input type="password" id="sp_n2" autocomplete="new-password" maxlength="200"></div>
    <div class="row"><button class="btn primary" id="sp_go" type="button">Save password</button>${first ? h`<button class="btn" id="sp_later" type="button">Maybe later</button>` : ''}</div>
    <div class="error-text" id="sp_err" role="alert"></div>`);
  const b = m.body;
  const later = $('#sp_later', b);
  if (later) later.addEventListener('click', () => m.close());
  const go = async () => {
    const err = $('#sp_err', b);
    err.textContent = '';
    if ($('#sp_n', b).value !== $('#sp_n2', b).value) { err.textContent = 'The two new passwords do not match.'; return; }
    try {
      await api('/student/password', { method: 'POST', body: { current: $('#sp_c', b).value, next: $('#sp_n', b).value } });
      m.close(); state.me = null; showLogin('Password saved. Sign in with your student ID and your new password.');
    } catch (e) { err.textContent = e.message; }
  };
  $('#sp_go', b).addEventListener('click', go);
  $$('input', b).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
}

function passwordPage(el) {
  mount(el, h`<div class="page-head"><div><h1>Change password</h1><p class="muted">Use at least 12 characters. You\u2019ll be signed out and asked to sign in again.</p></div></div>
    <div class="card maxw480"><div class="field"><label for="pw_c">Current password</label><input type="password" id="pw_c" autocomplete="current-password"></div>
      <div class="field"><label for="pw_n">New password</label><input type="password" id="pw_n" autocomplete="new-password"></div>
      <button class="btn primary" id="pw_go">Change password</button><div class="error-text" id="pw_err" role="alert"></div></div>`);
  $('#pw_go', el).addEventListener('click', async () => {
    try { await api('/me/password', { method: 'POST', body: { current: $('#pw_c', el).value, next: $('#pw_n', el).value } }); state.me = null; showLogin('Password changed. Please sign in again.'); }
    catch (e) { $('#pw_err', el).textContent = e.message; }
  });
}

// ---------------------------------------------------------------------------------------
async function boot() {
  try {
    state.me = await api('/me');
  } catch (e) {
    state.me = null;
    if (e.status === 401) return showLogin();
    mount(root, h`<div class="login-wrap"><div class="login-card"><h1>Can\u2019t load the site</h1><p>${e.message}</p><button class="btn primary" id="retry">Try again</button></div></div>`);
    $('#retry', root).addEventListener('click', () => location.reload());
    return;
  }
  state.year = state.me.type === 'staff' ? state.me.school_year : null;
  shell();
  if (state.me.type === 'student' && state.me.needs_password) setTimeout(studentPasswordModal, 400);
  if (!location.hash || location.hash === '#') location.hash = state.me.type === 'staff' ? '#/dashboard' : '#/me';
  route();
}

document.addEventListener('click', async (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || !state.leaveGuard) return;
  const msg = state.leaveGuard();
  if (!msg) return;
  e.preventDefault();
  if (await confirmBox(msg, { ok: 'Leave without saving', danger: true })) { state.leaveGuard = null; window.onbeforeunload = null; location.hash = a.getAttribute('href'); }
}, true);
window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => { if (state.me) { state.me = null; showLogin('You were signed out. Please sign in again.'); } });
boot();
