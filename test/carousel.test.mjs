import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { IMAGE_SIZES, LAYOUT_IDS } from '../core/types.mjs';
import {
  CarouselError,
  LAYOUTS,
  describeLayout,
  layoutSchema,
  loadBrand,
  normalizeBrand,
  renderCarousel,
  renderImage,
  renderSlide,
  validateSlide,
  resolveSize,
} from '../core/carousel/render.mjs';
import { DEFAULT_BRAND } from '../core/carousel/brand.mjs';
import { FONT_NAMES } from '../core/carousel/fonts.mjs';
import { worstFields } from './fixtures/carousel-cases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = join(HERE, 'fixtures', 'carousel-snapshots.json');
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** One scratch folder for the whole file. */
const TMP = mkdtempSync(join(tmpdir(), 'kit-carousel-'));
process.on('exit', () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});

/** A made-up photo so photo-hero has something to draw. */
async function makePhoto() {
  const file = join(TMP, 'photo.jpg');
  if (existsSync(file)) return file;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b4a6f"/><stop offset="0.55" stop-color="#d98a4b"/><stop offset="1" stop-color="#3b2a48"/></linearGradient></defs><rect width="1200" height="1500" fill="url(#g)"/><circle cx="820" cy="430" r="220" fill="#ffd98a" opacity="0.9"/><circle cx="300" cy="1000" r="300" fill="#6fa3a8" opacity="0.7"/></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(file);
  return file;
}

/** @param {string} id @param {string} photo */
function sampleSlide(id, photo) {
  const fields = { ...LAYOUTS[id].sample };
  if (id === 'photo-hero') fields.image = photo;
  return { layout: id, fields };
}

/** Colour stats for one rectangle of an image. @param {Buffer} jpeg @param {{left:number,top:number,width:number,height:number}} region */
async function regionStats(jpeg, region) {
  const piece = await sharp(jpeg).extract(region).png().toBuffer();
  return sharp(piece).stats();
}

