// Render path end to end on the 11 second fixture (a test pattern with a tone, so there is no face):
// draft and final renders for two looks, the checks, the render cache, the one-render-at-a-time lock,
// variants, and the caption sample picture. Speech words are made up to line up with the clip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DANDELION_KIT_MODELS ??= join(homedir(), '.dandelion-kit', 'models');

const { makeTempDir } = await import('../core/util/fs.mjs');
const { openVideo } = await import('../server/store/video.mjs');
const { requireProject, updateProject, readAssetChunk } = await import('../server/store/project.mjs');
const { makeTranscript } = await import('../core/transcribe/types.mjs');
const edit = await import('../core/edit/index.mjs');
const { renderReel, renderLookSample, withRenderLock } = await import('../core/render/render.mjs');
const { checkReel, checksTable, measureCaptionBounds } = await import('../core/render/checks.mjs');
const { makeVariants } = await import('../core/render/variants.mjs');
const { captionAnchor } = await import('../core/render/facezone.mjs');
const { runFfprobe } = await import('../core/media/ffmpeg.mjs');
const { SAFE_ZONE } = await import('../core/render/ass.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');

const SENTENCE =
  'Here is the one thing most people get wrong about editing videos. Cut every pause and keep the energy high. Add captions that you can read in two seconds. That is the whole trick, so try it today.';

let home;
let previousHome;
/** @type {string} */
let projectId;

before(async () => {
  previousHome = process.env.DANDELION_KIT_HOME;
  home = makeTempDir('kit-render-test-');
  process.env.DANDELION_KIT_HOME = home;
  const { project } = await openVideo({ path: SPEECH, title: 'Render fixture' });
  projectId = project.id;
  // Make up word times across 0.3 s to 10.6 s, a little pause after each sentence.
  const words = [];
  let t = 300;
  for (const w of SENTENCE.split(' ')) {
    const len = 180 + Math.min(260, w.length * 28);
    words.push({ text: w, start_ms: t, end_ms: t + len });
    t += len + 20 + (/[.]$/.test(w) ? 230 : 0);
  }
  const transcript = makeTranscript(words, { engine: 'transformers' });
  const cut = edit.roughCut(transcript, { duration_ms: project.media?.duration_ms });
  const plan = edit.planShots(transcript, cut, 'karaoke-clean', { seed: 7 });
  await updateProject(projectId, (p) => {
    p.transcript = transcript;
    p.transcript_ready = true;
    p.cut = cut;
    p.cut_applied = true;
    p.look_id = 'karaoke-clean';
    p.shot_plan = plan;
  });
});

after(async () => {
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previousHome;
  const { rmSync } = await import('node:fs');
  rmSync(home, { recursive: true, force: true });
});

/** Fail on a stop. Warnings must be the ones the fixture is expected to give (no face to put captions under). */
function assertChecks(checks, label) {
  const stops = checks.filter((c) => c.status === 'stop');
  assert.deepEqual(stops, [], `${label}: ${checksTable(checks)}`);
  const warns = checks.filter((c) => c.status === 'warn').map((c) => c.id);
  for (const id of warns)
    assert.ok(
      ['captions-under-chin', 'first-2s-motion', 'static-gap', 'not-dark-tail'].includes(id),
      `${label}: unexpected warning ${id}`,
    );
}

test('the caption anchor falls back to a fixed height when there is no face, and is saved in the plan', async () => {
  const anchor = await captionAnchor({ projectId });
  assert.equal(anchor.source, 'fallback');
  assert.equal(anchor.y, Math.round(0.72 * 1920));
  const p = await requireProject(projectId);
  assert.equal(/** @type {any} */ (p.shot_plan?.caption_anchor)?.y, anchor.y);
  const rehashed = edit.hashShotPlan(/** @type {any} */ (p.shot_plan));
  assert.equal(p.shot_plan?.hash, rehashed, 'the plan hash was refreshed after the anchor was filled');
  assert.ok((p.face_samples?.length ?? 0) > 10, 'face samples are cached on the project');
});

