import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_SIZES, LAYOUT_IDS } from '../core/types.mjs';
import { renderSlide, LAYOUTS } from '../core/carousel/render.mjs';
import { DEFAULT_BRAND, normalizeBrand } from '../core/carousel/brand.mjs';
import { DEFAULT_CAROUSEL_TOKENS } from '../core/carousel/ui.mjs';
import { contrast, mix } from '../core/carousel/color.mjs';
import { saveStyle, readStyle } from '../core/style/store.mjs';
import { requireProject } from '../server/store/project.mjs';
import { connectKit, textOf } from './server-helpers.mjs';

let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-carousel-style-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

const values = {
  radius: ['sharp', 'soft', 'round'],
  heading_case: ['default', 'upper', 'lower'],
  background: ['flat', 'soft', 'dots'],
  margin: ['standard', 'wide', 'tight'],
  rule: ['thin', 'bold', 'none'],
};

async function photo() {
  const file = join(home, 'photo.jpg');
  await sharp({ create: { width: 600, height: 750, channels: 3, background: '#254765' } }).jpeg().toFile(file);
  return file;
}

function slide(id, image = '') {
  const fields = structuredClone(LAYOUTS[id].sample);
  if (id === 'photo-hero') fields.image = image;
  return { layout: id, fields };
}

test('every layout and size fits with each carousel token value', { timeout: 600000 }, async () => {
  const image = await photo();
  let count = 0;
  for (const size of Object.keys(IMAGE_SIZES)) {
    for (const id of LAYOUT_IDS) {
      for (const [token, choices] of Object.entries(values)) {
        for (const value of choices) {
          const label = `${id} ${size} ${token} ${value}`;
          const rendered = await renderSlide(slide(id, image), { size, tokens: { [token]: value }, index: 0, total: 6 });
          const expected = IMAGE_SIZES[size];
          assert.deepEqual([rendered.width, rendered.height], [expected.width, expected.height], label);
          assert.equal((await sharp(rendered.buffer).metadata()).format, 'jpeg', label);
          assert.ok(rendered.scale > 0 && rendered.scale <= 1, label);
          assert.ok(rendered.warnings.every(w => /shrunk/.test(w)), label);
          count++;
        }
      }
    }
  }
  assert.equal(count, 12 * 3 * 15);
});

test('explicit default tokens keep every layout byte identical at each size', { timeout: 180000 }, async () => {
  const image = await photo();
  for (const size of Object.keys(IMAGE_SIZES)) {
    for (const id of LAYOUT_IDS) {
      const spec = slide(id, image);
      const options = { size, index: 0, total: 6 };
      const plain = await renderSlide(spec, options);
      const styled = await renderSlide(spec, { ...options, tokens: DEFAULT_CAROUSEL_TOKENS });
      assert.deepEqual(styled.buffer, plain.buffer, `${id} ${size}`);
    }
  }
});

test('each changed token is visible and optional visual proof is JPEG', { timeout: 180000 }, async () => {
  const spec = slide('before-after');
  const plain = await renderSlide(spec, { index: 0, total: 6 });
  const tiles = [{ label: 'Default', buffer: plain.buffer }];
  for (const [token, choices] of Object.entries(values)) {
    for (const value of choices) {
      const rendered = await renderSlide(spec, { tokens: { [token]: value }, index: 0, total: 6 });
      if (value !== DEFAULT_CAROUSEL_TOKENS[token]) assert.notDeepEqual(rendered.buffer, plain.buffer, `${token} ${value}`);
      tiles.push({ label: `${token}: ${value}`, buffer: rendered.buffer });
    }
  }
  const file = process.env.STYLE_CAROUSEL_SHEET;
  if (file) {
    const composites = [];
    for (const [i, tile] of tiles.entries()) {
      const x = (i % 4) * 320;
      const y = Math.floor(i / 4) * 430;
      composites.push({ input: await sharp(tile.buffer).resize(320, 400).toBuffer(), left: x, top: y + 30 });
      const label = `<svg width="320" height="30"><rect width="320" height="30" fill="white"/><text x="10" y="21" font-size="16" fill="black">${tile.label}</text></svg>`;
      composites.push({ input: Buffer.from(label), left: x, top: y });
    }
    await mkdir(dirname(file), { recursive: true });
    await sharp({ create: { width: 1280, height: 1720, channels: 3, background: '#FFFFFF' } }).composite(composites).jpeg({ quality: 88 }).toFile(file);
  }
});

