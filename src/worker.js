// Cloudflare Worker entry point: API + static site, with security headers on everything.
import { handleApi } from './router.js';
import { runScheduled } from './lib/rewards.js';
import { json } from './lib/util.js';

import './routes/auth.js';
import './routes/students.js';
import './routes/reports.js';
import './routes/p5.js';
import './routes/store.js';
import './routes/rewards.js';
import './routes/student.js';
import './routes/admin.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function secure(response) {
  const h = new Headers(response.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.DB) return secure(json({ error: 'The database is not connected. See the README.' }, 500));
      return secure(await handleApi(request, env));
    }
    if (!['GET', 'HEAD'].includes(request.method)) return secure(new Response('Method not allowed', { status: 405 }));
    return secure(await env.ASSETS.fetch(request));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};
