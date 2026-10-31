// Font registry for the carousel renderer. satori needs font buffers and does not honor variable
// font axes, so Inter, Fraunces and Montserrat ship as small static instances in ./fonts
// (cut from the variable files in assets/fonts, Latin letters only). The other fonts load straight from assets/fonts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL = join(HERE, 'fonts');
const ASSETS = join(HERE, '..', '..', 'assets', 'fonts');

/**
 * @typedef {object} FontInfo
 * @property {{path:string, weight:number}[]} files
 * @property {number} width        Average character width as a fraction of the font size (sizes one-line text).
 * @property {number} tracking     Heading letter spacing in em.
 * @property {number} lineHeight   Heading line height.
 * @property {number} size         Heading size multiplier so every font looks about as big.
 * @property {boolean} upper       Headings in capitals.
 */

/** @type {Record<string, FontInfo>} */
export const FONTS = {
  Inter: {
    files: [
      { path: join(LOCAL, 'Inter-Regular.ttf'), weight: 400 },
      { path: join(LOCAL, 'Inter-SemiBold.ttf'), weight: 600 },
      { path: join(LOCAL, 'Inter-ExtraBold.ttf'), weight: 800 },
    ],
    width: 0.52,
    tracking: -0.022,
    lineHeight: 1.06,
    size: 1,
    upper: false,
  },
  Fraunces: {
    files: [
      { path: join(LOCAL, 'Fraunces-Regular.ttf'), weight: 400 },
      { path: join(LOCAL, 'Fraunces-Semibold.ttf'), weight: 600 },
    ],
    width: 0.5,
    tracking: -0.012,
    lineHeight: 1.04,
    size: 1.04,
    upper: false,
  },
  Montserrat: {
    files: [
      { path: join(LOCAL, 'Montserrat-Medium.ttf'), weight: 400 },
      { path: join(LOCAL, 'Montserrat-Bold.ttf'), weight: 600 },
      { path: join(LOCAL, 'Montserrat-ExtraBold.ttf'), weight: 800 },
    ],
    width: 0.6,
    tracking: -0.025,
    lineHeight: 1.06,
    size: 0.92,
    upper: false,
  },
  Anton: {
    files: [{ path: join(ASSETS, 'Anton-Regular.ttf'), weight: 400 }],
    width: 0.42,
    tracking: 0.004,
    lineHeight: 1.02,
    size: 1.3,
    upper: true,
  },
  'Archivo Black': {
    files: [{ path: join(ASSETS, 'ArchivoBlack-Regular.ttf'), weight: 400 }],
    width: 0.64,
    tracking: -0.02,
    lineHeight: 1.04,
    size: 0.9,
    upper: false,
  },
  'Instrument Serif': {
    files: [{ path: join(ASSETS, 'InstrumentSerif-Regular.ttf'), weight: 400 }],
    width: 0.37,
    tracking: -0.01,
    lineHeight: 1.0,
    size: 1.28,
    upper: false,
  },
  'IBM Plex Mono': {
    files: [{ path: join(ASSETS, 'IBMPlexMono-Regular.ttf'), weight: 400 }],
    width: 0.6,
    tracking: -0.04,
    lineHeight: 1.12,
    size: 0.82,
    upper: false,
  },
  'Space Mono': {
    files: [{ path: join(ASSETS, 'SpaceMono-Regular.ttf'), weight: 400 }],
    width: 0.62,
    tracking: -0.04,
    lineHeight: 1.12,
    size: 0.8,
    upper: false,
  },
};

export const FONT_NAMES = Object.freeze(Object.keys(FONTS));

/** Find a registry name from any casing ("fraunces", "ARCHIVO BLACK"). Returns undefined when unknown. */
export function resolveFontName(name) {
  const want = String(name).trim().toLowerCase();
  return FONT_NAMES.find((n) => n.toLowerCase() === want);
}

/** @type {Map<string, Buffer>} */
const buffers = new Map();

/** @param {string} path */
function buffer(path) {
  let b = buffers.get(path);
  if (!b) {
    b = readFileSync(path);
    buffers.set(path, b);
  }
  return b;
}

/**
 * The satori font list for a slide: the named fonts, plus Inter so every glyph has a fallback.
 * @param {string[]} names
 * @returns {any[]}
 */
export function loadFonts(names) {
  const wanted = [...new Set([...names, 'Inter'])];
  /** @type {any[]} */
  const out = [];
  for (const name of wanted) {
    const info = FONTS[name];
    if (!info) throw new Error(`Unknown font "${name}". Pick one of: ${FONT_NAMES.join(', ')}.`);
    for (const f of info.files) out.push({ name, data: buffer(f.path), weight: f.weight, style: 'normal' });
  }
  return out;
}
