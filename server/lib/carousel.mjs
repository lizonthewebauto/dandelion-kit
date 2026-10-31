// Shared by make_carousel, make_image and update_slides: render a spec into a project and describe it for the card.
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_SIZES, LAYOUT_IDS } from '../../core/types.mjs';
import { describeLayout, renderCarousel } from '../../core/carousel/render.mjs';
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

export const sizeInput = z
  .enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (Object.keys(IMAGE_SIZES))))
  .optional()
  .describe('portrait 1080x1350 (default), square 1080x1080, or story 1080x1920.');

/** One line per layout with its fields and limits, for tool descriptions. */
export function layoutHelp() {
  return LAYOUT_IDS.map((id) => `${id}: ${describeLayout(id).split('\n').join('; ')}`).join('\n');
}

/**
 * Render a spec into a carousel project and return the card data.
 * @param {string} projectId
 * @param {import('../../core/types.mjs').CarouselSpec} spec
 * @param {{brand?: any, size?: string, allowOverflow?: boolean}} [options]
 */
export async function renderIntoProject(projectId, spec, options = {}) {
  await requireProject(projectId);
  const base = ensureDir(join(projectDir(projectId), 'out'));
  const rev = `r${Date.now().toString(36)}`;
  const outDir = ensureDir(join(base, rev));
  let result;
  try {
    result = await renderCarousel(spec, {
      outDir,
      brand: options.brand,
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
    p.title = spec.title || p.title;
    for (let i = 0; i < result.files.length; i += 1) {
      await registerAsset(p, { path: result.files[i].file, kind: 'slide', label: `Slide ${i + 1}` });
      await registerAsset(p, { path: result.files[i].thumb, kind: 'thumb', label: `Slide ${i + 1} thumb` });
    }
  });
  for (const name of await readdir(base).catch(() => /** @type {string[]} */ ([]))) {
    if (name !== rev) await rm(join(base, name), { recursive: true, force: true }).catch(() => {});
  }
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
  const size = spec.size ?? 'portrait';
  return {
    project_id: project.id,
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
