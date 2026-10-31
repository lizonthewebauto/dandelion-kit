import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as types from '../core/types.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('closed lists have the sizes the plan names', () => {
  assert.equal(types.CHANNEL_IDS.length, 8);
  assert.equal(types.LOOK_IDS.length, 5);
  assert.equal(types.LOOK_IDS[0], 'karaoke-clean');
  assert.equal(types.CAPTION_THEMES.length, 8);
  assert.equal(types.CAPTION_THEMES[0], 'karaoke-highlight');
  assert.equal(types.BEAT_KINDS.length, 10);
  assert.equal(types.LAYOUT_IDS.length, 12);
  assert.equal(types.TREATMENTS.length, 6);
  assert.deepEqual([...types.POST_KINDS], ['text', 'image', 'carousel', 'video', 'thread']);
  assert.deepEqual([...types.CHECK_STATUSES], ['pass', 'warn', 'stop']);
});

test('image sizes', () => {
  assert.deepEqual(
    Object.values(types.IMAGE_SIZES).map((s) => [s.width, s.height]),
    [
      [1080, 1350],
      [1080, 1080],
      [1080, 1920],
    ],
  );
});

test('lists are frozen and have no duplicates', () => {
  for (const key of [
    'CHANNEL_IDS',
    'LOOK_IDS',
    'CAPTION_THEMES',
    'BEAT_KINDS',
    'TREATMENTS',
    'LAYOUT_IDS',
    'POST_KINDS',
  ]) {
    const list = types[key];
    assert.ok(Object.isFrozen(list), `${key} is frozen`);
    assert.equal(new Set(list).size, list.length, `${key} has no duplicates`);
  }
});

/** @param {string} dir @param {string[]} out */
function modules(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'fixtures') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) modules(p, out);
    else if (name.endsWith('.mjs') && !p.includes(join('test', ''))) out.push(p);
  }
  return out;
}

test('every scaffold module loads', async () => {
  const skip = new Set([join(ROOT, 'bin', 'kit.mjs'), join(ROOT, 'scripts', 'check-copy.mjs')]);
  let count = 0;
  for (const dir of ['server', 'core', 'scripts']) {
    for (const file of modules(join(ROOT, dir))) {
      if (skip.has(file)) continue;
      await import(pathToFileURL(file).href);
      count += 1;
    }
  }
  assert.ok(count >= 70, `loaded ${count} modules`);
});
