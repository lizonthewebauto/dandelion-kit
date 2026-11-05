// Saved choices are partial. Missing fields keep the kit's usual defaults.
import { z } from 'zod';
import { brandSchema, normalizeBrand } from '../carousel/brand.mjs';
import { LOOK_IDS, CAPTION_THEMES } from '../types.mjs';

const number = (field, min, max) => z.number().min(min, `${field} must be at least ${min}.`).max(max, `${field} must be at most ${max}.`);
const choice = (values, field) => z.enum(values, { error: `${field} must be one of: ${values.join(', ')}.` });
export const likedSchema = z.array(choice(['colors', 'fonts', 'feel', 'captions', 'pacing', 'opening'], 'liked')).max(6);
export const nameSchema = z.string().trim().min(1, 'name needs at least 1 letter.').max(40, 'name can have at most 40 letters.');
export const notesSchema = z.string().max(400, 'notes can have at most 400 letters.');
export const carouselSchema = z.strictObject({
  radius: choice(['sharp', 'soft', 'round'], 'radius').optional(),
  heading_case: choice(['default', 'upper', 'lower'], 'heading_case').optional(),
  background: choice(['flat', 'soft', 'dots'], 'background').optional(),
  margin: choice(['standard', 'wide', 'tight'], 'margin').optional(),
  rule: choice(['thin', 'bold', 'none'], 'rule').optional(),
});
export const overridesSchema = z.strictObject({
  cut_every_ms_min: number('cut_every_ms_min', 600, 8000).optional(),
  cut_every_ms_max: number('cut_every_ms_max', 900, 12000).optional(),
  sfx_per_minute: number('sfx_per_minute', 0, 8).optional(),
  density_per_10s: z.strictObject({
    min: number('density_per_10s.min', 2, 10).optional(),
    target: number('density_per_10s.target', 2, 10).optional(),
    max: number('density_per_10s.max', 2, 10).optional(),
  }).superRefine((d, ctx) => {
    if ((d.min !== undefined && d.target !== undefined && d.min > d.target) ||
        (d.target !== undefined && d.max !== undefined && d.target > d.max) ||
        (d.min !== undefined && d.max !== undefined && d.min > d.max)) {
      ctx.addIssue({ code: 'custom', message: 'density_per_10s must have min at most target and target at most max.' });
    }
  }).optional(),
  grade: z.strictObject({
    saturation: number('grade.saturation', 0.85, 1.2).optional(),
    contrast: number('grade.contrast', 0.9, 1.2).optional(),
    warmth: number('grade.warmth', -0.15, 0.15).optional(),
  }).optional(),
  camera_aggression: choice(['calm', 'standard', 'bold'], 'camera_aggression').optional(),
}).superRefine((o, ctx) => {
  if (o.cut_every_ms_min !== undefined && o.cut_every_ms_max !== undefined && o.cut_every_ms_max < o.cut_every_ms_min + 300) {
    ctx.addIssue({ code: 'custom', path: ['cut_every_ms_max'], message: 'cut_every_ms_max must be at least cut_every_ms_min plus 300.' });
  }
});
export const videoSchema = z.strictObject({
  base_look: z.enum(LOOK_IDS).optional(),
  caption_theme: z.enum(CAPTION_THEMES).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'accent must look like #1A2B3C.').optional(),
  rough_cut: choice(['gentle', 'standard', 'punchy'], 'rough_cut').optional(),
  overrides: overridesSchema.optional(),
});
export const styleSchema = z.strictObject({
  brand: brandSchema.optional(),
  carousel: carouselSchema.optional(),
  video: videoSchema.optional(),
  liked: likedSchema.optional(),
  notes: notesSchema.optional(),
}).superRefine((s, ctx) => {
  if (!s.brand && !s.carousel && !s.video) ctx.addIssue({ code: 'custom', message: 'style needs at least one part: brand, carousel or video.' });
});

/** @typedef {z.infer<typeof styleSchema>} StyleInput */
/** @typedef {z.infer<typeof carouselSchema>} CarouselTokens */

/** Check the brand without filling in fields the person did not choose. */
export function parseStyle(input) {
  const style = styleSchema.parse(input);
  if (style.brand) {
    const checked = normalizeBrand(style.brand, 'style brand');
    if (style.brand.colors) for (const key of Object.keys(style.brand.colors)) style.brand.colors[key] = checked.colors[key];
    if (style.brand.fonts) for (const key of Object.keys(style.brand.fonts)) style.brand.fonts[key] = checked.fonts[key];
  }
  return style;
}
/** @typedef {z.infer<typeof overridesSchema>} LookOverrides */
