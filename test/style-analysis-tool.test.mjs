import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { detectFfmpeg, runFfmpeg } from '../core/media/ffmpeg.mjs';
import { connectKit, textOf, DASH_RE } from './server-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-sample-tool-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function image(file) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#102A43"/><rect x="50" y="130" width="360" height="70" fill="#F0F4F8"/><rect x="50" y="320" width="120" height="100" fill="#FFB400"/></svg>';
  await sharp(Buffer.from(svg)).jpeg({ quality: 94 }).toFile(file);
  return file;
}

function underBudget(data) {
  const encoded = JSON.stringify(data);
  assert.ok(Buffer.byteLength(encoded) < 50000, `structured data uses ${Buffer.byteLength(encoded)} bytes`);
  assert.doesNotMatch(encoded, /data:image|\/9j\//);
  assert.ok(!DASH_RE.test(encoded));
}

test('one image over real stdio gives 29 tools, a JPEG block and a local sheet path', { timeout: 90000 }, async () => {
  const sample = await image(join(home, 'one.jpg'));
  const before = await readFile(sample);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(ROOT, 'bin', 'kit.mjs'), 'serve'],
    env: { ...process.env, DANDELION_KIT_HOME: home, DANDELION_KIT_NO_BROWSER: '1' }, stderr: 'pipe',
  });
  const client = new Client({ name: 'kit-sample-proof', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 29);
    const result = /** @type {any} */ (await client.callTool({ name: 'analyze_samples', arguments: { paths: [`"${sample}"`] } }, undefined, { timeout: 80000 }));
    assert.ok(!result.isError, textOf(result));
    const data = result.structuredContent;
    assert.equal(data.images.length, 1);
    assert.equal(data.videos.length, 0);
    assert.equal(data.images[0].path, sample);
    assert.match(data.contact_sheet.asset_id, /^a_/);
    const asset = /** @type {any} */ (await client.callTool({ name: 'read_asset', arguments: { asset_id: data.contact_sheet.asset_id, offset: 0, bytes: 64 } }));
    assert.ok(!asset.isError, textOf(asset));
    assert.equal(asset.structuredContent.mime, 'image/jpeg');
    assert.ok(Buffer.from(asset.structuredContent.data, 'base64').subarray(0, 3).equals(Buffer.from([255, 216, 255])));
    const sheet = await readFile(data.contact_sheet.file);
    assert.ok(sheet.length < 500000);
    const metadata = await sharp(sheet).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok((metadata.width ?? Infinity) <= 1600);
    const block = result.content.find(c => c.type === 'image');
    assert.ok(block);
    assert.equal(block.mimeType, 'image/jpeg');
    assert.deepEqual(Buffer.from(block.data, 'base64'), sheet);
    assert.equal(result.content[0].type, 'text');
    assert.ok(textOf(result).includes(data.contact_sheet.file));
    assert.match(textOf(result), /open it if you cannot see the picture/i);
    assert.match(textOf(result), /small sample/i);
    assert.match(textOf(result), /What do you like about this one\?/);
    assert.ok(!DASH_RE.test(textOf(result)));
    assert.equal(data.rubrics.fonts.length, 8);
    assert.equal(data.rubrics.caption_themes.length, 8);
    assert.equal(data.rubrics.tokens.length, 5);
    assert.equal(data.rubrics.looks.length, 5);
    assert.ok(data.suggested_style.brand?.colors);
    assert.equal(data.suggested_style.name, undefined);
    underBudget(data);
    assert.deepEqual(await readFile(sample), before);
    assert.ok(!(await readdir(home)).includes('styles'), 'analysis never saves a style on its own');
  } finally { await client.close(); }
});

test('one short video works without speech and leaves cadence choices out', { timeout: 180000 }, async t => {
  if (!(await detectFfmpeg()).found) return t.skip('ffmpeg is not installed');
  const sample = join(home, 'one-clip.mp4');
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x240:r=20:d=3', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sample]);
  const before = await readFile(sample);
  const kit = await connectKit();
  try {
    const result = /** @type {any} */ (await kit.client.callTool({ name: 'analyze_samples', arguments: { paths: [sample] } }, undefined, { timeout: 170000 }));
    assert.ok(!result.isError, textOf(result));
    const data = result.structuredContent;
    assert.equal(data.images.length, 0);
    assert.equal(data.videos.length, 1);
    assert.equal(data.videos[0].speech, 'unavailable');
    assert.equal(data.videos[0].confidence, 'low');
    assert.equal(data.videos[0].words_per_minute, null);
    assert.equal(data.videos[0].pause_ms, null);
    assert.match(textOf(result), /too few cuts/i);
    for (const field of ['cut_every_ms_min', 'cut_every_ms_max', 'camera_aggression', 'density_per_10s']) assert.equal(data.suggested_style.video?.overrides?.[field], undefined, field);
    assert.equal(data.suggested_style.video?.base_look, undefined);
    assert.ok(result.content.some(c => c.type === 'image' && c.mimeType === 'image/jpeg'));
    underBudget(data);
    assert.deepEqual(await readFile(sample), before);
  } finally { await kit.close(); }
});

test('folders read at most 20 samples and count the files they skip', { timeout: 120000 }, async () => {
  const folder = join(home, 'samples');
  await mkdir(folder);
  for (let i = 0; i < 24; i++) await image(join(folder, `a-${String(i).padStart(2, '0')}.jpg`));
  await writeFile(join(folder, 'z-bad.jpg'), 'This is not an image.');
  await writeFile(join(folder, 'z-notes.txt'), 'Leave this text file where it is.');
  const before = (await readdir(folder)).sort();
  const kit = await connectKit();
  try {
    const result = await kit.call('analyze_samples', { paths: [folder] });
    assert.ok(!result.isError, textOf(result));
    const data = result.structuredContent;
    assert.equal(data.images.length, 20);
    assert.equal(data.videos.length, 0);
    assert.ok(data.skipped_count >= 6);
    assert.ok(Array.isArray(data.skipped) && data.skipped.length);
    assert.match(textOf(result), /skip/i);
    underBudget(data);
    assert.deepEqual((await readdir(folder)).sort(), before);
  } finally { await kit.close(); }
});

test('bad samples are skipped and no usable samples gives a plain failure', async () => {
  const good = await image(join(home, 'good.jpg'));
  const bad = join(home, 'bad.jpg');
  await writeFile(bad, 'This is not an image.');
  const kit = await connectKit();
  try {
    const mixed = await kit.call('analyze_samples', { paths: [good, bad] });
    assert.ok(!mixed.isError, textOf(mixed));
    assert.equal(mixed.structuredContent.images.length, 1);
    assert.ok(mixed.structuredContent.skipped_count >= 1);
    const empty = await kit.call('analyze_samples', { paths: [bad, join(home, 'missing.jpg')] });
    assert.equal(empty.isError, true);
    assert.ok(textOf(empty).length > 10);
    assert.doesNotMatch(textOf(empty), /\n\s+at /);
    assert.ok(!DASH_RE.test(textOf(empty)));
    for (const paths of [[], Array.from({length: 21}, () => good)]) assert.equal((await kit.call('analyze_samples', { paths })).isError, true);
  } finally { await kit.close(); }
});