test('photo and accent themes ignore background tokens and CTA has no rule', async () => {
  const image = await photo();
  for (const id of ['photo-hero', 'cta']) {
    const plain = await renderSlide(slide(id, image));
    for (const background of ['soft', 'dots']) {
      const styled = await renderSlide(slide(id, image), { tokens: { background } });
      assert.deepEqual(styled.buffer, plain.buffer, id);
    }
    if (id === 'cta') {
      for (const rule of ['bold', 'none']) assert.deepEqual((await renderSlide(slide(id, image), { tokens: { rule } })).buffer, plain.buffer);
    }
  }
  for (const background of [DEFAULT_BRAND.colors.bg, mix(DEFAULT_BRAND.colors.bg, DEFAULT_BRAND.colors.accent, 0.1)]) {
    assert.ok(contrast(background, DEFAULT_BRAND.colors.fg) >= 4.5);
  }
});

test('saved partial colors fonts feel and pacing leave other carousel fields at defaults', async () => {
  const kit = await connectKit();
  try {
    const cases = [
      { name: 'Only colors', input: { brand: { colors: { accent: '#215F9A' } } }, brand: normalizeBrand({ colors: { accent: '#215F9A' } }), tokens: {} },
      { name: 'Only fonts', input: { brand: { fonts: { heading: 'Anton' } } }, brand: normalizeBrand({ fonts: { heading: 'Anton' } }), tokens: {} },
      { name: 'Only feel', input: { carousel: { radius: 'sharp' } }, brand: normalizeBrand({}), tokens: { radius: 'sharp' } },
      { name: 'Only pacing', input: { video: { rough_cut: 'punchy' } }, brand: normalizeBrand({}), tokens: {} },
    ];
    for (const c of cases) {
      await saveStyle(c.name, c.input, { make_default: false });
      const result = await kit.call('make_image', { layout: 'list', fields: LAYOUTS.list.sample, style: c.name });
      assert.ok(!result.isError, textOf(result));
      const data = result.structuredContent;
      assert.deepEqual(data.brand, c.brand, c.name);
      const expected = await renderSlide(slide('list'), { brand: c.brand, tokens: c.tokens });
      assert.deepEqual(await readFile(data.slides[0].file), expected.buffer, c.name);
      const saved = await readStyle(c.name);
      if (c.name === 'Only colors') assert.equal(saved.brand?.fonts, undefined);
      if (c.name === 'Only fonts') assert.equal(saved.brand?.colors, undefined);
    }
  } finally { await kit.close(); }
});

test('default style applies without style arguments and updates keep the saved snapshot', async () => {
  const kit = await connectKit();
  try {
    await saveStyle('My cards', { brand: { colors: { accent: '#215F9A' } }, carousel: { radius: 'sharp', margin: 'wide' } });
    const spec = slide('cover');
    const image = await kit.call('make_image', spec);
    const carousel = await kit.call('make_carousel', { title: 'Style test', slides: [spec] });
    for (const result of [image, carousel]) {
      assert.ok(!result.isError, textOf(result));
      assert.match(textOf(result), /Style used: My cards/);
      assert.equal(result.structuredContent.brand.colors.accent, '#215F9A');
      assert.deepEqual(result.structuredContent.brand.fonts, DEFAULT_BRAND.fonts);
      const project = await requireProject(result.structuredContent.project_id);
      assert.equal(project.style_name, 'My cards');
      assert.deepEqual(project.carousel_tokens, { ...DEFAULT_CAROUSEL_TOKENS, radius: 'sharp', margin: 'wide' });
    }
    const data = carousel.structuredContent;
    const original = await readFile(data.slides[0].file);
    await saveStyle('My cards', { brand: { colors: { accent: '#AA2244' } }, carousel: { radius: 'round', margin: 'tight' } });
    const updated = await kit.call('update_slides', { project_id: data.project_id, slides: [spec] });
    assert.ok(!updated.isError, textOf(updated));
    assert.deepEqual(await readFile(updated.structuredContent.slides[0].file), original);
    assert.equal((await requireProject(data.project_id)).carousel_tokens?.radius, 'sharp');
  } finally { await kit.close(); }
});
