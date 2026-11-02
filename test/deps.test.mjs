import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { depsReady, packageReachable } from '../bin/deps.mjs';

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
