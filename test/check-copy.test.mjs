import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCopy } from '../scripts/check-copy.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function temp(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-copy-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test('clean text passes', () => {
  const dir = temp({ 'a.md': 'Plain words, nothing odd.\n', 'b.mjs': 'export const x = 1;\n' });
  try {
    const r = scanCopy(dir);
    assert.equal(r.scanned, 2);
    assert.deepEqual(r.findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('em dash and en dash are caught', () => {
  const dir = temp({ 'a.md': `one ${EM} two\n`, 'sub/b.json': `{"t": "3${EN}5"}\n` });
  try {
    const r = scanCopy(dir);
    assert.equal(r.findings.length, 2);
    assert.match(r.findings.join('\n'), /a\.md:1: em dash/);
    assert.match(r.findings.join('\n'), /sub\/b\.json:1: en dash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('banned words are caught, normal words are not', () => {
  const bad = [
    'beat' + ' sheet',
    'Auto' + 'pilot',
    'chin-' + 'lock',
    'the stu' + 'dio',
    'trial ' + 'reels',
    'style_' + 'plan',
    'render ' + 'lock',
    'reel ' + 'gate',
  ];
  const dir = temp({
    'bad.md': bad.join('\n') + '\n',
    'ok.md': 'A planned style, a studious person, a locked door, a pilot.\n',
  });
  try {
    const r = scanCopy(dir);
    assert.equal(r.findings.length, 8, r.findings.join('\n'));
    assert.ok(r.findings.every((f) => f.startsWith('bad.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('node_modules, fixtures and the lock file are skipped', () => {
  const dir = temp({
    'node_modules/x/readme.md': `x ${EM} y\n`,
    'test/fixtures/data.json': `{"a":"${EM}"}\n`,
    'package-lock.json': `{"a":"${EM}"}\n`,
    'keep.md': 'fine\n',
  });
  try {
    const r = scanCopy(dir);
    assert.equal(r.scanned, 1);
    assert.deepEqual(r.findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