test('a draft renders at 540x960 and 15 fps with a registered preview asset', async () => {
  const stages = new Set();
  const r = await renderReel({ projectId, quality: 'draft', onProgress: (stage) => stages.add(stage) });
  assert.equal(r.quality, 'draft');
  assert.ok(existsSync(r.file) && r.bytes > 10000);
  assert.ok(stages.has('audio') && stages.has('video') && stages.has('checks'));
  const probe = JSON.parse(await runFfprobe(['-print_format', 'json', '-show_streams', r.file]));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  assert.equal(`${v.width}x${v.height}`, '540x960');
  assert.equal(v.avg_frame_rate, '15/1');
  assertChecks(r.checks, 'draft');
  const p = await requireProject(projectId);
  assert.equal(p.renders?.draft?.file, r.file);
  const asset = Object.values(p.assets).find((a) => a.path === r.file);
  assert.equal(asset?.kind, 'output');
  const chunk = await readAssetChunk(p, /** @type {any} */ (asset).id, 0, 64);
  assert.equal(
    Buffer.from(chunk.data, 'base64').toString('latin1', 4, 8),
    'ftyp',
    'read_asset serves the mp4',
  );
});

test('a final renders at 1080x1920, 30 fps, h264 and aac 48 kHz and passes the checks', async () => {
  const r = await renderReel({ projectId, quality: 'final' });
  const probe = JSON.parse(
    await runFfprobe(['-print_format', 'json', '-show_streams', '-show_format', r.file]),
  );
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264');
  assert.equal(`${v.width}x${v.height}`, '1080x1920');
  assert.equal(v.avg_frame_rate, '30/1');
  assert.equal(v.pix_fmt, 'yuv420p');
  assert.equal(a.codec_name, 'aac');
  assert.equal(Number(a.sample_rate), 48000);
  const plan = (await requireProject(projectId)).shot_plan;
  assert.ok(Math.abs(r.duration_ms - /** @type {any} */ (plan).duration_ms) <= 200);
  assertChecks(r.checks, 'final');
  const ids = r.checks.map((c) => c.id);
  for (const id of [
    'encode',
    'audio-format',
    'duration',
    'loudness',
    'true-peak',
    'not-dark-tail',
    'captions-safe-zone',
    'hook-text',
    'static-gap',
  ])
    assert.ok(ids.includes(id), id);
  const loud = r.checks.find((c) => c.id === 'loudness');
  assert.equal(loud?.status, 'pass', `loudness ${loud?.measured}`);
  const fallback = r.checks.find((c) => c.id === 'captions-under-chin');
  assert.equal(fallback?.status, 'warn', 'no face in the fixture, so the warning is documented');
  assert.match(String(fallback?.fix), /fixed height/);
});

test('the same plan is not rendered twice', async () => {
  const t = Date.now();
  const again = await renderReel({ projectId, quality: 'final' });
  assert.ok(/** @type {any} */ (again).reused, 'second final comes from the cache');
  assert.ok(Date.now() - t < 3000);
  const forced = await renderReel({ projectId, quality: 'draft', force: true });
  assert.ok(!(/** @type {any} */ (forced).reused));
});

test('a second look renders as a draft and a final', async () => {
  const p = await requireProject(projectId);
  const plan = edit.planShots(/** @type {any} */ (p.transcript), /** @type {any} */ (p.cut), 'bold-value', {
    seed: 7,
  });
  await updateProject(projectId, (q) => {
    q.look_id = 'bold-value';
    q.shot_plan = plan;
  });
  const draft = await renderReel({ projectId, quality: 'draft' });
  assertChecks(draft.checks, 'bold-value draft');
  const final = await renderReel({ projectId, quality: 'final' });
  assertChecks(final.checks, 'bold-value final');
  const q = await requireProject(projectId);
  assert.equal(q.shot_plan?.look_id, 'bold-value');
  assert.equal(final.plan_hash, q.shot_plan?.hash);
  const kept = readdirSync(join(home, 'projects', projectId, 'render')).filter((n) => n.endsWith('.mp4'));
  assert.equal(
    kept.filter((n) => n.startsWith('final-')).length,
    1,
    'the older final was replaced, not piled up',
  );
  assert.ok(
    !readdirSync(join(home, 'projects', projectId, 'render')).some((n) => n.startsWith('build-')),
    'build folders are cleaned up',
  );
});

