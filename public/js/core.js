// Shared front-end helpers. No third-party code: everything is served from this site.

export const state = { me: null, year: null, categories: null };

// ---- Safe HTML templating: values are escaped unless wrapped with raw() -------------------
class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
export function h(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += part(vals[i]); });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Sizes come from data attributes and are applied through the CSS object model,
// which keeps the strict Content-Security-Policy (no inline styles) intact.
export function applyDynamic(root) {
  $$('[data-w]', root).forEach((e) => { e.style.width = Math.max(0, Math.min(100, Number(e.dataset.w))) + '%'; });
  $$('[data-h]', root).forEach((e) => { e.style.height = Math.max(0, Math.min(100, Number(e.dataset.h))) + '%'; });
}
export function mount(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : String(content);
  applyDynamic(el);
}

// ---- API ----------------------------------------------------------------------------------
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    setOnline(false);
    throw new Error('Can\u2019t reach the server. Check your connection and try again.');
  }
  setOnline(true);
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    if (res.status === 401 && state.me && path !== '/login') window.dispatchEvent(new Event('session-expired'));
    throw err;
  }
  return data;
}
function setOnline(ok) {
  const p = document.getElementById('sync-pill');
  if (!p) return;
  p.textContent = ok ? '\u2713 Synced' : 'Offline';
  p.classList.toggle('offline', !ok);
}

// ---- Toasts, dialogs -----------------------------------------------------------------------
export function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
}
export const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong.', 'err');

export function modal(title, body, { wide = false } = {}) {
  const d = document.createElement('dialog');
  if (wide) d.style.width = 'min(980px, 96vw)';
  d.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const x = document.createElement('button');
  x.className = 'x-btn';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '\u00d7';
  head.append(h2, x);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  mount(bodyEl, body);
  d.append(head, bodyEl);
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  x.addEventListener('click', close);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
  return { el: d, body: bodyEl, close, setBody: (c) => mount(bodyEl, c) };
}

export function confirmBox(message, { ok = 'Confirm', danger = false, title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    const m = modal(title, h`<p>${message}</p>
      <div class="row end"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${ok}</button></div>`);
    $('[data-no]', m.el).addEventListener('click', () => { m.close(); resolve(false); });
    $('[data-yes]', m.el).addEventListener('click', () => { m.close(); resolve(true); });
    $('[data-yes]', m.el).focus();
  });
}

// ---- Formatters ----------------------------------------------------------------------------
export const ordinal = (g) => `${g}${g === 6 ? 'th' : g === 7 ? 'th' : 'th'}`;
export const fmtDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const fmtMD = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '');
export const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const toLocalInput = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const signed = (n) => (n > 0 ? '+' + n : String(n));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function catChip(c, name, emoji) {
  return h`<span class="chip c${c}">${emoji || ''} ${name}</span>`;
}

// ---- Query string in the hash route: #/record?student=1001 ---------------------------------
export function hashQuery() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

// ---- CSV -----------------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

export function csvEscape(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function downloadCsv(filename, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Dates like 3/17/2026 or 2026-03-17 -> 2026-03-17. Returns null if unreadable.
export function normDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

// ---- Student picker (type-ahead) -----------------------------------------------------------
export function studentPicker(root, { multi = false, placeholder = 'Search by last name, first name, or ID', onChange = () => {} } = {}) {
  const selected = new Map();
  root.classList.add('picker');
  mount(root, h`<input type="search" autocomplete="off" placeholder="${placeholder}" aria-label="Search students">
    <div class="results hidden" role="listbox"></div><div class="chips"></div><div class="picked"></div>`);
  const input = $('input', root), results = $('.results', root), chips = $('.chips', root), picked = $('.picked', root);
  let timer = null, seq = 0;

  function paint() {
    if (multi) {
      mount(chips, h`${[...selected.values()].map((s) => h`<span class="chip removable">${s.last_name}, ${s.first_name} <span class="muted">(${s.grade})</span>
        <button type="button" data-rm="${s.student_id}" aria-label="Remove ${s.first_name} ${s.last_name}">\u00d7</button></span>`)}`);
    } else {
      const s = [...selected.values()][0];
      mount(picked, s ? h`<div class="picked-card"><div><strong>${s.first_name} ${s.last_name}</strong>
        <div class="muted small">ID ${s.student_id} \u2022 Grade ${s.grade}${s.homeroom_teacher ? ' \u2022 ' + s.homeroom_teacher : ''}</div></div>
        <button type="button" class="btn small" data-clear>Change</button></div>` : h``);
      input.classList.toggle('hidden', !!s);
    }
    onChange([...selected.values()]);
  }
  function choose(s) {
    if (!multi) selected.clear();
    selected.set(s.student_id, s);
    input.value = ''; results.classList.add('hidden');
    paint();
    if (multi) input.focus();
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const { students } = await api('/students/search?q=' + encodeURIComponent(q));
        if (mine !== seq) return;
        results.classList.remove('hidden');
        mount(results, students.length
          ? h`${students.map((s) => h`<button type="button" role="option" data-id="${s.student_id}"><span>${s.last_name}, ${s.first_name}</span><span class="muted">Gr ${s.grade} \u2022 ${s.student_id}</span></button>`)}`
          : h`<div class="none">No student matches \u201c${q}\u201d.</div>`);
        $$('button', results).forEach((b) => b.addEventListener('click', () => choose(students.find((s) => String(s.student_id) === b.dataset.id))));
      } catch (e) { fail(e); }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const b = $('button', results); if (b) b.click(); }
    if (e.key === 'Escape') results.classList.add('hidden');
  });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { selected.delete(Number(rm.dataset.rm)); paint(); }
    if (e.target.closest('[data-clear]')) { selected.clear(); paint(); input.focus(); }
  });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) results.classList.add('hidden'); });
  paint();
  return {
    get: () => [...selected.values()],
    add: (s) => choose(s),
    addMany: (list) => { list.forEach((s) => selected.set(s.student_id, s)); paint(); },
    clear: () => { selected.clear(); paint(); },
    focus: () => input.focus(),
  };
}

export async function loadCategories() {
  if (!state.categories) state.categories = (await api('/p5/categories')).categories;
  return state.categories;
}
