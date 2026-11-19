// Outline icons (24x24, drawn with a 1.8 stroke so they match the clean look of the site).
// They are inline SVG, so they take the colour of the surrounding text.
import { raw } from './core.js';

const P = {
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/>',
  record: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  reports: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  monthly: '<rect x="3" y="4.5" width="18" height="17" rx="2.2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  gift: '<rect x="3" y="8" width="18" height="4.5" rx="1.2"/><path d="M12 8v13M19.5 12.5V21h-15v-8.5"/><path d="M7.5 8a2.4 2.4 0 0 1 0-4.8C11 3.2 12 8 12 8s1-4.8 4.5-4.8a2.4 2.4 0 0 1 0 4.8"/>',
  star: '<path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z"/>',
  store: '<path d="M6 2.5 3 6.5V20a1.8 1.8 0 0 0 1.8 1.8h14.4A1.8 1.8 0 0 0 21 20V6.5l-3-4z"/><path d="M3 6.5h18"/><path d="M16 10.5a4 4 0 0 1-8 0"/>',
  ticket: '<path d="M2.5 9.5a2.8 2.8 0 0 1 0 5.6V18a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1v-2.9a2.8 2.8 0 0 1 0-5.6V6.5a1 1 0 0 0-1-1h-17a1 1 0 0 0-1 1z"/><path d="M14 5.5v2.2M14 10.9v2.2M14 16.3v2.2"/>',
  classes: '<path d="M3 21h18"/><path d="M5 21V9.5l7-5.5 7 5.5V21"/><path d="M9.5 21v-6h5v6"/>',
  admin: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.2 2.2M9 2.5h6M12 2.5v3"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 21h18"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5 20 3.5M16.5 7l3 3"/>',
  drop: '<path d="M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z"/>',
  person: '<circle cx="12" cy="5" r="2.3"/><path d="M8.7 21v-6H7.2l1.6-6.2a2 2 0 0 1 1.9-1.5h2.6a2 2 0 0 1 1.9 1.5l1.6 6.2h-1.5v6"/>',
  alert: '<path d="M12 3.5 2.4 20h19.2z"/><path d="M12 10v4.2M12 17.4v.2"/>',
  up: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down: '<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>',
  chip: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M9 10v9M15 10v9M9 14.5h6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 3v12M7 10.5 12 15.5l5-5"/><path d="M4 20h16"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-1.2A5 5 0 0 1 7.5 14.5h3a5 5 0 0 1 5 4.8v1.2"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8a5 5 0 0 1 3.5 4.5v1.2"/>',
  steps: '<path d="M4 20h5v-5h5v-5h6"/><path d="M4 20V4"/>',
};

export const icon = (name, size = 20) =>
  raw(`<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.dashboard}</svg>`);

// Trophies and medals. Colours are plain attributes (no inline styles) so they work under the strict CSP.
const TIERS = {
  gold: ['#f2b01e', '#ffe082', '#9a6400'], silver: ['#9ca7b6', '#e8ecf2', '#566273'],
  bronze: ['#c27a3f', '#f0bf8f', '#74410f'], platinum: ['#5b8def', '#d4e3ff', '#24479f'], none: ['#cfd5de', '#f1f3f7', '#98a1b0'],
};
export const trophy = (tier, size = 72) => {
  const [m, l, d] = TIERS[tier] || TIERS.none;
  return raw(`<svg class="trophy" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${tier || 'locked'} trophy">
    <path d="M17 11H8v5a11 11 0 0 0 11 11M47 11h9v5a11 11 0 0 1-11 11" fill="none" stroke="${d}" stroke-width="3" stroke-linecap="round"/>
    <path d="M17 6h30v17a15 15 0 0 1-30 0z" fill="${m}" stroke="${d}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M22 11v11a10 10 0 0 0 4 8" fill="none" stroke="${l}" stroke-width="3" stroke-linecap="round"/>
    <path d="M32 12.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" fill="${l}" stroke="${d}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M28 38h8v8h-8z" fill="${m}" stroke="${d}" stroke-width="2"/>
    <rect x="19" y="46" width="26" height="9" rx="2.5" fill="${m}" stroke="${d}" stroke-width="2.2"/>
    <path d="M24 50.5h16" stroke="${l}" stroke-width="2" stroke-linecap="round"/></svg>`);
};
export const medal = (tier, label, size = 86) => {
  const [m, l, d] = TIERS[tier] || TIERS.none;
  const txt = tier ? '#ffffff' : '#98a1b0';
  return raw(`<svg class="medal" viewBox="0 0 80 100" width="${size}" height="${Math.round(size * 1.25)}" role="img" aria-label="${tier || 'locked'} badge: ${label}">
    <path d="M24 56 14 94l16-8 8 12 8-40z" fill="${d}" opacity=".85"/><path d="M56 56l10 38-16-8-8 12-8-40z" fill="${m}" stroke="${d}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="40" cy="36" r="31" fill="${m}" stroke="${d}" stroke-width="3"/>
    <circle cx="40" cy="36" r="24.5" fill="none" stroke="${l}" stroke-width="2.5"/>
    <text x="40" y="${String(label).length > 2 ? 46 : 47}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${String(label).length > 2 ? 22 : 30}" fill="${txt}">${label}</text></svg>`);
};
