// The tests clean up after themselves: a representative set of temp-using helpers and the card preview script
// leave nothing behind in the OS temp folder. The temp folder is pointed at a private one for the test, so other
// test files running at the same time cannot change the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../core/util/fs.mjs';
import { useFakeDandelion } from './dandelion-fake.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_KEYS = ['TEMP', 'TMP', 'TMPDIR'];

/** @param {string} dir */
const kitEntries = (dir) => readdirSync(dir).filter((n) => /^(kit-|dandelion-kit)/.test(n));

test('temp helpers and the preview script leave no kit-* folders in the temp folder', () => {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'kit-leakcheck-')));
  const saved = Object.fromEntries(TEMP_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TEMP_KEYS) process.env[k] = sandbox;
  const run = async () => {
    const before = kitEntries(sandbox).length;
    // The helper most tests use, removed the way the tests remove it.
    const dir = makeTempDir('kit-sample-');
    assert.equal(dirname(dir), sandbox, 'makeTempDir follows the temp folder');
    assert.ok(existsSync(dir));
    rmSync(dir, { recursive: true, force: true });
    // The fake Dandelion makes a kit home and removes it on stop.
    const fake = await useFakeDandelion();
    assert.equal(dirname(fake.home), sandbox);
    await fake.stop();
    // The preview script writes its pages and its demo video to temp folders and removes both.
    const script = spawnSync(process.execPath, [join(ROOT, 'scripts', 'widget-preview.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, DANDELION_KIT_KEEP_WIDGET_PAGES: '' },
    });
    assert.equal(script.status, 0, script.stderr);
    assert.match(script.stdout, /Removed the card pages/);
    assert.equal(kitEntries(sandbox).length, before, `left behind: ${kitEntries(sandbox).join(', ')}`);
  };
  return run().finally(() => {
    for (const k of TEMP_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(sandbox, { recursive: true, force: true });
  });
});