/** @param {Buffer} buf */
function isJpeg(buf) {
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

test('the layout registry covers every layout id and every sample fits its own limits', () => {
  assert.deepEqual(Object.keys(LAYOUTS).sort(), [...LAYOUT_IDS].sort());
  for (const id of LAYOUT_IDS) {
    const sample = { ...LAYOUTS[id].sample };
    if (id === 'photo-hero') sample.image = 'x.jpg';
    const { layoutId } = validateSlide({ layout: id, fields: sample });
    assert.equal(layoutId, id);
    // The zod schema agrees with the plain checker.
    assert.equal(layoutSchema(id).safeParse(sample).success, true, `${id} schema`);
    assert.ok(describeLayout(id).length > 10);
  }
});

test('sample text has no long dashes', () => {
  for (const id of LAYOUT_IDS) assert.equal(DASH.test(JSON.stringify(LAYOUTS[id].sample)), false, id);
  assert.equal(DASH.test(JSON.stringify(DEFAULT_BRAND)), false);
});

test('gate: 12 layouts x 3 sizes make 36 JPEGs with the right dimensions', async () => {
  const photo = await makePhoto();
  let count = 0;
  for (const sizeKey of Object.keys(IMAGE_SIZES)) {
    const want = IMAGE_SIZES[/** @type {keyof typeof IMAGE_SIZES} */ (sizeKey)];
    const outDir = join(TMP, `gate-${sizeKey}`);
    const spec = { title: `All layouts ${sizeKey}`, slides: LAYOUT_IDS.map((id) => sampleSlide(id, photo)) };
    const res = await renderCarousel(spec, { outDir, size: sizeKey, brand: {} });
    assert.equal(res.files.length, 12);
    assert.deepEqual(res.warnings, [], `warnings for ${sizeKey}: ${res.warnings.join(' | ')}`);
    for (const f of res.files) {
      const buf = readFileSync(f.file);
      assert.ok(isJpeg(buf), `${f.file} is not a JPEG`);
      const meta = await sharp(buf).metadata();
      assert.equal(meta.format, 'jpeg');
      assert.equal(meta.width, want.width);
      assert.equal(meta.height, want.height);
      assert.equal(f.width, want.width);
      assert.equal(f.height, want.height);
      assert.ok(buf.length > 8_000 && buf.length < 900_000, `${f.file} size ${buf.length}`);
      const thumb = readFileSync(f.thumb);
      assert.ok(isJpeg(thumb));
      assert.equal((await sharp(thumb).metadata()).width, 216);
      count++;
    }
    assert.equal(res.spec.rendered?.length, 12);
  }
  assert.equal(count, 36);
});

test('text at every limit stays inside the safe area in all three sizes', async () => {
  const photo = await makePhoto();
  for (const sizeKey of Object.keys(IMAGE_SIZES)) {
    for (const id of LAYOUT_IDS) {
      const fields = worstFields(id, photo);
      if (id === 'stat') fields.number = '12,400%';
      const r = await renderSlide({ layout: id, fields }, { size: sizeKey, index: 1, total: 6, brand: normalizeBrand({}) });
      assert.equal(r.scale, 1, `${id} at ${sizeKey} needed to shrink`);
      if (id === 'photo-hero') continue;
      // Top and bottom 10% and the side 6% hold only the flat background.
      const { width: W, height: H } = r;
      const regions = [
        { left: 0, top: 0, width: W, height: Math.round(H * 0.1) - 6 },
        { left: 0, top: H - Math.round(H * 0.1) + 6, width: W, height: Math.round(H * 0.1) - 6 },
        { left: 0, top: 0, width: Math.round(W * 0.06) - 6, height: H },
        { left: W - Math.round(W * 0.06) + 6, top: 0, width: Math.round(W * 0.06) - 6, height: H },
      ];
      for (const region of regions) {
        const { channels } = await regionStats(r.buffer, region);
        for (const ch of channels.slice(0, 3)) assert.ok(ch.stdev < 2.5, `${id} ${sizeKey}: ink in the safe-area margin ${JSON.stringify(region)} (stdev ${ch.stdev})`);
      }
    }
  }
});

test('snapshots: cover, list and stat keep their look', async () => {
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  /** @type {Record<string, {mean:number[], grid:string}>} */
  const saved = existsSync(SNAPSHOTS) ? JSON.parse(readFileSync(SNAPSHOTS, 'utf8')) : {};
  for (const id of ['cover', 'list', 'stat']) {
    const r = await renderSlide({ layout: id, fields: LAYOUTS[id].sample }, { index: 0, total: 6, brand: normalizeBrand({}) });
    const stats = await sharp(r.buffer).stats();
    const mean = stats.channels.slice(0, 3).map((c) => Math.round(c.mean * 10) / 10);
    const grid = (await sharp(r.buffer).resize(27, 34, { fit: 'fill', kernel: 'cubic' }).greyscale().raw().toBuffer()).toString('base64');
    if (update) {
      saved[id] = { mean, grid };
      continue;
    }
    const want = saved[id];
    assert.ok(want, `no snapshot for ${id}. Run with UPDATE_SNAPSHOTS=1 to make it.`);
    mean.forEach((m, i) => assert.ok(Math.abs(m - want.mean[i]) <= 3, `${id} channel ${i} mean ${m} vs ${want.mean[i]}`));
    const a = Buffer.from(grid, 'base64');
    const b = Buffer.from(want.grid, 'base64');
    assert.equal(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    assert.ok(diff / a.length <= 6, `${id} differs from its snapshot (mean grey difference ${(diff / a.length).toFixed(2)})`);
  }
  if (update) writeFileSync(SNAPSHOTS, JSON.stringify(saved, null, 1) + '\n');
});

test('an over-budget field fails with a plain message that names the field and the limit', async () => {
  const items = ['one', 'x'.repeat(49), 'three'];
  await assert.rejects(
    () => renderSlide({ layout: 'list', fields: { title: 'A list', items } }, { index: 2 }),
    (err) => {
      assert.ok(err instanceof CarouselError);
      assert.equal(err.message, 'Slide 3 (list): "items, entry 2" is 49 characters; the limit is 48. Cut 1.');
      return true;
    },
  );
  // Every problem is listed, none is silently cut.
  await assert.rejects(
    () => renderCarousel({ title: 't', slides: [{ layout: 'cover', fields: { title: 'y'.repeat(61), kicker: 'k'.repeat(31) } }, { layout: 'quote', fields: { quote: 'q'.repeat(141) } }] }, { outDir: join(TMP, 'never') }),
    (err) => {
      assert.ok(err instanceof CarouselError);
      assert.equal(err.issues.length, 3);
      assert.match(err.message, /Slide 1 \(cover\): "title" is 61 characters; the limit is 60/);
      assert.match(err.message, /Slide 1 \(cover\): "kicker" is 31 characters; the limit is 30/);
      assert.match(err.message, /Slide 2 \(quote\): "quote" is 141 characters; the limit is 140/);
      return true;
    },
  );
  assert.equal(existsSync(join(TMP, 'never', 'slide-01.jpg')), false, 'nothing is written when a slide is bad');
});

test('other mistakes get plain messages too', () => {
  assert.throws(() => validateSlide({ layout: 'list', fields: { title: 'T', items: Array.from({ length: 7 }, () => 'a') } }), /"items" has 7 entries; the limit is 6/);
  assert.throws(() => validateSlide({ layout: 'list', fields: { items: ['a'] } }), /"title" is missing/);
  assert.throws(() => validateSlide({ layout: 'list', fields: { title: 'T', items: ['a'], heading: 'x' } }), /"heading" is not a field of the list layout. Use: title, items/);
  assert.throws(() => validateSlide({ layout: /** @type {any} */ ('poster'), fields: {} }, { index: 0 }), /Slide 1 \(poster\): "poster" is not a layout. Use one of: cover/);
  assert.throws(() => validateSlide({ layout: 'steps', fields: { title: 'T', steps: [{ text: '' }] } }), /"steps, entry 1, text" is missing/);
  assert.throws(() => resolveSize('huge'), /not a size/);
  assert.equal(resolveSize('1080x1080'), 'square');
  assert.equal(resolveSize(undefined), 'portrait');
});

test('allowOverflow skips the character limits and shrinks text to fit', async () => {
  const fields = { title: 'T'.repeat(30), items: Array.from({ length: 6 }, (_, i) => `${i} ${'long words keep coming '.repeat(20)}`.trim()) };
  assert.throws(() => validateSlide({ layout: 'list', fields }), /characters; the limit is 48/);
  const r = await renderSlide({ layout: 'list', fields }, { allowOverflow: true, size: 'square' });
  assert.ok(isJpeg(r.buffer));
  assert.ok(r.scale < 1, 'the text had to shrink');
});

test('a long dash in the text is reported, not changed', async () => {
  const r = await renderSlide({ layout: 'cover', fields: { title: `Plan ${String.fromCharCode(0x2014)} then post` } }, {});
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /long dash/);
});

test('single image and thumbnails', async () => {
  const outDir = join(TMP, 'single');
  const res = await renderImage({ layout: 'stat', fields: LAYOUTS.stat.sample }, { outDir, size: 'story' });
  assert.equal(res.files.length, 1);
  const meta = await sharp(readFileSync(res.files[0].file)).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1920]);
  assert.ok(existsSync(res.files[0].thumb));
});

