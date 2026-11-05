import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUsageReporter } from '../core/util/usage-reporting.mjs';
import { tool } from '../server/tools/usage_reporting.mjs';

/** @param {(reporter: ReturnType<typeof createUsageReporter>, calls: any[], home: string) => Promise<void>} run
 * @param {{fetchImpl?: typeof fetch, disabled?: boolean}} [options] */
async function isolated(run, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'kit-usage-'));
  const calls = /** @type {any[]} */ ([]);
  const reporter = createUsageReporter({
    home, platform: 'win32', version: '1.1.1', disabled: false,
    fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(String(init?.body)) }); return new Response(null, { status: 202 }); },
    ...options,
  });
  try { await run(reporter, calls, home); }
  finally { await rm(home, { recursive: true, force: true }); }
}

test('off by default: no event, identifier or state file before explicit consent', () => isolated(async (reporter, calls, home) => {
  assert.equal((await reporter.status()).chosen, false);
  await reporter.installed();
  await reporter.firstUse();
  assert.equal(calls.length, 0);
  assert.equal(existsSync(join(home, 'usage-reporting.json')), false);
  await reporter.setEnabled(false);
  assert.equal((await reporter.status()).chosen, true);
  assert.equal(existsSync(join(home, 'usage-reporting.json')), false);
}));

test('only allowed fields leave the machine; install and first use count once despite parallel calls and toggles', () => isolated(async (reporter, calls) => {
  await reporter.setEnabled(true);
  await Promise.all([reporter.firstUse(), reporter.firstUse(), reporter.installed()]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.body.event), ['install_completed', 'first_use']);
  for (const call of calls) {
    assert.equal(call.url, 'https://dandelionapp.io/api/kit/events');
    assert.deepEqual(Object.keys(call.body).sort(), ['event', 'installation_id', 'platform', 'version']);
    assert.match(call.body.installation_id, /^[0-9a-f-]{36}$/);
    assert.equal(call.body.platform, 'windows');
    assert.equal(call.init.redirect, 'error');
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].body.installation_id, calls[1].body.installation_id);
  await reporter.setEnabled(false);
  await reporter.firstUse();
  await reporter.setEnabled(true);
  await reporter.firstUse();
  assert.equal(calls.length, 2);
}));

test('restarting keeps the same ID and never repeats an acknowledged first use', () => isolated(async (reporter, calls, home) => {
  await reporter.setEnabled(true);
  await reporter.firstUse();
  const restarted = createUsageReporter({ home, disabled: false, fetchImpl: async () => { throw new Error('must not send twice'); } });
  assert.equal(await restarted.firstUse(), false);
  assert.equal(calls.length, 2);
}));

test('offline errors do not fail output and unacknowledged events can be retried', () => isolated(async (reporter) => {
  await reporter.setEnabled(true);
  assert.equal(await reporter.installed(), false);
  assert.equal(await reporter.firstUse(), false);
}, { fetchImpl: async () => { throw new Error('offline'); } }));

test('a finished offline output is queued and retried on next startup without another edit', () => isolated(async (reporter, _calls, home) => {
  await reporter.setEnabled(true);
  await reporter.firstUse();
  const saved = JSON.parse(await readFile(join(home, 'usage-reporting.json'), 'utf8'));
  assert.equal(saved.pending.first_use, true);
  const events = /** @type {any[]} */ ([]);
  const restarted = createUsageReporter({ home, platform: 'win32', version: '1.1.2', disabled: false, fetchImpl: async (_url, init) => {
    events.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 202 });
  } });
  await restarted.installed();
  await restarted.installed();
  assert.deepEqual(events.map(e => e.event), ['install_completed', 'first_use']);
  assert.equal(events[1].installation_id, saved.installation_id);
  const final = JSON.parse(await readFile(join(home, 'usage-reporting.json'), 'utf8'));
  assert.equal(final.pending.first_use, false);
  assert.equal(final.sent.first_use, true);
}, { fetchImpl: async () => { throw new Error('offline'); } }));

test('CI or owner kill switch prevents sending even for an opted-in install', () => isolated(async (reporter, calls, home) => {
  await reporter.setEnabled(true);
  const blocked = createUsageReporter({ home, disabled: true, fetchImpl: async () => { throw new Error('must not send'); } });
  assert.equal((await blocked.status()).enabled, false);
  await blocked.firstUse();
  assert.equal(calls.length, 0);
}));

test('a rejected report is retried with the same ID and acknowledged only once', () => isolated(async (reporter, calls, home) => {
  await reporter.setEnabled(true);
  let count = 0;
  const flaky = createUsageReporter({ home, disabled: false, fetchImpl: async (url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: ++count === 1 ? 503 : 202 });
  } });
  assert.equal(await flaky.installed(), false);
  assert.equal(await flaky.installed(), true);
  await flaky.installed();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].installation_id, calls[1].installation_id);
}));

test('an in-flight acknowledgement cannot undo an opt-out from another process', () => isolated(async (reporter, _calls, home) => {
  await reporter.setEnabled(true);
  let release = () => {};
  let entered = () => {};
  const waiting = new Promise(resolve => { release = () => resolve(undefined); });
  const started = new Promise(resolve => { entered = () => resolve(undefined); });
  const running = createUsageReporter({ home, disabled: false, fetchImpl: async () => {
    entered(); await waiting; return new Response(null, { status: 202 });
  } });
  const send = running.installed();
  await started;
  await reporter.setEnabled(false);
  release();
  await send;
  assert.equal((await running.status()).enabled, false);
  assert.equal((await running.status()).chosen, true);
}));

test('demo consent calls never change a real preference', async () => {
  const result = await tool.run({ action: 'on' }, { demo: true, progress() {} });
  assert.equal(result.data?.enabled, false);
  assert.match(result.text ?? '', /sample/);
});

test('failed image work reports nothing; a finished image and export report first use only once', async () => {
  const { tool: makeImage } = await import('../server/tools/make_image.mjs');
  const { tool: exportFiles } = await import('../server/tools/export.mjs');
  const home = await mkdtemp(join(tmpdir(), 'kit-usage-output-'));
  const priorHome = process.env.DANDELION_KIT_HOME;
  const priorOff = process.env.DANDELION_KIT_TELEMETRY;
  const priorCi = process.env.CI;
  const priorNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  const calls = /** @type {any[]} */ ([]);
  process.env.DANDELION_KIT_HOME = home;
  delete process.env.DANDELION_KIT_TELEMETRY;
  delete process.env.CI;
  delete process.env.NODE_ENV;
  globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return new Response(null, { status: 202 }); };
  const ctx = { progress() {} };
  try {
    await tool.run({ action: 'on' }, ctx);
    assert.deepEqual(calls.map(c => c.event), ['install_completed']);
    await assert.rejects(makeImage.run({ title: 'Image', layout: 'cover', fields: { title: 'x'.repeat(150) } }, ctx));
    assert.equal(calls.length, 1);
    const result = await makeImage.run({ title: 'Image', layout: 'cover', fields: { title: 'A small step' } }, ctx);
    assert.deepEqual(calls.map(c => c.event), ['install_completed', 'first_use']);
    await exportFiles.run({ project_id: result.data?.project_id }, ctx);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorHome === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = priorHome;
    if (priorOff === undefined) delete process.env.DANDELION_KIT_TELEMETRY; else process.env.DANDELION_KIT_TELEMETRY = priorOff;
    if (priorCi === undefined) delete process.env.CI; else process.env.CI = priorCi;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    await rm(home, { recursive: true, force: true });
  }
});

