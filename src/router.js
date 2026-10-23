import { HttpError, json, readJson } from './lib/util.js';
import { loadSession } from './lib/auth.js';

export const routes = [];

// auth: 'none' | 'any' | 'staff' | 'admin' | 'student'
export function add(method, pattern, auth, handler, opts = {}) {
  const keys = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$');
  routes.push({ method, re, keys, auth, handler, opts });
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  try {
    const unsafe = !['GET', 'HEAD'].includes(request.method);
    if (unsafe && !sameOrigin(request, url)) throw new HttpError(403, 'Cross-site request blocked.');

    let matched = null;
    let params = {};
    let pathMatchedOtherMethod = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (r.method !== request.method) {
        pathMatchedOtherMethod = true;
        continue;
      }
      matched = r;
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
    if (!matched) throw new HttpError(pathMatchedOtherMethod ? 405 : 404, pathMatchedOtherMethod ? 'Method not allowed.' : 'Not found.');

    const c = { request, env, url, params, ip: request.headers.get('cf-connecting-ip') || 'unknown', session: null, body: {} };

    if (matched.auth !== 'none') {
      c.session = await loadSession(request, env);
      if (!c.session) throw new HttpError(401, 'Please sign in.');
      const t = c.session.type;
      if (matched.auth === 'staff' && t !== 'staff') throw new HttpError(403, 'Staff only.');
      if (matched.auth === 'admin' && !(t === 'staff' && c.session.user.role === 'admin')) throw new HttpError(403, 'Admins only.');
      if (matched.auth === 'student' && t !== 'student') throw new HttpError(403, 'Students only.');
    }
    c.user = c.session && c.session.type === 'staff' ? c.session.user : null;
    c.student = c.session && c.session.type === 'student' ? c.session.student : null;
    c.actor = c.user ? `staff:${c.user.email}` : c.student ? `student:${c.student.student_id}` : `anon:${c.ip}`;

    if (unsafe) c.body = await readJson(request, matched.opts.maxBytes || 1_000_000);

    const out = await matched.handler(c);
    return out instanceof Response ? out : json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
    // Log the message only: never log request bodies or student data.
    console.error('API error:', err && err.message ? err.message : 'unknown');
    return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
  }
}