test('brand lookup order: explicit, then ./brand.json, then the kit home, then the default', () => {
  const cwd = join(TMP, 'cwd');
  const home = join(TMP, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  const prevHome = process.env.DANDELION_KIT_HOME;
  process.env.DANDELION_KIT_HOME = home;
  try {
    assert.equal(loadBrand({ cwd }).name, DEFAULT_BRAND.name);
    writeFileSync(join(home, 'brand.json'), JSON.stringify({ name: 'From Home', handle: '@home' }));
    assert.equal(loadBrand({ cwd }).name, 'From Home');
    writeFileSync(join(cwd, 'brand.json'), JSON.stringify({ name: 'From Cwd', colors: { accent: '#0066ff' } }));
    const fromCwd = loadBrand({ cwd });
    assert.equal(fromCwd.name, 'From Cwd');
    assert.equal(fromCwd.colors.accent, '#0066FF');
    assert.equal(fromCwd.colors.bg, DEFAULT_BRAND.colors.bg, 'missing parts come from the default');
    assert.equal(loadBrand({ cwd, explicit: { name: 'Explicit' } }).name, 'Explicit');
    writeFileSync(join(TMP, 'other.json'), JSON.stringify({ name: 'By Path', fonts: { heading: 'anton' } }));
    const byPath = loadBrand({ cwd, explicit: join(TMP, 'other.json') });
    assert.equal(byPath.name, 'By Path');
    assert.equal(byPath.fonts.heading, 'Anton');
  } finally {
    if (prevHome === undefined) delete process.env.DANDELION_KIT_HOME;
    else process.env.DANDELION_KIT_HOME = prevHome;
  }
});

test('bad brand files get plain messages', () => {
  assert.throws(() => normalizeBrand({ colors: { accent: 'red' } }), /"colors.accent" must look like #1A2B3C/);
  assert.throws(() => normalizeBrand({ fonts: { heading: 'Comic Sans' } }), new RegExp(`not available. Pick one of: ${FONT_NAMES[0]}`));
  assert.throws(() => normalizeBrand({ colour: {} }), /unknown field/);
  assert.throws(() => normalizeBrand('nope'), /must be an object/);
});

test('a dark brand with another font renders in those colors', async () => {
  const brand = normalizeBrand({ name: 'Night Shift', handle: '@night', colors: { bg: '#10141C', fg: '#F2F0EA', accent: '#F4B63F', muted: '#9AA3B2' }, fonts: { heading: 'Anton', body: 'Montserrat' } });
  for (const id of ['cover', 'list', 'quote', 'stat', 'cta']) {
    const r = await renderSlide({ layout: id, fields: LAYOUTS[id].sample }, { brand, index: 0, total: 3 });
    assert.equal(r.scale, 1, id);
    const { channels } = await sharp(r.buffer).stats();
    if (id !== 'cta') assert.ok(channels[0].mean < 90, `${id} should be dark (mean ${channels[0].mean})`);
  }
});

test('photo-hero: missing image and relative paths', async () => {
  await assert.rejects(
    () => renderSlide({ layout: 'photo-hero', fields: { image: join(TMP, 'nope.jpg'), title: 'Hello' } }, { index: 0, total: 2 }),
    /Slide 1 \(photo-hero\): the image file was not found/,
  );
  await makePhoto();
  const r = await renderSlide({ layout: 'photo-hero', fields: { image: 'photo.jpg', title: 'Hello there' } }, { baseDir: TMP, size: 'square' });
  assert.ok(isJpeg(r.buffer));
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1080);
});

test('a logo in the brand shows in the header', async () => {
  const logo = join(TMP, 'logo.png');
  await sharp({ create: { width: 200, height: 80, channels: 4, background: '#00AA66' } }).png().toFile(logo);
  const brand = normalizeBrand({ logo });
  const withLogo = await renderSlide({ layout: 'cover', fields: LAYOUTS.cover.sample }, { brand });
  const without = await renderSlide({ layout: 'cover', fields: LAYOUTS.cover.sample }, { brand: normalizeBrand({}) });
  // The green logo adds green ink to the top strip.
  const strip = { left: 0, top: 120, width: 540, height: 80 };
  const a = (await regionStats(withLogo.buffer, strip)).channels[1].mean;
  const b = (await regionStats(without.buffer, strip)).channels[1].mean;
  assert.ok(Math.abs(a - b) > 3, `logo not visible (${a} vs ${b})`);
});
