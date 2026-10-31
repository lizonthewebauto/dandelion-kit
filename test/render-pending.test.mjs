// Long builds answer "still building" instead of holding the call open past a host's time limit.
//   1. The background job helper on its own, with a stub build (no ffmpeg needed).
//   2. The text twin and the card scripts for the "still building" answer.
//   3. The real tools on the 11 second speech fixture: render_reel and make_variants with a tiny wait, a repeat call that
//      joins the same build, and get_project saying what is being built. Needs ffmpeg and the speech model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../core/util/fs.mjs';
import { detectFfmpeg } from '../core/media/ffmpeg.mjs';
import { overallProgress } from '../core/render/progress.mjs';
import { ok, ToolFailure } from '../server/lib/kit.mjs';
import { activeRender, renderWaitMs, runInBackground } from '../server/lib/render-jobs.mjs';
import { renderText } from '../server/text.mjs';
import { CARD_FIXTURES, PREVIEW_PENDING, PREVIEW_PENDING_VARIANTS, PROJECT_BUILDING, demoTool, newDemoState } from '../server/widgets/fixtures.mjs';
import { connectKit, textOf, useSharedModels, DASH_RE } from './server-helpers.mjs';

useSharedModels();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');
const delay = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tool context that remembers every progress report. @param {AbortSignal} [signal] */
function context(signal) {
  /** @type {[number, string|undefined][]} */
  const seen = [];
  return { seen, ctx: { progress: (/** @type {number} */ f, /** @type {string|undefined} */ m) => void seen.push([f, m]), signal } };
}

/** A build that waits for the test to let each step go. */
function steppedBuild() {
  let starts = 0;
  let permits = 0;
  /** @type {(() => void)[]} */
  const waiting = [];
  const gate = () =>
    new Promise((resolve) => {
      if (permits > 0) {
        permits -= 1;
        resolve(undefined);
      } else waiting.push(() => resolve(undefined));
    });
  return {
    get starts() { return starts; },
    release: () => {
      const next = waiting.shift();
      if (next) next();
      else permits += 1;
    },
    async start(/** @type {(f: number, m?: string) => void} */ report) {
      starts += 1;
      report(0.4, 'Building the video');
      await gate();
      report(0.7, 'Checking the result');
      await gate();
      return ok({ project_id: 'p_stub', finished: true });
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The job helper
// ---------------------------------------------------------------------------

test('the wait is 40 seconds, can be set with DANDELION_KIT_RENDER_WAIT_MS, and never passes the timer limit', () => {
  const before = process.env.DANDELION_KIT_RENDER_WAIT_MS;
  try {
    delete process.env.DANDELION_KIT_RENDER_WAIT_MS;
    assert.equal(renderWaitMs(), 40000);
    process.env.DANDELION_KIT_RENDER_WAIT_MS = '1';
    assert.equal(renderWaitMs(), 1);
    process.env.DANDELION_KIT_RENDER_WAIT_MS = 'soon';
    assert.equal(renderWaitMs(), 40000);
    process.env.DANDELION_KIT_RENDER_WAIT_MS = '';
    assert.equal(renderWaitMs(), 40000);
    process.env.DANDELION_KIT_RENDER_WAIT_MS = '99999999999';
    assert.equal(renderWaitMs(), 2_000_000_000);
  } finally {
    if (before === undefined) delete process.env.DANDELION_KIT_RENDER_WAIT_MS;
    else process.env.DANDELION_KIT_RENDER_WAIT_MS = before;
  }
});

test('overall progress only goes up from stage to stage', () => {
  const order = [['faces', 1], ['audio', 0], ['audio', 1], ['video', 0], ['video', 0.5], ['video', 1], ['checks', 0], ['checks', 1]];
  const values = order.map(([stage, f]) => /** @type {number} */ (overallProgress(/** @type {string} */ (stage), /** @type {number} */ (f))));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `${order[i]} did not go down`);
  assert.equal(overallProgress('done', 0), 1);
  assert.equal(overallProgress('mystery', 0.5), null);
});

test('a slow build answers pending, a repeat call joins it, and only one build ever starts', async () => {
  const build = steppedBuild();
  const first = context();
  const pending = await runInBackground({ key: 'job-a', projectId: 'p_job_a', tool: 'render_reel', quality: 'final', start: build.start, ctx: first.ctx, waitMs: 5 });
  assert.equal(pending.isError, undefined);
  assert.deepEqual(pending.data, { project_id: 'p_job_a', quality: 'final', tool: 'render_reel', pending: true, progress: 0.4, message: 'Building the video' });
  assert.deepEqual(activeRender('p_job_a'), { quality: 'final', progress: 0.4, tool: 'render_reel', message: 'Building the video' });
  assert.equal(activeRender('p_somebody_else'), null);

  // Asking again with the same key attaches. It sees the progress that comes after it joined.
  const second = context();
  const joined = runInBackground({ key: 'job-a', projectId: 'p_job_a', tool: 'render_reel', quality: 'final', start: build.start, ctx: second.ctx, waitMs: 5000 });
  await delay(20);
  build.release();
  await delay(20);
  assert.equal(activeRender('p_job_a')?.progress, 0.7);
  build.release();
  const done = await joined;
  assert.equal(build.starts, 1, 'the second call did not start a second build');
  assert.deepEqual(done.data, { project_id: 'p_stub', finished: true });
  assert.deepEqual(second.seen.map((s) => s[0]), [0.4, 0.7], 'progress kept flowing to the call that joined');
  assert.equal(activeRender('p_job_a'), null, 'nothing is building any more');

  // The answer was handed over, so the next call starts fresh.
  const again = steppedBuild();
  const third = runInBackground({ key: 'job-a', projectId: 'p_job_a', tool: 'render_reel', quality: 'final', start: again.start, ctx: context().ctx, waitMs: 5000 });
  await delay(10);
  again.release();
  again.release();
  await third;
  assert.equal(again.starts, 1);
});

test('a build that ends while nobody waits is handed over on the next call, and only once', async () => {
  let starts = 0;
  const start = async () => {
    starts += 1;
    await delay(30);
    return ok({ project_id: 'p_quiet', finished: true });
  };
  const input = { key: 'job-b', projectId: 'p_quiet', tool: /** @type {const} */ ('render_reel'), quality: /** @type {const} */ ('draft'), start };
  const pending = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1 });
  assert.equal(pending.data?.pending, true);
  await delay(80);
  const got = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1 });
  assert.deepEqual(got.data, { project_id: 'p_quiet', finished: true });
  assert.equal(starts, 1);
  const fresh = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1000 });
  assert.equal(fresh.data?.finished, true);
  assert.equal(starts, 2, 'after it was handed over, a new call is a new build');
});

