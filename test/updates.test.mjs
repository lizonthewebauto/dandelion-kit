import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUpdates, newerVersion, updateAction, updateText, RELEASE_URL } from '../core/util/updates.mjs';
function fixture(t) { const dir = mkdtempSync(join(tmpdir(), 'kit-update-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return { cacheFile: join(dir, 'release.json'), installed: '1.1.5', now: 100000000 }; }
const release = (version) => async () => ({ ok: true, text: async () => JSON.stringify({ tag_name: version, draft: false, prerelease: false }) });
test('public update check compares stable versions and reuses metadata without sending identity', async t => {
  const options = fixture(t); let calls = 0;
  const fetchImpl = async (url, init) => { calls++; assert.equal(url, RELEASE_URL); assert.equal(init.body, undefined); assert.deepEqual(Object.keys(init.headers), ['Accept']); return release('v1.2.0')(); };
  const status = await checkUpdates({ ...options, fetchImpl });
  assert.equal(status.available, true); assert.equal(status.latest, '1.2.0'); assert.match(updateText(status), /Update available/);
  const cached = await checkUpdates({ ...options, installed: '1.2.0', fetchImpl });
  assert.equal(calls, 1); assert.equal(cached.available, false); assert.equal(cached.checked, true);
  assert.equal(newerVersion('1.1.5', '1.1.5'), false); assert.equal(newerVersion('1.1.4', '1.1.5'), false); assert.equal(newerVersion('1.10.0', '1.9.9'), true);
});
test('offline and malformed responses cannot block editing or supply commands', async t => {
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => ({ ok: true, text: async () => '{broken' }), release('v9.9.9;curl x')]) {
    const options = fixture(t); const status = await checkUpdates({ ...options, fetchImpl });
    assert.equal(status.available, false); assert.equal(status.checked, false); assert.match(updateText(status), /Editing can continue/);
    const cached = JSON.parse(readFileSync(options.cacheFile, 'utf8')); assert.equal(cached.ok, false);
  }
});
test('stalled fetch is bounded and a failed refresh retains known release', async t => {
  const options = fixture(t); writeFileSync(options.cacheFile, JSON.stringify({ at: 0, latest: '1.1.6', ok: true }));
  const status = await checkUpdates({ ...options, timeoutMs: 10, fetchImpl: () => new Promise(() => {}) });
  assert.equal(status.available, true); assert.equal(status.checked, false); assert.equal(status.latest, '1.1.6');
});
test('host steps are fixed and source instructions preserve local work', () => {
  assert.match(updateAction('/Users/me/.codex/plugins/cache/dandelion-kit/dandelion-kit/1'), /codex plugin marketplace upgrade dandelion-kit/);
  assert.match(updateAction('/Users/me/.claude/plugins/cache/dandelion-kit/dandelion-kit/1'), /claude plugin update dandelion-kit@dandelion-kit/);
  assert.match(updateAction('/source'), /Preserve local changes/);
});
