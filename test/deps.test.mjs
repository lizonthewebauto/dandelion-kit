import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { depsHome, depsReady, packageReachable } from '../bin/deps.mjs';
import { MIN_FREE_BYTES, renderSpaceBytes } from '../core/util/disk.mjs';

const DEPS = { '@modelcontextprotocol/sdk': '1.0.0', zod: '4.0.0' };

/** A fake install: <base>/node_modules/dandelion-kit with its packages either inside it or one level up (npx). */
function layout(where) {
  const base = mkdtempSync(join(tmpdir(), 'kit-deps-'));
  const kit = join(base, 'node_modules', 'dandelion-kit');
  mkdirSync(kit, { recursive: true });
  writeFileSync(join(kit, 'package.json'), JSON.stringify({ name: 'dandelion-kit', dependencies: DEPS }));
  const home = where === 'inside' ? join(kit, 'node_modules') : join(base, 'node_modules');
  for (const name of where === 'none' ? [] : Object.keys(DEPS)) {
    mkdirSync(join(home, ...name.split('/')), { recursive: true });
    writeFileSync(join(home, ...name.split('/'), 'package.json'), '{}');
  }
  return { base, kit };
}

test('packages inside the kit folder count as installed', () => {
  const { base, kit } = layout('inside');
  try {
    assert.equal(depsReady(kit), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('packages one level up, the way npx installs them, count as installed', () => {
  const { base, kit } = layout('hoisted');
  try {
    assert.equal(packageReachable(kit, '@modelcontextprotocol/sdk'), true);
    assert.equal(depsReady(kit), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('in a plugin cache the packages live outside the version folder, which Codex replaces each session', () => {
  assert.equal(depsHome('/u/.codex/plugins/cache/dandelion-kit/dandelion-kit/1.0.7'), '/u/.codex/plugins');
  assert.equal(depsHome('C:\\u\\.codex\\plugins\\cache\\dandelion-kit\\dandelion-kit\\1.0.7'), 'C:\\u\\.codex\\plugins');
  assert.equal(depsHome('/u/App Repos/dandelion-kit'), '/u/App Repos/dandelion-kit');
});

test('packages in the plugins folder count only for the same Kit version, so an update installs its own', () => {
  const base = mkdtempSync(join(tmpdir(), 'kit-deps-'));
  try {
    const plugins = join(base, 'plugins');
    const kit = join(plugins, 'cache', 'dandelion-kit', 'dandelion-kit', '1.0.7');
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, 'package.json'), JSON.stringify({ version: '1.0.7', dependencies: DEPS }));
    assert.equal(depsReady(kit), false);
    for (const name of Object.keys(DEPS)) {
      mkdirSync(join(plugins, 'node_modules', ...name.split('/')), { recursive: true });
      writeFileSync(join(plugins, 'node_modules', ...name.split('/'), 'package.json'), '{}');
    }
    writeFileSync(join(plugins, 'package.json'), JSON.stringify({ version: '1.0.6', dependencies: DEPS }));
    assert.equal(depsReady(kit), false, 'packages from an older Kit do not count');
    writeFileSync(join(plugins, 'package.json'), JSON.stringify({ version: '1.0.7', dependencies: DEPS }));
    assert.equal(depsReady(kit), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a short clip asks for less disk space, and a long reel or an unknown length asks for the full 3 GB', () => {
  const gb = (n) => n / 1024 / 1024 / 1024;
  assert.ok(gb(renderSpaceBytes(10_000)) < 1.3);
  assert.ok(gb(renderSpaceBytes(10_000)) > 1);
  assert.equal(renderSpaceBytes(113_000), MIN_FREE_BYTES);
  assert.equal(renderSpaceBytes(), MIN_FREE_BYTES);
  assert.equal(renderSpaceBytes(0), MIN_FREE_BYTES);
});

test('missing packages are not installed, and one missing package is enough', () => {
  const { base, kit } = layout('none');
  try {
    assert.equal(depsReady(kit), false);
    mkdirSync(join(base, 'node_modules', 'zod'), { recursive: true });
    writeFileSync(join(base, 'node_modules', 'zod', 'package.json'), '{}');
    assert.equal(depsReady(kit), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
