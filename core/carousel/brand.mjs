// brand.json schema, lookup order and the default brand.
// Lookup order: explicit argument, then ./brand.json in the working folder, then <kit home>/brand.json, then the default.
// A brand file can be partial. Missing parts come from the default brand.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { kitHome } from '../util/fs.mjs';
import { FONT_NAMES, resolveFontName } from './fonts.mjs';

/** @typedef {import('../types.mjs').BrandConfig} BrandConfig */

/** Thrown for anything the person can fix: a bad brand file, a missing image, a field that is too long. */
export class CarouselError extends Error {
  /** @param {string} message @param {string[]} [issues] */
  constructor(message, issues = [message]) {
    super(message);
    this.name = 'CarouselError';
    this.issues = issues;
  }
}

/** @type {BrandConfig} */
export const DEFAULT_BRAND = Object.freeze({
  name: 'Your Brand',
  handle: '@yourhandle',
  colors: Object.freeze({ bg: '#F5EFE3', fg: '#1C1B18', accent: '#D9441C', muted: '#6B655A' }),
  fonts: Object.freeze({ heading: 'Fraunces', body: 'Inter' }),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must look like #1A2B3C');

/** Shape of a (possibly partial) brand.json. */
export const brandSchema = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  handle: z.string().trim().min(1).max(30).optional(),
  colors: z
    .object({ bg: hex.optional(), fg: hex.optional(), accent: hex.optional(), muted: hex.optional() })
    .strict()
    .optional(),
  fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).strict().optional(),
  logo: z.string().optional(),
});

/**
 * Fill a partial brand from the default and check it. Throws CarouselError with plain sentences.
 * @param {any} input
 * @param {string} [label]  Where it came from, for messages.
 * @returns {BrandConfig}
 */
export function normalizeBrand(input, label = 'brand') {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new CarouselError(`The ${label} must be an object with name, handle, colors and fonts.`);
  }
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const where = i.path.length ? i.path.join('.') : label;
      if (i.code === 'unrecognized_keys') {
        return `The ${label} has an unknown field (${i.keys.join(', ')}). Use name, handle, colors, fonts and logo.`;
      }
      return `The ${label} field "${where}" ${i.message.charAt(0).toLowerCase()}${i.message.slice(1)}.`;
    });
    throw new CarouselError(issues.join(' '), issues);
  }
  const b = parsed.data;
  /** @type {Record<string, string>} */
  const fonts = { ...DEFAULT_BRAND.fonts };
  for (const role of /** @type {const} */ (['heading', 'body'])) {
    const given = b.fonts?.[role];
    if (given === undefined) continue;
    const name = resolveFontName(given);
    if (!name) {
      throw new CarouselError(`The ${label} font "${given}" is not available. Pick one of: ${FONT_NAMES.join(', ')}.`);
    }
    fonts[role] = name;
  }
  /** @type {BrandConfig} */
  const out = {
    name: b.name ?? DEFAULT_BRAND.name,
    handle: b.handle ?? DEFAULT_BRAND.handle,
    colors: {
      bg: (b.colors?.bg ?? DEFAULT_BRAND.colors.bg).toUpperCase(),
      fg: (b.colors?.fg ?? DEFAULT_BRAND.colors.fg).toUpperCase(),
      accent: (b.colors?.accent ?? DEFAULT_BRAND.colors.accent).toUpperCase(),
      muted: (b.colors?.muted ?? DEFAULT_BRAND.colors.muted).toUpperCase(),
    },
    fonts: /** @type {BrandConfig['fonts']} */ (fonts),
  };
  if (b.logo) out.logo = b.logo;
  return out;
}

/** The places brand.json is looked for, in order. */
export function brandSearchPaths(cwd = process.cwd()) {
  return [join(cwd, 'brand.json'), join(kitHome(), 'brand.json')];
}

/**
 * @param {string} file
 * @returns {BrandConfig}
 */
export function readBrandFile(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const why = /** @type {Error} */ (err).message;
    throw new CarouselError(`Could not read the brand file ${file}: ${why}`);
  }
  const brand = normalizeBrand(raw, `brand file ${file}`);
  // A relative logo path is relative to the brand file.
  if (brand.logo) brand.logo = resolve(dirname(file), brand.logo);
  return brand;
}

/**
 * Pick the brand: explicit (an object or a path to a json file) > ./brand.json > <kit home>/brand.json > default.
 * @param {{explicit?: any, cwd?: string}} [opts]
 * @returns {BrandConfig}
 */
export function loadBrand(opts = {}) {
  const { explicit, cwd } = opts;
  if (explicit !== undefined && explicit !== null) {
    if (typeof explicit === 'string') return readBrandFile(resolve(cwd ?? process.cwd(), explicit));
    return normalizeBrand(explicit);
  }
  for (const file of brandSearchPaths(cwd)) {
    if (existsSync(file)) return readBrandFile(file);
  }
  return normalizeBrand({});
}
