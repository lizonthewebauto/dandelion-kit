import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeBrand, loadBrand } from '../core/carousel/brand.mjs';
import { makeContext, page } from '../core/carousel/ui.mjs';
import { LAYOUTS, renderSlide } from '../core/carousel/render.mjs';
import { tool as updateSlides } from '../server/tools/update_slides.mjs';
import { brandInput } from '../server/lib/carousel.mjs';

const brand = (position) => normalizeBrand({ name: 'Example brand', handle: '@example', branding_position: position });

test('branding choices are accepted by brand and update tool; old brands stay at the top', () => {
  assert.equal(normalizeBrand({}).branding_position, 'top');
  for (const position of ['top', 'bottom', 'off']) {
    const parsed = brandInput.parse({ branding_position: position });
    assert.ok(parsed && typeof parsed === 'object');
    assert.equal(parsed.branding_position, position);
    assert.equal(updateSlides.input.branding_position.parse(position), position);
  }
  assert.throws(() => normalizeBrand({ branding_position: 'left' }));
});

test('name and handle move to bottom, or disappear, including CTA brand handle', () => {
  for (const position of ['top', 'bottom', 'off']) {
    const ctx = makeContext({ brand: brand(position), size: 'portrait' });
    const frame = page(ctx, [], [], { footer: false }).props.children.find((el) => el.key === 'frame');
    const [header, , footer] = frame.props.children;
    assert.equal(JSON.stringify(header).includes('Example brand'), position === 'top');
    assert.equal(JSON.stringify(footer ?? {}).includes('Example brand'), position === 'bottom');
    assert.equal(JSON.stringify(footer ?? {}).includes('@example'), position === 'bottom');
    const cta = LAYOUTS.cta.render({ title: 'Get the guide' }, ctx);
    assert.equal(JSON.stringify(cta).includes('@example'), position === 'top');
  }
});

test('bottom branding renders within the safe area for every layout and size', async () => {
  for (const size of ['portrait', 'square', 'story']) {
    for (const id of Object.keys(LAYOUTS).filter((id) => id !== 'photo-hero')) {
      const result = await renderSlide({ layout: id, fields: LAYOUTS[id].sample }, { size, brand: brand('bottom') });
      assert.ok(result.buffer.length > 1000, `${id} ${size}`);
    }
  }
});

test('off ignores a disabled missing logo', async () => {
  const result = await renderSlide({ layout: 'cover', fields: { title: 'A new idea' } }, { brand: normalizeBrand({ branding_position: 'off', logo: '/missing-logo.png' }) });
  assert.ok(result.buffer.length > 1000);
});

test('saved placement carries into explicit colors; an explicit placement wins even with a broken saved file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-brand-default-'));
  const savedHome = process.env.DANDELION_KIT_HOME;
  process.env.DANDELION_KIT_HOME = dir;
  try {
    writeFileSync(join(dir, 'brand.json'), JSON.stringify({ branding_position: 'bottom' }));
    assert.equal(loadBrand({ explicit: { name: 'Another brand' } }).branding_position, 'bottom');
    writeFileSync(join(dir, 'brand.json'), '{broken');
    assert.equal(loadBrand({ explicit: { branding_position: 'off' } }).branding_position, 'off');
  } finally {
    if (savedHome === undefined) delete process.env.DANDELION_KIT_HOME;
    else process.env.DANDELION_KIT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