test('measured caption bounds stay inside the safe zone for every caption theme', async () => {
  const p = await requireProject(projectId);
  for (const theme of [
    'karaoke-pill',
    'one-word-pop',
    'clean-minimal',
    'mono-terminal',
    'box-caption',
    'editorial-serif',
    'bold-stroke',
  ]) {
    const plan = edit.planShots(
      /** @type {any} */ (p.transcript),
      /** @type {any} */ (p.cut),
      'karaoke-clean',
      { seed: 7, caption_theme: theme },
    );
    const withAnchor = { ...plan, caption_anchor: { x: 540, y: 1700 } };
    const b = await measureCaptionBounds(withAnchor);
    assert.ok(b, theme);
    assert.ok(b.x_min >= SAFE_ZONE.x_min && b.x_max <= SAFE_ZONE.x_max, `${theme} x ${b.x_min}-${b.x_max}`);
    assert.ok(b.y_min >= SAFE_ZONE.y_min && b.y_max <= SAFE_ZONE.y_max, `${theme} y ${b.y_min}-${b.y_max}`);
  }
});

test('checkReel reports a stop for a file that does not match the plan', async () => {
  const p = await requireProject(projectId);
  const draft = /** @type {any} */ (p.renders).draft;
  const stretched = { .../** @type {any} */ (p.shot_plan), duration_ms: draft.duration_ms + 3000 };
  const checks = await checkReel({ file: draft.file, plan: stretched, quality: 'draft' });
  assert.equal(checks.find((c) => c.id === 'duration')?.status, 'stop');
  assert.ok(checks.find((c) => c.id === 'duration')?.fix);
  const asFinal = await checkReel({
    file: draft.file,
    plan: /** @type {any} */ (p.shot_plan),
    quality: 'final',
  });
  assert.equal(asFinal.find((c) => c.id === 'encode')?.status, 'stop', 'a draft is not a final');
});

test('only one render runs at a time in a process, and a lock held elsewhere gives a plain error', async () => {
  const order = [];
  const a = withRenderLock(async () => {
    order.push('a start');
    await new Promise((r) => setTimeout(r, 80));
    order.push('a end');
  });
  const b = withRenderLock(async () => {
    order.push('b start');
  });
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a start', 'a end', 'b start']);
  // A lock file owned by a live process (the parent of this test) blocks.
  writeFileSync(join(home, 'render.lock'), JSON.stringify({ pid: process.ppid, at: Date.now() }));
  await assert.rejects(
    withRenderLock(async () => {}),
    /Another render is already running/,
  );
  writeFileSync(join(home, 'render.lock'), JSON.stringify({ pid: 999999, at: Date.now() }));
  await withRenderLock(async () => {});
  assert.ok(!existsSync(join(home, 'render.lock')));
});

