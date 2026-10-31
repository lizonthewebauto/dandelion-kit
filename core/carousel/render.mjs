// Layout tree to SVG to JPEG, size presets, thumbnails, text fit checks.
// satori draws the element tree as SVG, sharp turns it into a JPEG. Output is always JPEG (quality 90, progressive, sRGB).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { IMAGE_SIZES, LAYOUT_IDS } from '../types.mjs';
import { CarouselError, loadBrand, normalizeBrand } from './brand.mjs';
import { checkFields } from './fields.mjs';
import { loadFonts } from './fonts.mjs';
import { LAYOUTS } from './registry.mjs';
import { makeContext, page } from './ui.mjs';

export { CarouselError, loadBrand, normalizeBrand, DEFAULT_BRAND } from './brand.mjs';
export { LAYOUTS, describeLayout, layoutSchema } from './registry.mjs';
export { IMAGE_SIZES };

/** @typedef {import('../types.mjs').SlideSpec} SlideSpec */
/** @typedef {import('../types.mjs').CarouselSpec} CarouselSpec */
/** @typedef {import('../types.mjs').BrandConfig} BrandConfig */

const JPEG_QUALITY = 90;
const THUMB_WIDTH = 216;
const THUMB_QUALITY = 70;
/** Auto-fit steps. 1 means the design size. In-budget text should never need a step. */
const SHRINK_STEPS = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62];
/** Em dash and en dash, built from char codes so this file passes the copy check. */
const DASH_RE = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/**
 * Turn "portrait", "square", "story", "1080x1350" or a size entry into a key of IMAGE_SIZES.
 * @param {string|undefined} size
 * @returns {keyof typeof IMAGE_SIZES}
 */
export function resolveSize(size) {
  if (size === undefined || size === null || size === '') return 'portrait';
  const s = String(size).trim().toLowerCase();
  if (s in IMAGE_SIZES) return /** @type {keyof typeof IMAGE_SIZES} */ (s);
  const hit = Object.values(IMAGE_SIZES).find((v) => s === `${v.width}x${v.height}`);
  if (hit) return /** @type {keyof typeof IMAGE_SIZES} */ (hit.id);
  throw new CarouselError(`size must be portrait (1080x1350), square (1080x1080) or story (1080x1920). "${size}" is none of those.`);
}

/**
 * @param {SlideSpec} slide
 * @param {number|null} index  0-based, or null for a single image.
 */
function slideLabel(slide, index) {
  const layout = slide && typeof slide === 'object' ? String(slide.layout) : '?';
  return index === null ? `The ${layout} image` : `Slide ${index + 1} (${layout})`;
}

/**
 * Check one slide against its layout and return cleaned fields. Throws CarouselError listing every problem.
 * @param {SlideSpec} slide
 * @param {{index?: number|null, allowOverflow?: boolean}} [opts]
 * @returns {{layoutId: string, fields: Record<string, any>}}
 */
export function validateSlide(slide, opts = {}) {
  const { issues, layoutId, fields } = collectSlide(slide, opts);
  if (issues.length) throw new CarouselError(formatIssues(issues), issues);
  return { layoutId, fields };
}

/** @param {string[]} issues */
function formatIssues(issues) {
  return issues.length === 1 ? issues[0] : `Fix these first:\n- ${issues.join('\n- ')}`;
}

/**
 * @param {SlideSpec} slide
 * @param {{index?: number|null, allowOverflow?: boolean}} opts
 */
function collectSlide(slide, opts) {
  const index = opts.index === undefined ? null : opts.index;
  const who = slideLabel(slide, index);
  /** @type {string[]} */
  const issues = [];
  if (!slide || typeof slide !== 'object') {
    return { issues: [`${who}: a slide needs a layout and fields.`], layoutId: '', fields: {} };
  }
  const layout = LAYOUTS[slide.layout];
  if (!layout) {
    return {
      issues: [`${who}: "${slide.layout}" is not a layout. Use one of: ${LAYOUT_IDS.join(', ')}.`],
      layoutId: '',
      fields: {},
    };
  }
  const res = checkFields(layout.fields, slide.fields, { layout: layout.id, budgets: !opts.allowOverflow });
  for (const msg of res.issues) issues.push(`${who}: ${msg}`);
  return { issues, layoutId: layout.id, fields: res.value };
}

/** Every string in the fields, for the dash warning. @param {any} v @param {string[]} out */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/**
 * Load and crop a photo to the canvas, as a JPEG data URI.
 * @param {string} file @param {number} W @param {number} H @param {string} who
 */
async function preparePhoto(file, W, H, who) {
  if (!existsSync(file)) throw new CarouselError(`${who}: the image file was not found: ${file}`);
  try {
    const buf = await sharp(file).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 84 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    throw new CarouselError(`${who}: could not read the image ${file}. Use a JPEG, PNG or WebP file. (${/** @type {Error} */ (err).message})`);
  }
}

