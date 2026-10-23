import { state, api, h, raw, mount, $, $$, toast, fail, modal } from './core.js';
import * as S from './views-staff.js';
import * as P from './views-p5.js';
import { rewardsStaff } from './views-rewards.js';
import { admin, pinSheet } from './views-admin.js';
import { studentHome, studentStore, studentSeat } from './views-student.js';

const root = document.getElementById('root');

// ---------------------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------------------
async function showLogin(message) {
  document.body.classList.remove('menu-open');
  let setup = false;
  try { setup = (await api('/setup/status')).needed; } catch { /* offline */ }
  let kind = 'staff';
  const paint = () => {
    mount(root, h`<div class="login-wrap"><div class="login-card">
      <h1>\ud83d\udcd6 Behavior Tracker</h1>
      ${setup ? h`<p class="muted">Welcome! Create the first Admin account to get started. You\u2019ll need the setup token from your Cloudflare settings.</p>
        <div class="field"><label for="su_t">Setup token</label><input type="password" id="su_t" autocomplete="off"></div>
        <div class="field"><label for="su_n">Your name</label><input type="text" id="su_n" autocomplete="name"></div>
        <div class="field"><label for="su_e">Email</label><input type="email" id="su_e" autocomplete="username"></div>
        <div class="field"><label for="su_p">Password (12 or more characters)</label><input type="password" id="su_p" autocomplete="new-password"></div>
        <button class="btn primary w100" id="go">Create Admin account</button>`
      : h`<p class="muted">Sign in to continue.</p>
        <div class="seg mb16" id="kind" role="group" aria-label="Who is signing in"><button type="button" data-k="staff" aria-pressed="${kind === 'staff'}">Staff</button><button type="button" data-k="student" aria-pressed="${kind === 'student'}">Student</button></div>
        ${kind === 'staff' ? h`<div class="field"><label for="l_e">Email</label><input type="email" id="l_e" autocomplete="username"></div>
          <div class="field"><label for="l_p">Password</label><input type="password" id="l_p" autocomplete="current-password"></div>`
        : h`<div class="field"><label for="l_s">Student ID</label><input type="text" id="l_s" inputmode="numeric" autocomplete="username"></div>
          <div class="field"><label for="l_n">PIN</label><input type="password" id="l_n" inputmode="numeric" autocomplete="current-password" maxlength="6"></div>`}
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
  ['dashboard', '\ud83d\udcca', 'Dashboard'], ['record', '\u270f\ufe0f', 'Record Steps'],
  ['grade/6', '6\ufe0f\u20e3', '6th Grade'], ['grade/7', '7\ufe0f\u20e3', '7th Grade'], ['grade/8', '8\ufe0f\u20e3', '8th Grade'],
  ['monthly', '\ud83d\udcc5', 'Monthly Report'], ['reward-report', '\ud83c\udf81', 'Reward Day Report'],
  ['p5', '\u2b50', 'P5 Points'], ['store', '\ud83d\udecd\ufe0f', 'Store'], ['rewards', '\ud83c\udf9f\ufe0f', 'Rewards Day'],
];
const STUDENT_NAV = [['me', '\ud83c\udfe0', 'My P5'], ['shop', '\ud83d\udecd\ufe0f', 'Store'], ['seat', '\ud83c\udf9f\ufe0f', 'Reserve a Seat']];

function shell() {
  const me = state.me;
  const staff = me.type === 'staff';
  const nav = staff ? [...STAFF_NAV, ...(me.user.role === 'admin' ? [['admin', '\u2699\ufe0f', 'Admin']] : [])] : STUDENT_NAV;
  const who = staff ? me.user.role[0].toUpperCase() + me.user.role.slice(1) : 'Student';
  mount(root, h`<div class="app">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation"><div class="brand">\ud83d\udcd6 BEHAVIOR<br>TRACKER</div>
      <nav class="nav">${nav.map(([path, ico, label]) => h`<a href="#/${path}" data-path="${path}"><span class="ico">${ico}</span>${label}</a>`)}</nav>
      <div class="sidebar-foot">${me.settings.school_name}<br>${staff ? h`<a class="c-inherit" href="#/password">Change password</a>` : ''}</div></aside>
    <div class="main">
      <header class="topbar"><div class="title"><button class="menu-btn" id="menu" aria-label="Open menu">\u2630</button><span class="title-text">Behavior Tracker Command Center</span></div>
        <div class="right-side">
          ${staff ? h`<label for="yearsel" class="hidden">School year</label><select class="year-select" id="yearsel">${me.years.map((y) => h`<option value="${y}" ${y === state.year ? raw('selected') : ''}>${y}</option>`)}</select>` : ''}
          <span class="muted role-label">${who}</span><button class="signout" id="signout">Sign out</button><span class="pill-status" id="sync-pill">\u2713 Synced</span></div></header>
      <main class="page" id="page" tabindex="-1"></main></div></div>`);
  $('#menu', root).addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $('#sidebar', root).addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('menu-open'); });
  $('#signout', root).addEventListener('click', async () => { try { await api('/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } state.me = null; showLogin(); });
  const ys = $('#yearsel', root);
  if (ys) ys.addEventListener('change', () => { state.year = ys.value; route(); });
}

const STAFF_ROUTES = {
  dashboard: (el) => S.dashboard(el), record: (el) => S.record(el), monthly: (el) => S.monthly(el),
  'reward-report': (el) => S.rewardReport(el), p5: (el) => P.p5(el), store: (el) => P.storeStaff(el),
  rewards: (el) => rewardsStaff(el), admin: (el) => admin(el), 'pin-sheet': (el) => pinSheet(el),
  password: (el) => passwordPage(el),
};
const STUDENT_ROUTES = { me: studentHome, shop: studentStore, seat: studentSeat };

async function route() {
  if (!state.me) return;
  const staff = state.me.type === 'staff';
  const path = (location.hash.replace(/^#\/?/, '').split('?')[0]) || (staff ? 'dashboard' : 'me');
  const page = $('#page', root);
  if (!page) return;
  $$('.nav a', root).forEach((a) => a.classList.toggle('active', a.dataset.path === path || (path === 'pin-sheet' && a.dataset.path === 'admin')));
  try {
    if (staff) {
      const g = /^grade\/([678])$/.exec(path);
      if (g) await S.grade(page, Number(g[1]));
      else if (STAFF_ROUTES[path] && !(path === 'admin' && state.me.user.role !== 'admin') && !(path === 'pin-sheet' && state.me.user.role !== 'admin')) await STAFF_ROUTES[path](page);
      else location.hash = '#/dashboard';
    } else if (STUDENT_ROUTES[path]) await STUDENT_ROUTES[path](page);
    else location.hash = '#/me';
    window.scrollTo(0, 0);
  } catch (e) { fail(e); mount(page, h`<div class="card"><div class="empty"><strong>Couldn\u2019t load this page</strong>${e.message}</div></div>`); }
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
  if (!location.hash || location.hash === '#') location.hash = state.me.type === 'staff' ? '#/dashboard' : '#/me';
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => { if (state.me) { state.me = null; showLogin('You were signed out. Please sign in again.'); } });
boot();