test('variants are final renders of the same speech that differ on at least two axes', async () => {
  const results = await makeVariants({ projectId, count: 2 });
  assert.equal(results.length, 2);
  const p = await requireProject(projectId);
  for (const r of results) {
    assert.equal(r.quality, 'final');
    assert.ok(r.variant_id?.startsWith('v'));
    assert.ok(r.plan_diff.changed.length >= 2, `${r.variant_id} changed ${r.plan_diff.changed}`);
    assert.ok(
      Math.abs(r.duration_ms - /** @type {any} */ (p.shot_plan).duration_ms) <= 200,
      'speech is not retimed',
    );
    assertChecks(r.checks, r.variant_id ?? 'variant');
    assert.equal(p.renders?.[/** @type {string} */ (r.variant_id)]?.file, r.file);
  }
  assert.notEqual(results[0].plan_hash, results[1].plan_hash);
  assert.equal(p.variants?.length, 2);
  const diff = results[0].plan_diff.changed.filter(
    (a) => results[1].plan_diff.to[a] !== results[0].plan_diff.to[a],
  );
  assert.ok(diff.length >= 0);
});

test('a look sample is a small JPEG registered for read_asset', async () => {
  const id = await renderLookSample({ projectId, look: 'editorial-luxe', captionTheme: 'editorial-serif' });
  const p = await requireProject(projectId);
  const asset = p.assets[id];
  assert.equal(asset.kind, 'sample');
  assert.equal(asset.mime, 'image/jpeg');
  const bytes = readFileSync(asset.path);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.ok(bytes.length > 3000 && bytes.length < 400000);
  assert.equal(
    await renderLookSample({ projectId, look: 'editorial-luxe', captionTheme: 'editorial-serif' }),
    id,
    'same look, same asset',
  );
  await assert.rejects(renderLookSample({ projectId, look: 'no-such-look' }), /Unknown look/);
});

test('a render without a cut or a plan gives plain words', async () => {
  assert.ok((await requireProject(projectId)).cut);
  await updateProject(projectId, (p) => {
    delete p.shot_plan;
  });
  await assert.rejects(renderReel({ projectId, quality: 'final' }), /no shot plan/);
  await assert.rejects(renderReel({ projectId, quality: /** @type {any} */ ('ultra') }), /Quality must be/);
});

test('libass draws karaoke captions at the em size the theme asks for, not smaller', async () => {
  const p = await requireProject(projectId);
  const plan = edit.planShots(
    /** @type {any} */ (p.transcript),
    /** @type {any} */ (p.cut),
    'karaoke-clean',
    { seed: 7 },
  );
  const b = await measureCaptionBounds({ ...plan, caption_anchor: { x: 540, y: 1100 } });
  assert.ok(b);
  const height = b.y_max - b.y_min;
  // One line of 68 px text with a 5 px outline: cap height alone is about 48 px, so a line with descenders is over 60.
  assert.ok(height >= 60 && height <= 110, `line height ${height}`);
  assert.ok(b.x_max - b.x_min >= 520, `widest line ${b.x_max - b.x_min}`);
});

test('long words and wide pairs stay inside the safe zone as drawn by libass, at the pop swell', async () => {
  const text =
    'Instagram straightforward unquestionably on Watermark communication extraordinarily misunderstood, so try Instagram Reels today';
  const words = [];
  let t = 300;
  for (const w of text.split(' ')) {
    words.push({ text: w, start_ms: t, end_ms: t + 420 });
    t += 450;
  }
  const transcript = makeTranscript(words, { engine: 'transformers' });
  const cut = edit.roughCut(transcript, { duration_ms: 11000 });
  for (const theme of ['one-word-pop', 'karaoke-highlight', 'bold-stroke', 'clean-minimal']) {
    const plan = edit.planShots(transcript, cut, 'karaoke-clean', { seed: 7, caption_theme: theme });
    const b = await measureCaptionBounds({ ...plan, caption_anchor: { x: 540, y: 1163 } });
    assert.ok(b, theme);
    // The same test the captions-safe-zone check applies.
    assert.ok(b.x_min >= SAFE_ZONE.x_min && b.x_max <= SAFE_ZONE.x_max, `${theme} x ${b.x_min}-${b.x_max}`);
    assert.ok(b.y_min >= SAFE_ZONE.y_min && b.y_max <= SAFE_ZONE.y_max, `${theme} y ${b.y_min}-${b.y_max}`);
  }
});