test('an error from a build nobody waited for is returned on the next call, then cleared', async () => {
  let starts = 0;
  /** @type {boolean} */
  let fail = true;
  const start = async () => {
    starts += 1;
    await delay(30);
    if (fail) throw new ToolFailure('There is not enough room on the disk.');
    return ok({ project_id: 'p_err', finished: true });
  };
  const input = { key: 'job-c', projectId: 'p_err', tool: /** @type {const} */ ('make_variants'), quality: /** @type {const} */ ('final'), extra: { count: 2 }, start };
  const pending = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1 });
  assert.deepEqual(pending.data, { project_id: 'p_err', quality: 'final', tool: 'make_variants', count: 2, pending: true, progress: 0, message: 'Getting ready' });
  await delay(80);
  assert.equal(activeRender('p_err'), null, 'a failed build is not "building"');
  const failed = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1000 });
  assert.equal(failed.isError, true);
  assert.equal(failed.text, 'There is not enough room on the disk.');
  assert.equal(starts, 1, 'the stored error was returned without starting again');
  fail = false;
  const retry = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1000 });
  assert.equal(retry.isError, undefined);
  assert.equal(retry.data?.finished, true);
  assert.equal(starts, 2);
});

test('an error while somebody waits comes straight back to them and is not kept', async () => {
  let starts = 0;
  const start = async () => {
    starts += 1;
    await delay(10);
    throw new ToolFailure('The video builder stopped.');
  };
  const input = { key: 'job-d', projectId: 'p_err2', tool: /** @type {const} */ ('render_reel'), quality: /** @type {const} */ ('draft'), start };
  const first = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1000 });
  assert.equal(first.isError, true);
  assert.equal(first.text, 'The video builder stopped.');
  const second = await runInBackground({ ...input, ctx: context().ctx, waitMs: 1000 });
  assert.equal(second.isError, true);
  assert.equal(starts, 2, 'the first error was not kept, so this was a new build');
});

test('a cancelled call stops waiting but not the build', async () => {
  const build = steppedBuild();
  const controller = new AbortController();
  const waiting = runInBackground({ key: 'job-e', projectId: 'p_cancel', tool: 'render_reel', quality: 'final', start: build.start, ctx: context(controller.signal).ctx, waitMs: 60000 });
  await delay(20);
  controller.abort();
  const answer = await waiting;
  assert.equal(answer.data?.pending, true);
  assert.equal(activeRender('p_cancel')?.tool, 'render_reel', 'the build is still going');
  build.release();
  build.release();
  const finished = await runInBackground({ key: 'job-e', projectId: 'p_cancel', tool: 'render_reel', quality: 'final', start: build.start, ctx: context().ctx, waitMs: 5000 });
  assert.equal(finished.data?.finished, true);
  assert.equal(build.starts, 1);
});

