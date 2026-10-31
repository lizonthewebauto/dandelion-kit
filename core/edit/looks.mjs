// The five looks. A look is a named bundle of pacing, captions, camera, sound and color, so a different edit
// is a different way of cutting and not just a new font. Data only, plus two small lookups.
import { LOOK_IDS, CAPTION_THEMES, SFX_NAMES } from '../types.mjs';

/**
 * @type {Readonly<Record<string, import('../types.mjs').Look>>}
 */
export const LOOKS = Object.freeze({
  'karaoke-clean': Object.freeze({
    id: 'karaoke-clean',
    name: 'Karaoke clean',
    summary: 'Words light up as you say them. Clean punch-ins and a light touch of sound. The safe default.',
    caption_theme: 'karaoke-highlight',
    camera_aggression: 'standard',
    cut_every_ms_min: 1800,
    cut_every_ms_max: 3200,
    sfx_per_minute: 3,
    density_per_10s: Object.freeze({ min: 4, target: 6, max: 8 }),
    grade: Object.freeze({ saturation: 1.05, contrast: 1.05, warmth: 0 }),
    accent: '#FFD93D',
  }),
  'bold-value': Object.freeze({
    id: 'bold-value',
    name: 'Bold value',
    summary: 'Big stroked words, tight cuts and hard punch-ins. For tips that should feel packed.',
    caption_theme: 'bold-stroke',
    camera_aggression: 'bold',
    cut_every_ms_min: 1200,
    cut_every_ms_max: 2600,
    sfx_per_minute: 4,
    density_per_10s: Object.freeze({ min: 5, target: 7, max: 8 }),
    grade: Object.freeze({ saturation: 1.08, contrast: 1.12, warmth: 0 }),
    accent: '#FFD93D',
  }),
  'minimal-educator': Object.freeze({
    id: 'minimal-educator',
    name: 'Minimal educator',
    summary: 'Plain sentence captions, slow pushes and quiet sound. For teaching and calm explainers.',
    caption_theme: 'clean-minimal',
    camera_aggression: 'calm',
    cut_every_ms_min: 2600,
    cut_every_ms_max: 4500,
    sfx_per_minute: 2,
    density_per_10s: Object.freeze({ min: 4, target: 4, max: 6 }),
    grade: Object.freeze({ saturation: 1.05, contrast: 1.05, warmth: 0 }),
    accent: '#7DD3FC',
  }),
  'editorial-luxe': Object.freeze({
    id: 'editorial-luxe',
    name: 'Editorial luxe',
    summary: 'Serif captions, room to breathe and a cool, quiet color. For brands that want to feel calm and premium.',
    caption_theme: 'editorial-serif',
    camera_aggression: 'calm',
    cut_every_ms_min: 2800,
    cut_every_ms_max: 5000,
    sfx_per_minute: 2,
    density_per_10s: Object.freeze({ min: 4, target: 4, max: 6 }),
    grade: Object.freeze({ saturation: 0.92, contrast: 1.05, warmth: -0.04 }),
    accent: '#F2E3C6',
  }),
  'storytime-energy': Object.freeze({
    id: 'storytime-energy',
    name: 'Storytime energy',
    summary: 'One word at a time in the middle of the screen, a warm color and a push at every twist.',
    caption_theme: 'one-word-pop',
    camera_aggression: 'bold',
    cut_every_ms_min: 1500,
    cut_every_ms_max: 3000,
    sfx_per_minute: 4,
    density_per_10s: Object.freeze({ min: 5, target: 7, max: 8 }),
    grade: Object.freeze({ saturation: 1.12, contrast: 1.06, warmth: 0.12 }),
    accent: '#FF9F1C',
  }),
});

/**
 * Which sound effects each look draws from. Only names the synth makes are allowed.
 * @type {Readonly<Record<string, readonly (typeof SFX_NAMES)[number][]>>}
 */
export const LOOK_SFX_PALETTE = Object.freeze({
  'karaoke-clean': ['pop', 'whoosh', 'ding'],
  'bold-value': ['bass-hit', 'pop', 'whoosh', 'riser'],
  'minimal-educator': ['tap', 'ding'],
  'editorial-luxe': ['page', 'snap'],
  'storytime-energy': ['whoosh', 'pop', 'riser', 'bass-hit'],
});

/** The look used when none is named. */
export const DEFAULT_LOOK_ID = LOOK_IDS[0];

/** All five looks, in picker order. */
export function listLooks() {
  return LOOK_IDS.map((id) => LOOKS[id]);
}

/**
 * Find a look by id, with optional changes to its caption theme and accent color.
 * @param {string} [id]
 * @param {{caption_theme?: string, accent?: string}} [overrides]
 * @returns {import('../types.mjs').Look}
 */
export function getLook(id = DEFAULT_LOOK_ID, overrides = {}) {
  const base = LOOKS[id];
  if (!base) throw new Error(`Unknown look "${id}". Use one of: ${LOOK_IDS.join(', ')}.`);
  const look = { ...base, grade: { ...base.grade }, density_per_10s: base.density_per_10s ? { ...base.density_per_10s } : undefined };
  if (overrides.caption_theme !== undefined) {
    if (!CAPTION_THEMES.includes(/** @type {any} */ (overrides.caption_theme))) {
      throw new Error(`Unknown caption theme "${overrides.caption_theme}". Use one of: ${CAPTION_THEMES.join(', ')}.`);
    }
    look.caption_theme = /** @type {any} */ (overrides.caption_theme);
  }
  if (overrides.accent !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(overrides.accent)) throw new Error('The accent color must look like #RRGGBB.');
    look.accent = overrides.accent.toUpperCase();
  }
  return look;
}

/**
 * Density limits for a look, with the governor's 4, 6 and 8 when the look has none.
 * @param {import('../types.mjs').Look} look
 */
export function densityFor(look) {
  return look.density_per_10s ?? { min: 4, target: 6, max: 8 };
}
