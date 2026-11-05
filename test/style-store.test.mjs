import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { saveStyle, readStyle, listStyles, removeStyle, defaultStyle, slugify } from '../core/style/store.mjs';
import { parseStyle, overridesSchema, nameSchema, notesSchema } from '../core/style/schema.mjs';

let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-style-test-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

test('partial styles round trip and keep only chosen fields and liked labels', async () => {
  const parts = [
    { brand: { colors: { accent: '#aabbcc' } } },
    { brand: { fonts: { heading: 'Anton' } } },
    { carousel: { radius: 'sharp' } },
    { video: { rough_cut: 'punchy' } },
  ];
  for (const [i, style] of parts.entries()) {
    const saved = await saveStyle(`Style ${i}`, style, { liked: ['colors', 'pacing'], notes: 'My colors.' });
    const read = await readStyle(`style-${i}`);
    assert.equal(read.name, `Style ${i}`);
    assert.deepEqual(read.liked, ['colors', 'pacing']);
    if (i === 0) { assert.ok(read.brand); assert.equal(read.brand.fonts, undefined); assert.deepEqual(read.brand, { colors: { accent: '#AABBCC' } }); }
    assert.equal(saved.is_default, i === 0);
  }
  assert.equal((await listStyles()).length, 4);
  assert.equal((await defaultStyle())?.slug, 'style-0');
});

test('overwriting a slug preserves creation and default, then removal clears it', async () => {
  const first = await saveStyle('My Style!', { carousel: { rule: 'none' } });
  const second = await saveStyle('My Style', { video: { rough_cut: 'gentle' } });
  assert.equal(second.replaced, true);
  assert.equal(second.style.created_at, first.style.created_at);
  assert.equal(second.style.carousel, undefined);
  assert.equal(second.is_default, true);
  await removeStyle('My Style');
  assert.equal(await defaultStyle(), null);
  assert.deepEqual(await listStyles(), []);
  await assert.rejects(readStyle('missing'), /No saved style/);
});

test('default may be chosen or left unset', async () => {
  await saveStyle('First', { brand: {} }, { make_default: false });
  assert.equal(await defaultStyle(), null);
  await saveStyle('Second', { brand: {} }, { make_default: true });
  assert.equal((await defaultStyle())?.name, 'Second');
  await removeStyle('First');
  assert.equal((await defaultStyle())?.name, 'Second');
});

test('logo stays in its own folder with private file mode', async () => {
  const logo = join(home, 'source.jpg');
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).jpeg().toFile(logo);
  const saved = await saveStyle('Logo', { brand: { logo } });
  assert.ok(saved.style.brand?.logo);
  assert.equal(saved.style.brand.logo, join(home, 'styles', 'logo', 'logo.jpg'));
  assert.deepEqual(await readFile(logo), await readFile(saved.style.brand.logo));
  if (process.platform !== 'win32') {
    assert.equal((await stat(saved.file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(home, 'styles'))).mode & 0o777, 0o700);
  }
  await assert.rejects(saveStyle('Bad logo', { brand: { logo: join(home, 'missing') } }), /brand.logo/);
  await removeStyle('Logo');
  await assert.rejects(stat(saved.style.brand.logo), { code: 'ENOENT' });
});

test('slug is short and cannot leave the style folder', () => {
  assert.equal(slugify(' HéLLo / World!! '), 'hello-world');
  assert.equal(slugify('../_default'), 'default');
  assert.equal(slugify('A'.repeat(40)), 'a'.repeat(40));
  assert.throws(() => slugify('!!!'), /letter/);
  assert.throws(() => nameSchema.parse(''), /name/);
  assert.throws(() => nameSchema.parse('a'.repeat(41)), /40/);
  assert.throws(() => notesSchema.parse('a'.repeat(401)), /400/);
});

test('all override bounds reject both ends with a field and its limit', () => {
  const ranges = [
    ['cut_every_ms_min', 600, 8000], ['cut_every_ms_max', 900, 12000], ['sfx_per_minute', 0, 8],
    ['density_per_10s.min', 2, 10], ['density_per_10s.target', 2, 10], ['density_per_10s.max', 2, 10],
    ['grade.saturation', 0.85, 1.2], ['grade.contrast', 0.9, 1.2], ['grade.warmth', -0.15, 0.15],
  ];
  for (const [field, min, max] of ranges) {
    const path = String(field).split('.');
    for (const value of [Number(min) - 0.01, Number(max) + 0.01]) {
      const input = path.length === 1 ? { [path[0]]: value } : { [path[0]]: { [path[1]]: value } };
      assert.throws(() => overridesSchema.parse(input), (err) => err instanceof Error && err.message.includes(String(field)) && err.message.includes(String(value < Number(min) ? min : max)));
    }
  }
  assert.throws(() => overridesSchema.parse({ cut_every_ms_min: 1000, cut_every_ms_max: 1200 }), /plus 300/);
  assert.throws(() => overridesSchema.parse({ density_per_10s: { min: 5, target: 4 } }), /min at most target/);
  assert.throws(() => overridesSchema.parse({ density_per_10s: { target: 8, max: 7 } }), /target at most max/);
  assert.throws(() => overridesSchema.parse({ density_per_10s: { min: 8, max: 7 } }), /target at most max/);
});

test('invalid choices and unknown fields are refused', () => {
  for (const part of [{}, { brand: { fonts: { heading: 'Missing Font' } } }, { carousel: { radius: 'huge' } },
    { video: { base_look: 'missing' } }, { video: { caption_theme: 'missing' } }, { video: { accent: 'red' } },
    { video: { rough_cut: 'fast' } }, { video: { overrides: { camera_aggression: 'wild' } } },
    { brand: { colors: { accent: 'red' } } }, { carousel: { made_up: true } }]) {
    assert.throws(() => parseStyle(part));
  }
});

test('50 style cap allows overwrite but stops a new name', async () => {
  for (let i = 0; i < 50; i++) await saveStyle(`Style ${i}`, { carousel: {} });
  await assert.rejects(saveStyle('Too many', { carousel: {} }), /50 styles/);
  assert.equal((await saveStyle('Style 0', { carousel: { rule: 'none' } })).replaced, true);
});