/** @param {string} file @param {string} who */
async function prepareLogo(file, who) {
  if (!existsSync(file)) throw new CarouselError(`${who}: the brand logo file was not found: ${file}`);
  try {
    const { data, info } = await sharp(file).resize({ height: 96, width: 480, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    return { uri: `data:image/png;base64,${data.toString('base64')}`, ratio: info.width / info.height };
  } catch (err) {
    throw new CarouselError(`${who}: could not read the brand logo ${file}. Use a PNG, JPEG or WebP file. (${/** @type {Error} */ (err).message})`);
  }
}

/**
 * @typedef {object} RenderedSlide
 * @property {Buffer} buffer     JPEG bytes.
 * @property {number} width
 * @property {number} height
 * @property {number} scale      1 when the design size fit. Less when auto-fit shrank the text.
 * @property {string[]} warnings
 */

/**
 * Render one slide to a JPEG buffer.
 * @param {SlideSpec} slide
 * @param {object} [opts]
 * @param {BrandConfig} [opts.brand]       A full brand. Use loadBrand() to get one. Defaults to the default brand.
 * @param {string} [opts.size]             portrait (default), square or story.
 * @param {number|null} [opts.index]       Slide number, 0-based, null for a single image.
 * @param {number} [opts.total]            Slides in the carousel (the arrow shows on all but the last).
 * @param {boolean} [opts.allowOverflow]   Skip the character limits and shrink the text until it fits.
 * @param {string} [opts.baseDir]          Folder that relative image paths start from.
 * @returns {Promise<RenderedSlide>}
 */
export async function renderSlide(slide, opts = {}) {
  const index = opts.index === undefined ? null : opts.index;
  const sizeKey = resolveSize(opts.size);
  const { width: W, height: H } = IMAGE_SIZES[sizeKey];
  const who = slideLabel(slide, index);
  const { layoutId, fields } = validateSlide(slide, { index, allowOverflow: opts.allowOverflow });
  const layout = LAYOUTS[layoutId];
  const brand = opts.brand ?? normalizeBrand({});

  const baseDir = opts.baseDir ?? process.cwd();
  /** @type {string|null} */
  let photoUri = null;
  if (layout.needsImage) {
    const file = isAbsolute(fields.image) ? fields.image : resolve(baseDir, fields.image);
    photoUri = await preparePhoto(file, W, H, who);
  }
  /** @type {{uri: string, ratio: number}|null} */
  let logo = null;
  if (brand.logo) {
    const file = isAbsolute(brand.logo) ? brand.logo : resolve(baseDir, brand.logo);
    logo = await prepareLogo(file, who);
  }

  const fonts = loadFonts([brand.fonts.heading, brand.fonts.body]);
  const limit = SHRINK_STEPS.length;
  let lastOverflow = '';
  for (let step = 0; step < limit; step++) {
    const shrink = SHRINK_STEPS[step];
    const ctx = makeContext({
      brand,
      size: sizeKey,
      theme: layout.theme,
      index: index ?? 0,
      total: opts.total ?? 1,
      shrink,
      logoUri: logo?.uri ?? null,
      logoRatio: logo?.ratio ?? 1,
      footer: layout.chrome?.footer !== false,
    });
    ctx.photoUri = photoUri;
    const out = layout.render(fields, ctx);
    const tree = page(ctx, out.main, out.bleed ?? [], { footer: layout.chrome?.footer !== false, align: out.align });

    /** @type {any[]} */
    const nodes = [];
    const svg = await satori(/** @type {any} */ (tree), {
      width: W,
      height: H,
      fonts,
      onNodeDetected: (/** @type {any} */ n) => nodes.push(n),
    });
    const overflow = findOverflow(nodes, ctx.box);
    if (overflow) {
      lastOverflow = overflow;
      continue;
    }
    const buffer = await sharp(Buffer.from(svg))
      .flatten({ background: ctx.c.bg })
      .toColourspace('srgb')
      .jpeg({ quality: JPEG_QUALITY, progressive: true, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
    /** @type {string[]} */
    const warnings = [];
    if (strings(fields).some((s) => DASH_RE.test(s))) {
      warnings.push(`${who}: the text has a long dash. Use a comma, a period or "to" instead.`);
    }
    if (shrink < 1) warnings.push(`${who}: the text was a little too long for the safe area, so it was shrunk to ${Math.round(shrink * 100)}%. Shorter text will look better.`);
    return { buffer, width: W, height: H, scale: shrink, warnings };
  }
  throw new CarouselError(
    `${who}: the text does not fit inside the safe area, even at the smallest size (${lastOverflow}). Shorten the text or use fewer entries.`,
  );
}

/**
 * Find anything that sticks out of the safe area. Photo and fade layers are allowed to bleed.
 * @param {any[]} nodes @param {{left:number, top:number, width:number, height:number}} box
 * @returns {string} A short description, or '' when everything fits.
 */
function findOverflow(nodes, box) {
  const tol = 3;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  for (const n of nodes) {
    const key = n.key ? String(n.key) : '';
    if (key.startsWith('bleed')) continue;
    if (key === 'frame' || n.width === undefined) continue;
    if (n.top + n.height > bottom + tol) return `${Math.round(n.top + n.height - bottom)} px too tall`;
    if (n.top < box.top - tol) return `${Math.round(box.top - n.top)} px too tall`;
    if (n.left + n.width > right + tol) return `${Math.round(n.left + n.width - right)} px too wide`;
    if (n.left < box.left - tol) return `${Math.round(box.left - n.left)} px too wide`;
  }
  return '';
}

/**
 * A small JPEG for cards and strips (216 px wide).
 * @param {Buffer} jpeg
 */
export async function thumbnail(jpeg) {
  return sharp(jpeg).resize({ width: THUMB_WIDTH }).jpeg({ quality: THUMB_QUALITY, progressive: true }).toBuffer();
}

/**
 * Check every slide of a carousel without drawing anything. Throws one CarouselError listing every problem.
 * @param {CarouselSpec} spec
 * @param {{allowOverflow?: boolean}} [opts]
 */
export function validateCarousel(spec, opts = {}) {
  if (!spec || typeof spec !== 'object') throw new CarouselError('A carousel needs a title and a list of slides.');
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) throw new CarouselError('A carousel needs at least one slide.');
  if (spec.slides.length > 20) throw new CarouselError(`A carousel can have at most 20 slides (you gave ${spec.slides.length}).`);
  /** @type {string[]} */
  const issues = [];
  spec.slides.forEach((slide, i) => issues.push(...collectSlide(slide, { index: i, allowOverflow: opts.allowOverflow }).issues));
  if (issues.length) throw new CarouselError(formatIssues(issues), issues);
}

/** @param {string} s */
function slug(s) {
  const out = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return out || 'carousel';
}

/**
 * @typedef {object} CarouselOptions
 * @property {string} outDir
 * @property {boolean} [allowOverflow]
 * @property {string} [baseDir]       Folder that relative image paths start from. Defaults to the working folder.
 * @property {string} [cwd]           Where ./brand.json is looked for. Defaults to the working folder.
 * @property {any} [brand]            Overrides spec.brand and brand.json (an object or a path).
 * @property {string} [size]          Overrides spec.size.
 */

/**
 * Render every slide of a carousel into outDir as slide-01.jpg, slide-02.jpg ... plus thumbs/slide-01.jpg.
 * Nothing is written when any slide has a problem.
 * @param {CarouselSpec} spec
 * @param {CarouselOptions} opts
 * @returns {Promise<{spec: CarouselSpec, files: {file:string, thumb:string, width:number, height:number}[], warnings: string[]}>}
 */
export async function renderCarousel(spec, opts) {
  validateCarousel(spec, { allowOverflow: opts.allowOverflow });
  const cwd = opts.cwd ?? process.cwd();
  const brand = loadBrand({ explicit: opts.brand ?? spec.brand, cwd });
  const size = resolveSize(opts.size ?? spec.size);
  const { outDir } = opts;
  const thumbsDir = join(outDir, 'thumbs');
  mkdirSync(thumbsDir, { recursive: true });

  const total = spec.slides.length;
  /** @type {string[]} */
  const warnings = [];
  /** @type {{file:string, thumb:string, width:number, height:number}[]} */
  const files = [];
  // Render everything before writing, so a late failure leaves the folder alone.
  const done = [];
  for (let i = 0; i < total; i++) {
    const r = await renderSlide(spec.slides[i], {
      brand,
      size,
      index: total === 1 ? null : i,
      total,
      allowOverflow: opts.allowOverflow,
      baseDir: opts.baseDir ?? cwd,
    });
    warnings.push(...r.warnings);
    done.push({ ...r, thumb: await thumbnail(r.buffer) });
  }
  done.forEach((r, i) => {
    const name = `slide-${String(i + 1).padStart(2, '0')}.jpg`;
    const file = join(outDir, name);
    const thumb = join(thumbsDir, name);
    writeFileSync(file, r.buffer);
    writeFileSync(thumb, r.thumb);
    files.push({ file, thumb, width: r.width, height: r.height });
  });
  return { spec: { ...spec, size, brand, rendered: files }, files, warnings };
}

/**
 * Render one image (a one-slide carousel) into outDir as image.jpg.
 * @param {SlideSpec} slide
 * @param {CarouselOptions} opts   Same as renderCarousel. The file is outDir/slide-01.jpg.
 */
export async function renderImage(slide, opts) {
  const title = typeof slide?.fields?.title === 'string' ? slide.fields.title : slug(String(slide?.layout ?? ''));
  return renderCarousel({ title, slides: [slide] }, opts);
}

export { slug };