// ---------------------------------------------------------------------------
// 2. Text and cards
// ---------------------------------------------------------------------------

test('the text for a pending build says it is still building and how to ask again', () => {
  const final = renderText('render_reel', PREVIEW_PENDING);
  assert.match(final, /final reel is still being built/);
  assert.match(final, /45% done/);
  assert.match(final, /[Cc]all render_reel again with the same arguments \(project_id p_demo and quality final\)/);
  assert.match(final, /get_project/);
  const variants = renderText('make_variants', PREVIEW_PENDING_VARIANTS);
  assert.match(variants, /variants are still being built/);
  assert.match(variants, /[Cc]all make_variants again with the same arguments \(project_id p_demo and count 2\)/);
  for (const t of [final, variants]) assert.ok(!DASH_RE.test(t) && !/undefined|NaN/.test(t));
  const project = renderText('get_project', PROJECT_BUILDING);
  assert.match(project, /Building now: the final reel, 45% done/);
  assert.match(project, /render_reel again/);
});

test('the pending samples exist, match the shape, and the demo shows them before the finished reel', () => {
  for (const sample of [PREVIEW_PENDING, PREVIEW_PENDING_VARIANTS]) {
    assert.equal(sample.pending, true);
    assert.equal(sample.quality, 'final');
    assert.ok(sample.progress > 0 && sample.progress < 1);
    assert.ok(sample.message.length > 0);
  }
  assert.ok(CARD_FIXTURES.some((f) => f.widget === 'kit-preview' && /** @type {any} */ (f.data).pending));
  assert.ok(CARD_FIXTURES.some((f) => f.widget === 'kit-project' && /** @type {any} */ (f.data).rendering));
  const state = newDemoState();
  const args = { project_id: 'p_demo', quality: 'final' };
  const asks = [1, 2, 3].map(() => /** @type {any} */ (demoTool('render_reel', args, state)).structuredContent);
  assert.deepEqual(asks.map((a) => !!a.pending), [true, true, false]);
  assert.ok(asks[1].progress > asks[0].progress);
  assert.equal(asks[2].renders.length, 2);
  assert.equal(/** @type {any} */ (demoTool('render_reel', { project_id: 'p_demo', quality: 'draft' }, state)).structuredContent.renders.length, 1);
  assert.equal(/** @type {any} */ (demoTool('make_variants', { project_id: 'p_demo', count: 2 }, state)).structuredContent.pending, true);
  assert.equal(/** @type {any} */ (demoTool('make_variants', { project_id: 'p_demo', count: 2 }, state)).structuredContent.renders.length, 4);
});

