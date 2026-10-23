// Small shared helpers: errors, JSON responses, validation, dates, CSV.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const bad = (message, extra) => new HttpError(400, message, extra);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson(request, maxBytes = 1_000_000) {
  const text = await request.text();
  if (text.length === 0) return {};
  if (text.length > maxBytes) throw new HttpError(413, 'Request is too large.');
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Content-Type must be application/json.');
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw bad('Request body is not valid JSON.');
  }
  if (v === null || typeof v !== 'object') throw bad('Request body must be a JSON object.');
  return v;
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const V = {
  int(v, name, { min = -Infinity, max = Infinity, optional = false } = {}) {
    if (isBlank(v)) {
      if (optional) return null;
      throw bad(`${name} is required.`);
    }
    const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : v;
    if (!Number.isInteger(n) || n < min || n > max) {
      const range = [min > -Infinity ? `at least ${min}` : '', max < Infinity ? `at most ${max}` : '']
        .filter(Boolean)
        .join(' and ');
      throw bad(`${name} must be a whole number${range ? ' (' + range + ')' : ''}.`);
    }
    return n;
  },
  str(v, name, { max = 200, optional = false } = {}) {
    if (isBlank(v)) {
      if (optional) return null;
      throw bad(`${name} is required.`);
    }
    // eslint-disable-next-line no-control-regex
    const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
    return s;
  },
  date(v, name, { optional = false } = {}) {
    if (isBlank(v)) {
      if (optional) return null;
      throw bad(`${name} is required.`);
    }
    if (!isDate(v)) throw bad(`${name} must be a date like 2026-03-17.`);
    return v;
  },
  oneOf(v, name, list) {
    if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}.`);
    return v;
  },
  iso(v, name) {
    if (isBlank(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a valid date and time.`);
    return new Date(v).toISOString();
  },
};

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function schoolYearOf(dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function shiftSchoolYear(sy, delta) {
  const start = Number(sy.slice(0, 4)) + delta;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function todayStr(env, now = new Date()) {
  const tz = (env && env.TIMEZONE) || 'America/Los_Angeles';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection when opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows, columns) {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [head, ...body].join('\n') + '\n';
}

export const fmtMD = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
