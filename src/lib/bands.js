// Restroom/water warning bands: [15,13,11,8] = green to 15, yellow to 28, orange to 39, red to 47, black above.
export function bandLevel(count, bands) {
  let top = 0;
  for (let i = 0; i < bands.length; i++) { top += bands[i]; if (count <= top) return i; }
  return bands.length;
}
export const BAND_NAMES = ['green', 'yellow', 'orange', 'red', 'black'];
