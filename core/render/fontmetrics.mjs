// A tiny TrueType reader: the family name, and how wide a line of text is at a given size.
// The caption builder uses it to keep every line inside the safe zone before libass ever draws it.
// It reads the cmap (formats 4 and 12) and hmtx tables. Kerning is ignored, so widths are a slight
// over-estimate for some pairs, which is the safe side for a fit check.
import { readFileSync } from 'node:fs';

/**
 * @typedef {object} FontFace
 * @property {string} family
 * @property {string} full_name
 * @property {number} units_per_em
 * @property {number} ascent         Share of the font size above the baseline (from the hhea table).
 * @property {number} descent        Share of the font size below the baseline, as a positive number.
 * @property {(size: number) => number} line_height  Height of one line of text at a size, as libass lays it out.
 * @property {(text: string, size: number, spacing?: number) => number} width   Width in pixels of one line.
 */

/** @type {Map<string, FontFace>} */
const cache = new Map();

/**
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} length
 * @param {boolean} utf16
 */
function decodeName(buf, offset, length, utf16) {
  if (utf16) {
    let out = '';
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(buf.readUInt16BE(offset + i));
    return out;
  }
  return buf.toString('latin1', offset, offset + length);
}

/**
 * Read a .ttf file.
 * @param {string} path
 * @returns {FontFace}
 */
export function loadFontFace(path) {
  const cached = cache.get(path);
  if (cached) return cached;
  const buf = readFileSync(path);
  const numTables = buf.readUInt16BE(4);
  /** @type {Record<string, {offset: number, length: number}>} */
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    };
  }
  const need = (tag) => {
    if (!tables[tag]) throw new Error(`The font ${path} has no ${tag} table.`);
    return tables[tag];
  };
  const unitsPerEm = buf.readUInt16BE(need('head').offset + 18);
  const hhea = need('hhea').offset;
  const ascent = buf.readInt16BE(hhea + 4) / unitsPerEm;
  const descent = -buf.readInt16BE(hhea + 6) / unitsPerEm;
  const numHMetrics = buf.readUInt16BE(hhea + 34);
  const hmtx = need('hmtx').offset;
  const advance = (gid) => buf.readUInt16BE(hmtx + Math.min(gid, numHMetrics - 1) * 4);

  // Names: family (1) and full name (4), Windows English first.
  let family = '';
  let full_name = '';
  if (tables.name) {
    const n = tables.name.offset;
    const count = buf.readUInt16BE(n + 2);
    const stringOffset = n + buf.readUInt16BE(n + 4);
    for (let i = 0; i < count; i++) {
      const r = n + 6 + i * 12;
      const platform = buf.readUInt16BE(r);
      const language = buf.readUInt16BE(r + 4);
      const id = buf.readUInt16BE(r + 6);
      if (id !== 1 && id !== 4) continue;
      if (platform === 3 && language !== 0x409 && language !== 0) continue;
      const text = decodeName(
        buf,
        stringOffset + buf.readUInt16BE(r + 10),
        buf.readUInt16BE(r + 8),
        platform === 3 || platform === 0,
      );
      if (id === 1 && (!family || platform === 3)) family = text;
      if (id === 4 && (!full_name || platform === 3)) full_name = text;
    }
  }

  // cmap: pick a Unicode subtable.
  const cmap = need('cmap').offset;
  const subCount = buf.readUInt16BE(cmap + 2);
  /** @type {number | null} */
  let sub = null;
  let best = -1;
  for (let i = 0; i < subCount; i++) {
    const platform = buf.readUInt16BE(cmap + 4 + i * 8);
    const encoding = buf.readUInt16BE(cmap + 6 + i * 8);
    const off = cmap + buf.readUInt32BE(cmap + 8 + i * 8);
    const format = buf.readUInt16BE(off);
    const score =
      (platform === 3 && encoding === 10 ? 4 : 0) +
      (platform === 3 && encoding === 1 ? 3 : 0) +
      (platform === 0 ? 2 : 0) +
      (format === 12 ? 1 : 0);
    if ((format === 4 || format === 12) && score > best) {
      best = score;
      sub = off;
    }
  }
  if (sub === null) throw new Error(`The font ${path} has no Unicode map.`);
  const format = buf.readUInt16BE(sub);
  /** @type {(cp: number) => number} */
  let glyphFor;
  if (format === 4) {
    const segX2 = buf.readUInt16BE(sub + 6);
    const segCount = segX2 / 2;
    const endCodes = sub + 14;
    const startCodes = endCodes + segX2 + 2;
    const deltas = startCodes + segX2;
    const rangeOffsets = deltas + segX2;
    glyphFor = (cp) => {
      if (cp > 0xffff) return 0;
      for (let s = 0; s < segCount; s++) {
        if (cp > buf.readUInt16BE(endCodes + s * 2)) continue;
        const start = buf.readUInt16BE(startCodes + s * 2);
        if (cp < start) return 0;
        const delta = buf.readInt16BE(deltas + s * 2);
        const ro = buf.readUInt16BE(rangeOffsets + s * 2);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = buf.readUInt16BE(rangeOffsets + s * 2 + ro + (cp - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    };
  } else {
    const groups = buf.readUInt32BE(sub + 12);
    glyphFor = (cp) => {
      for (let g = 0; g < groups; g++) {
        const r = sub + 16 + g * 12;
        const start = buf.readUInt32BE(r);
        const end = buf.readUInt32BE(r + 4);
        if (cp >= start && cp <= end) return buf.readUInt32BE(r + 8) + (cp - start);
      }
      return 0;
    };
  }

  /** @type {Map<number, number>} */
  const advances = new Map();
  const advanceFor = (cp) => {
    let a = advances.get(cp);
    if (a === undefined) {
      a = advance(glyphFor(cp));
      advances.set(cp, a);
    }
    return a;
  };
  /** @type {FontFace} */
  const face = {
    family,
    full_name,
    units_per_em: unitsPerEm,
    ascent,
    descent,
    line_height: (size) => (ascent + descent) * size,
    width(text, size, spacing = 0) {
      let units = 0;
      let count = 0;
      for (const ch of text) {
        units += advanceFor(/** @type {number} */ (ch.codePointAt(0)));
        count += 1;
      }
      return (units / unitsPerEm) * size + spacing * count;
    },
  };
  cache.set(path, face);
  return face;
}