test('the cards handle the pending answer: a progress bar, Check again, and the model is told', () => {
  const preview = readFileSync(join(ROOT, 'server', 'widgets', 'kit-preview.js'), 'utf8');
  assert.match(preview, /if \(d\.pending\) return buildPending\(d\)/);
  assert.match(preview, /DK\.progress\(d\.progress/);
  assert.match(preview, /"Check again"/);
  assert.match(preview, /DK\.call\("render_reel", \{ project_id: pid, quality: d\.quality === "draft" \? "draft" : "final" \}\)/);
  assert.match(preview, /DK\.call\("make_variants", \{ project_id: pid, count: d\.count \|\| 2 \}\)/);
  assert.match(preview, /tapped Check again[\s\S]*?DK\.go\(tool, r\)/);
  const project = readFileSync(join(ROOT, 'server', 'widgets', 'kit-project.js'), 'utf8');
  assert.match(project, /tellPending/);
  assert.match(project, /if \(d\.rendering\)/);
  assert.match(project, /"Check again"/);
  const runtime = readFileSync(join(ROOT, 'server', 'widgets', 'runtime.js'), 'utf8');
  assert.match(runtime, /DK\.progress = function/);
  assert.match(runtime, /role: "progressbar"/);
});

// ---------------------------------------------------------------------------
// 3. The real tools
// ---------------------------------------------------------------------------

const ff = await detectFfmpeg();
const skip = ff.found && ff.has_ass ? false : 'ffmpeg with captions is not installed';

let home = '';
/** @type {string|undefined} */
let previousHome;
/** @type {string|undefined} */
let previousWait;
/** @type {Awaited<ReturnType<typeof connectKit>>} */
let kit;
let pid = '';

before(async () => {
  previousHome = process.env.DANDELION_KIT_HOME;
  previousWait = process.env.DANDELION_KIT_RENDER_WAIT_MS;
  home = makeTempDir('kit-pending-test-');
  process.env.DANDELION_KIT_HOME = home;
  kit = await connectKit();
});
after(async () => {
  await kit.close();
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previousHome;
  if (previousWait === undefined) delete process.env.DANDELION_KIT_RENDER_WAIT_MS;
  else process.env.DANDELION_KIT_RENDER_WAIT_MS = previousWait;
  rmSync(home, { recursive: true, force: true });
});

test('set up a project with a shot plan', { skip, timeout: 240000 }, async () => {
  const opened = await kit.call('open_video', { path: SPEECH, title: 'Pending test' });
  assert.equal(opened.isError, undefined, textOf(opened));
  pid = opened.structuredContent.project.id;
  for (const [name, args] of /** @type {[string, Record<string, any>][]} */ ([
    ['rough_cut', { project_id: pid }],
    ['pick_look', { project_id: pid, look: 'bold-value' }],
    ['plan_shots', { project_id: pid }],
  ])) {
    const r = await kit.call(name, args);
    assert.equal(r.isError, undefined, `${name}: ${textOf(r)}`);
  }
});

test('render_reel answers pending with a tiny wait, get_project says it is building, and a repeat call gets the finished reel', { skip, timeout: 240000 }, async () => {
  process.env.DANDELION_KIT_RENDER_WAIT_MS = '1';
  const first = await kit.call('render_reel', { project_id: pid, quality: 'draft' });
  assert.equal(first.isError, undefined, textOf(first));
  const pending = first.structuredContent;
  assert.equal(pending.pending, true);
  assert.equal(pending.project_id, pid);
  assert.equal(pending.quality, 'draft');
  assert.equal(pending.tool, 'render_reel');
  assert.ok(pending.progress >= 0 && pending.progress <= 1);
  assert.equal(typeof pending.message, 'string');
  assert.equal(pending.renders, undefined);
  assert.match(textOf(first), /still being built/);
  assert.match(textOf(first), /[Cc]all render_reel again with the same arguments/);
  assert.ok(!DASH_RE.test(textOf(first)));

  const status = await kit.call('get_project', { project_id: pid });
  assert.equal(status.structuredContent.rendering.quality, 'draft');
  assert.equal(status.structuredContent.rendering.tool, 'render_reel');
  assert.ok(status.structuredContent.rendering.progress >= 0);
  assert.match(textOf(status), /Building now: the draft/);

  // Asking again with the same arguments joins the build that is running and waits for it.
  process.env.DANDELION_KIT_RENDER_WAIT_MS = '200000';
  const second = await kit.call('render_reel', { project_id: pid, quality: 'draft' });
  assert.equal(second.isError, undefined, textOf(second));
  assert.equal(second.structuredContent.pending, undefined);
  assert.equal(second.structuredContent.active, 'draft');
  const draft = second.structuredContent.renders.find((/** @type {any} */ r) => r.id === 'draft');
  assert.ok(draft && draft.checks.length >= 8 && draft.frame_asset_ids.length === 8);
  assert.ok(textOf(second).includes(draft.file));
  const drafts = readdirSync(join(home, 'projects', pid, 'render')).filter((n) => /^draft-.*\.mp4$/.test(n));
  assert.equal(drafts.length, 1, 'one draft file, so one build');

  const done = await kit.call('get_project', { project_id: pid });
  assert.equal(done.structuredContent.rendering, undefined);
  assert.equal(done.structuredContent.project.has_draft, true);
  assert.doesNotMatch(textOf(done), /Building now/);

  // A finished build is in the cache, so the same call is quick and gives the same answer.
  const third = await kit.call('render_reel', { project_id: pid, quality: 'draft' });
  assert.equal(third.structuredContent.renders.find((/** @type {any} */ r) => r.id === 'draft').file, draft.file);
});

test('make_variants answers pending with a tiny wait and a repeat call gets both variants', { skip, timeout: 420000 }, async () => {
  process.env.DANDELION_KIT_RENDER_WAIT_MS = '1';
  const first = await kit.call('make_variants', { project_id: pid, count: 2 });
  assert.equal(first.isError, undefined, textOf(first));
  const pending = first.structuredContent;
  assert.equal(pending.pending, true);
  assert.equal(pending.tool, 'make_variants');
  assert.equal(pending.quality, 'final');
  assert.equal(pending.count, 2);
  assert.match(textOf(first), /[Cc]all make_variants again with the same arguments/);
  const status = await kit.call('get_project', { project_id: pid });
  assert.equal(status.structuredContent.rendering.tool, 'make_variants');
  assert.match(textOf(status), /Building now: the variants/);

  process.env.DANDELION_KIT_RENDER_WAIT_MS = '400000';
  const second = await kit.call('make_variants', { project_id: pid, count: 2 });
  assert.equal(second.isError, undefined, textOf(second));
  const variants = second.structuredContent.renders.filter((/** @type {any} */ r) => r.variant_id);
  assert.equal(variants.length, 2);
  assert.match(textOf(second), /This variant: hook/);
  assert.equal((await kit.call('get_project', { project_id: pid })).structuredContent.rendering, undefined);
});
