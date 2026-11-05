import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { analyzeImage } from '../core/style/analyze-image.mjs';
import { parseHex } from '../core/carousel/color.mjs';

let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-image-sample-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

async function knownSample() {
  const file = join(home, 'navy-and-gold.jpg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#102A43"/><rect x="75" y="100" width="400" height="70" fill="#F0F4F8"/><rect x="75" y="250" width="120" height="120" fill="#FFB400"/></svg>';
  await sharp(Buffer.from(svg)).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toFile(file);
  return file;
}

function near(actual, expected, tolerance = 28) {
  const a = parseHex(actual);
  const b = parseHex(expected);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) <= tolerance, `${actual} should be close to ${expected}`);
}

function valid(result) {
  assert.ok(result.width > 0 && result.height > 0);
  assert.ok(result.palette.length >= 1 && result.palette.length <= 6);
  const shares = result.palette.map((p) => p.share);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 0.01);
  for (let i = 0; i < shares.length; i++) {
    assert.ok(Number.isFinite(shares[i]) && shares[i] >= 0 && shares[i] <= 1);
    if (i) assert.ok(shares[i] <= shares[i - 1], 'palette sorted by pixel share');
  }
  for (const field of ['bg_hex', 'text_hex', 'accent_hex']) assert.match(result[field], /^#[0-9a-f]{6}$/i);
  for (const field of ['whitespace_ratio', 'busyness']) assert.ok(Number.isFinite(result[field]) && result[field] >= 0 && result[field] <= 1, field);
  assert.ok(['dark', 'mid', 'light'].includes(result.brightness));
  assert.ok(['muted', 'normal', 'vivid'].includes(result.saturation));
  assert.ok(['flat', 'gradient', 'busy'].includes(result.background));
}

test('one sample finds its border background text and accent without changing the file', async () => {
  const file = await knownSample();
  const { readFile } = await import('node:fs/promises');
  const before = await readFile(file);
  const result = await analyzeImage(file);
  valid(result);
  assert.equal(result.path, file);
  assert.deepEqual([result.width, result.height], [600, 600]);
  near(result.bg_hex, '#102A43');
  near(result.text_hex, '#F0F4F8');
  near(result.accent_hex, '#FFB400');
  assert.equal(result.brightness, 'dark');
  assert.equal(result.background, 'flat');
  assert.ok(result.whitespace_ratio > 0.75 && result.whitespace_ratio < 0.95);
  assert.deepEqual(await readFile(file), before);
});

test('image measurement repeats exactly with the fixed seed', async () => {
  const file = await knownSample();
  const first = await analyzeImage(file);
  assert.deepEqual(await analyzeImage(file), first);
  assert.deepEqual(await analyzeImage(file), first);
});

test('sample size follows the visible JPEG orientation', async () => {
  const file = join(home, 'turned.jpg');
  await sharp({ create: { width: 120, height: 80, channels: 3, background: '#16334D' } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(file);
  const result = await analyzeImage(file);
  valid(result);
  assert.deepEqual([result.width, result.height], [80, 120]);
});

test('flat gradient and busy JPEG samples have distinct background readings', async () => {
  const flat = await analyzeImage(await knownSample());
  const gradientFile = join(home, 'gradient.jpg');
  const gradient = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g"><stop offset="0" stop-color="#16334D"/><stop offset="1" stop-color="#B1D5EB"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>';
  await sharp(Buffer.from(gradient)).jpeg({ quality: 96 }).toFile(gradientFile);
  const smooth = await analyzeImage(gradientFile);
  const busyFile = join(home, 'busy.jpg');
  const pixels = Buffer.alloc(256 * 256 * 3);
  let seed = 1729;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).jpeg({ quality: 96 }).toFile(busyFile);
  const busy = await analyzeImage(busyFile);
  for (const result of [flat, smooth, busy]) valid(result);
  assert.equal(flat.background, 'flat');
  assert.equal(smooth.background, 'gradient');
  assert.equal(busy.background, 'busy');
  assert.ok(busy.busyness > flat.busyness);
  assert.ok(busy.busyness > smooth.busyness);
});

test('tiny solid and transparent sample inputs return finite useful measurements', async () => {
  const inputs = [
    { file: 'one-pixel.jpg', width: 1, height: 1, alpha: false, color: '#FFFFFF' },
    { file: 'tiny-dark.jpg', width: 2, height: 3, alpha: false, color: '#000000' },
    { file: 'empty-alpha.png', width: 3, height: 2, alpha: true, color: '#00000000' },
  ];
  for (const input of inputs) {
    const file = join(home, input.file);
    const source = sharp({ create: { width: input.width, height: input.height, channels: input.alpha ? 4 : 3, background: input.color } });
    await (input.alpha ? source.png() : source.jpeg()).toFile(file);
    const result = await analyzeImage(file);
    valid(result);
    assert.deepEqual([result.width, result.height], [input.width, input.height]);
    assert.equal(result.background, 'flat');
    assert.ok(result.whitespace_ratio > 0.95);
  }
});
