import { existsSync, readFileSync } from 'node:fs';
import { brandSearchPaths, normalizeBrand, readBrandFile, loadBrand } from '../../core/carousel/brand.mjs';
import { defaultStyle, readStyle } from '../../core/style/store.mjs';
import { DEFAULT_CAROUSEL_TOKENS } from '../../core/carousel/ui.mjs';
// Shared by make_carousel, make_image and update_slides: render a spec into a project and describe it for the card.
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_SIZES, LAYOUT_IDS } from '../../core/types.mjs';
import { describeLayout, renderCarousel, resolveSize } from '../../core/carousel/render.mjs';
import { ensureDir } from '../../core/util/fs.mjs';
import { projectDir, registerAsset, requireProject, updateProject } from '../store/project.mjs';
import { z } from './kit.mjs';

const leaf = z.union([z.string(), z.number(), z.boolean()]);
const nested = z.record(z.string(), z.union([leaf, z.array(z.union([leaf, z.record(z.string(), leaf)]))]));
/** Field values: text and numbers, lists of them, lists of small objects, or an object such as {h, items}. */
const fieldValue = z.union([leaf, z.array(z.union([leaf, nested])), nested]);

/** The shape of one slide in a tool call. */
export const slideInput = z.object({
  layout: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (LAYOUT_IDS))),
  fields: z.record(z.string(), fieldValue).describe('The fields for that layout. See the layout list in the tool description.'),
});

/** Brand: a path to a brand.json, or the brand written out. Every part is optional; gaps use the default look. */
export const brandInput = z
  .union([
    z.string(),
    z.object({
      name: z.string().optional(),
      handle: z.string().optional().describe('For example @yourname.'),
      colors: z
        .object({ bg: z.string().optional(), fg: z.string().optional(), accent: z.string().optional(), muted: z.string().optional() })
        .optional()
        .describe('"#RRGGBB" values.'),
      fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
      logo: z.string().optional().describe('Path to a logo image.'),
    }),
  ])
  .optional()
  .describe('A brand.json path or a brand object. Defaults to ./brand.json, then ~/.dandelion-kit/brand.json, then the built-in look.');

/** Size names or WxH strings. Checked by resolveSize, which says in plain words what is allowed. */
export const sizeInput = z
  .string()
  .optional()
  .describe('portrait or 1080x1350 (default), square or 1080x1080, story or 1080x1920.')
  .refine(
    (v) => {
      if (v === undefined) return true;
      try {
        resolveSize(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'size must be portrait (1080x1350), square (1080x1080) or story (1080x1920)' },
  );

/** One line per layout with its fields and limits, for tool descriptions. */
export function layoutHelp() {
  return LAYOUT_IDS.map((id) => `${id}: ${describeLayout(id).split('\n').join('; ')}`).join('\n');
}

/** Resolve each chosen field, keeping the usual fallbacks for gaps. @param {any} [options] */
export async function resolveCarouselStyle(options = {}) {
  const named = options.style ? await readStyle(options.style) : null;
  const fallback = await defaultStyle();
  const merge = (a, b) => ({ ...a, ...b, colors: { ...a?.colors, ...b?.colors }, fonts: { ...a?.fonts, ...b?.fonts } });
  let brand = fallback?.brand ?? {};
  for (const file of options.brand !== undefined ? [] : [...brandSearchPaths()].reverse()) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const checked = readBrandFile(file);
      brand = merge(brand, { ...raw, ...(raw.logo ? { logo: checked.logo } : {}) });
    }
  }
  if (named?.brand) brand = merge(brand, named.brand);
  return {
    brand: options.brand !== undefined ? loadBrand({ explicit: options.brand }) : normalizeBrand(brand),
    tokens: { ...DEFAULT_CAROUSEL_TOKENS, ...fallback?.carousel, ...named?.carousel },
    style_name: named?.name ?? ((fallback?.brand || fallback?.carousel) ? fallback.name : undefined),
  };
}

/**
 * Render a spec into a carousel project and return the card data.
 * @param {string} projectId
 * @param {import('../../core/types.mjs').CarouselSpec} spec
 * @param {{brand?: any, size?: string, allowOverflow?: boolean, style?: string, tokens?: any, style_name?: string}} [options]
 */
export async function renderIntoProject(projectId, spec, options = {}) {
  await requireProject(projectId);
  const resolved = options.tokens ? { brand: options.brand, tokens: options.tokens, style_name: options.style_name } : await resolveCarouselStyle(options);
  const base = ensureDir(join(projectDir(projectId), 'out'));
  const rev = `r${Date.now().toString(36)}`;
  const outDir = ensureDir(join(base, rev));
  let result;
  try {
    result = await renderCarousel(spec, {
      outDir,
      brand: resolved.brand,
      tokens: resolved.tokens,
      size: options.size,
      allowOverflow: options.allowOverflow,
      cwd: process.cwd(),
      baseDir: process.cwd(),
    });
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const { project } = await updateProject(projectId, async (p) => {
    // Drop the file list entries from earlier renders; their folders are removed below.
    for (const [id, a] of Object.entries(p.assets)) if (a.kind === 'slide' || a.kind === 'thumb') delete p.assets[id];
    p.carousel = result.spec;
    p.carousel_tokens = resolved.tokens;
    p.style_name = resolved.style_name;
    p.title = spec.title || p.title;
    for (let i = 0; i < result.files.length; i += 1) {
      await registerAsset(p, { path: result.files[i].file, kind: 'slide', label: `Slide ${i + 1}` });
      await registerAsset(p, { path: result.files[i].thumb, kind: 'thumb', label: `Slide ${i + 1} thumb` });
    }
  });
  for (const name of await readdir(base).catch(() => /** @type {string[]} */ ([]))) {
    if (name !== rev) await rm(join(base, name), { recursive: true, force: true }).catch(() => {});
  }
  const { usageReporter } = await import('../../core/util/usage-reporting.mjs');
  await usageReporter.firstUse();
  return carouselData(project, result.warnings);
}

/**
 * Card data for a carousel project.
 * @param {import('../../core/types.mjs').Project} project
 * @param {string[]} [warnings]
 */
export function carouselData(project, warnings = []) {
  const spec = /** @type {import('../../core/types.mjs').CarouselSpec} */ (project.carousel);
  const rendered = spec.rendered ?? [];
  const byPath = new Map(Object.values(project.assets).map((a) => [a.path, a.id]));
  const size = resolveSize(spec.size);
  return {
    project_id: project.id,
    style_name: project.style_name,
    carousel_tokens: project.carousel_tokens,
    title: spec.title || project.title,
    size,
    width: rendered[0]?.width ?? IMAGE_SIZES[/** @type {keyof typeof IMAGE_SIZES} */ (size)]?.width,
    height: rendered[0]?.height ?? IMAGE_SIZES[/** @type {keyof typeof IMAGE_SIZES} */ (size)]?.height,
    brand: spec.brand,
    slides: spec.slides.map((s, i) => ({
      layout: s.layout,
      fields: s.fields,
      file: rendered[i]?.file,
      asset_id: rendered[i] ? byPath.get(rendered[i].file) : undefined,
      thumb_asset_id: rendered[i] ? byPath.get(rendered[i].thumb) : undefined,
      width: rendered[i]?.width,
      height: rendered[i]?.height,
    })),
    ...(warnings.length ? { warnings } : {}),
  };
}
