// Small color helpers for carousel themes. Colors are "#RRGGBB" strings.

/** @param {string} hex @returns {[number, number, number]} */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`"${hex}" is not a color like #1A2B3C`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number[]} rgb */
export function toHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Blend a toward b. t=0 gives a, t=1 gives b. */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t));
}

/** WCAG relative luminance, 0 to 1. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The first candidate that reads on bg at 4.5:1, else black or white, whichever reads better. */
export function readableOn(bg, candidates) {
  for (const c of candidates) if (contrast(bg, c) >= 4.5) return c;
  return contrast(bg, '#111111') >= contrast(bg, '#FFFFFF') ? '#111111' : '#FFFFFF';
}
