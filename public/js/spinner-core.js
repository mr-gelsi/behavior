// Name-spinner math. No page code in here, so it can be tested on its own.
//
// Geometry: the pointer is at the top of the wheel. Slice i covers wheel angles
// [i * step, (i + 1) * step), measured clockwise from the top. When the wheel has been
// turned clockwise by `rotation` radians, the slice under the pointer is the one that
// contains wheel angle (-rotation) modulo a full turn.

export const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;

export function cryptoRandom() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296; // [0, 1)
}

// A fair random whole number in [0, n). Without a custom rng it uses the browser's secure
// random numbers with rejection sampling, so no name is even slightly more likely than another.
export function randomInt(n, rng) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive whole number');
  if (rng) return Math.min(n - 1, Math.floor(rng() * n));
  const limit = Math.floor(4294967296 / n) * n;
  const b = new Uint32Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= limit);
  return b[0] % n;
}

export function sliceAtPointer(rotation, n) {
  return Math.floor(mod(-rotation, TAU) / (TAU / n)) % n;
}

// The rotation that finishes with slice `index` under the pointer, after `turns` extra full spins.
// It stops somewhere inside the slice (never right on an edge).
export function targetRotation(index, n, current, rng = cryptoRandom, turns = 6) {
  const step = TAU / n;
  const inside = 0.15 + 0.7 * rng();
  const want = mod(-(index + inside) * step, TAU);
  return current + turns * TAU + mod(want - current, TAU);
}
