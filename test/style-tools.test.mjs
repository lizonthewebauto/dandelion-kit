import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectKit, textOf } from './server-helpers.mjs';
test('style tools save partial choices and list borrowed parts', async () => {
  const previous = process.env.DANDELION_KIT_HOME;
  const home = await mkdtemp(join(tmpdir(), 'kit-style-tools-'));
  process.env.DANDELION_KIT_HOME = home;
  const kit = await connectKit();
  try {
    const saved = await kit.call('save_style', { name: 'Blue days', style: { brand: { colors: { bg: '#102A43' } } }, liked: ['colors'] });
    assert.ok(!saved.isError, textOf(saved));
    assert.equal(saved.structuredContent.is_default, true);
    assert.deepEqual(saved.structuredContent.style.brand, { colors: { bg: '#102A43' } });
    const listed = await kit.call('list_styles');
    assert.match(textOf(listed), /Blue days.*default/);
    assert.match(textOf(listed), /Borrowed: colors/);
    assert.equal((await kit.call('list_styles', { name: 'blue-days' })).structuredContent.style.name, 'Blue days');
    assert.ok(!(await kit.call('save_style', { name: 'Blue days', remove: true })).isError);
    assert.deepEqual((await kit.call('list_styles')).structuredContent.styles, []);
  } finally {
    await kit.close();
    if (previous === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('carousel style fields follow brand files and explicit brand wins', async () => {
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
  const { resolveCarouselStyle } = await import('../server/lib/carousel.mjs');
  const { saveStyle } = await import('../core/style/store.mjs');
  const { DEFAULT_BRAND } = await import('../core/carousel/brand.mjs');
  const previous = process.env.DANDELION_KIT_HOME;
  const previousCwd = process.cwd();
  const home = await mkdtemp(join(tmpdir(), 'kit-style-chain-'));
  const cwd = await mkdtemp(join(tmpdir(), 'kit-style-cwd-'));
  process.env.DANDELION_KIT_HOME = home;
  process.chdir(cwd);
  try {
    await saveStyle('Base', { brand: { colors: { accent: '#AA2244', bg: '#112233' } }, carousel: { rule: 'bold' } });
    await writeFile(join(home, 'brand.json'), JSON.stringify({ colors: { accent: '#224466' }, fonts: { body: 'Space Mono' } }));
    await writeFile(join(cwd, 'brand.json'), JSON.stringify({ colors: { accent: '#336699' } }));
    await saveStyle('Named', { brand: { fonts: { heading: 'Anton' } }, carousel: { radius: 'sharp' } });
    const picked = await resolveCarouselStyle({ style: 'Named' });
    assert.equal(picked.brand.colors.accent, '#336699');
    assert.equal(picked.brand.colors.bg, '#112233');
    assert.deepEqual(picked.brand.fonts, { heading: 'Anton', body: 'Space Mono' });
    assert.equal(picked.tokens.rule, 'bold');
    assert.equal(picked.tokens.radius, 'sharp');
    const explicit = await resolveCarouselStyle({ style: 'Named', brand: { colors: { accent: '#663399' } } });
    assert.deepEqual(explicit.brand.fonts, DEFAULT_BRAND.fonts);
    assert.equal(explicit.brand.colors.bg, DEFAULT_BRAND.colors.bg);
    assert.equal(explicit.tokens.radius, 'sharp');
    await writeFile(join(cwd, 'brand.json'), 'bad json');
    assert.equal((await resolveCarouselStyle({ brand: { name: 'Explicit' } })).brand.name, 'Explicit');
  } finally {
    process.chdir(previousCwd);
    if (previous === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previous;
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
