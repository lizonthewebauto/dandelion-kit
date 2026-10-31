// The whole reel chain through the MCP tools, on the 11 second speech fixture:
// open_video, rough_cut, update_cut, pick_look, plan_shots, update_shot_plan, render_reel (draft, final),
// check_reel, make_variants, export, offer_post, read_asset. Needs ffmpeg and the speech model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../core/util/fs.mjs';
import { detectFfmpeg } from '../core/media/ffmpeg.mjs';
import { connectKit, textOf, useSharedModels, DASH_RE } from './server-helpers.mjs';

useSharedModels();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');
const ff = await detectFfmpeg();
const skip = ff.found && ff.has_ass ? false : 'ffmpeg with captions is not installed';

let home;
let previousHome;
/** @type {Awaited<ReturnType<typeof connectKit>>} */
let kit;
let pid = '';

before(async () => {
  previousHome = process.env.DANDELION_KIT_HOME;
  home = makeTempDir('kit-chain-test-');
  process.env.DANDELION_KIT_HOME = home;
  kit = await connectKit();
});
after(async () => {
  await kit.close();
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

test('open_video returns fast with the project, and the words are read in the background', { skip }, async () => {
  const r = await kit.call('open_video', { path: SPEECH, title: 'Chain test' });
  assert.equal(r.isError, undefined, textOf(r));
  const p = r.structuredContent.project;
  pid = p.id;
  assert.match(pid, /^p_[a-z0-9]+$/);
  assert.equal(p.title, 'Chain test');
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
  assert.equal(r.structuredContent.next, 'rough_cut');
  assert.ok(p.poster_asset_id, 'a poster frame for the card');
  assert.match(textOf(r), /Project "Chain test"/);
  const poster = await kit.call('read_asset', { asset_id: p.poster_asset_id, offset: 0 });
  assert.equal(poster.structuredContent.mime, 'image/jpeg');
  // Opening the same file again finds the same project.
  const again = await kit.call('open_video', { path: SPEECH });
  assert.equal(again.structuredContent.project.id, pid);
  assert.equal(again.structuredContent.reused, true);
});

test('rough_cut waits for the words, then update_cut keeps a piece', { skip }, async () => {
  const r = await kit.call('rough_cut', { project_id: pid, preset: 'standard' });
  assert.equal(r.isError, undefined, textOf(r));
  const cut = r.structuredContent;
  assert.equal(cut.project_id, pid);
  assert.ok(cut.removed.length >= 1);
  assert.ok(cut.after_ms < cut.before_ms);
  assert.ok(!('pieces' in cut), 'pieces stay in the project, not in the card data');
  const id = cut.removed[0].id;
  const kept = await kit.call('update_cut', { project_id: pid, keep_ids: [id] });
  assert.equal(kept.isError, undefined, textOf(kept));
  assert.equal(kept.structuredContent.removed.find((s) => s.id === id).keep, true);
  assert.ok(kept.structuredContent.after_ms > cut.after_ms);
  const unknown = await kit.call('update_cut', { project_id: pid, keep_ids: ['r999'] });
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /no piece called r999/);
  const back = await kit.call('update_cut', { project_id: pid, drop_ids: [id] });
  assert.equal(back.structuredContent.after_ms, cut.after_ms);
});

test('get_project follows the steps as they happen', { skip }, async () => {
  const r = await kit.call('get_project', { project_id: pid });
  const p = r.structuredContent.project;
  assert.equal(p.transcript_ready, true);
  assert.ok(p.word_count >= 3);
  assert.equal(p.cut_applied, true);
  assert.equal(p.has_shot_plan, false);
  assert.equal(r.structuredContent.next, 'pick_look');
});

test('pick_look shows five looks with caption samples, and choosing one is saved', { skip }, async () => {
  const show = await kit.call('pick_look', { project_id: pid });
  assert.equal(show.isError, undefined, textOf(show));
  const d = show.structuredContent;
  assert.equal(d.looks.length, 5);
  assert.equal(d.current.look_id, 'karaoke-clean');
  for (const l of d.looks) {
    assert.ok(l.sample_asset_id, `${l.id} has a caption sample picture`);
    const img = await kit.call('read_asset', { asset_id: l.sample_asset_id, offset: 0, bytes: 10 });
    assert.equal(img.structuredContent.mime, 'image/jpeg');
  }
  const pick = await kit.call('pick_look', { project_id: pid, look: 'bold-value', accent: '#FF8A3D' });
  assert.deepEqual(pick.structuredContent.current, { look_id: 'bold-value', caption_theme: 'bold-stroke', accent: '#FF8A3D' });
  const bad = await kit.call('pick_look', { project_id: pid, look: 'nope' });
  assert.equal(bad.isError, true);
});

test('plan_shots builds the plan and update_shot_plan edits it', { skip }, async () => {
  const r = await kit.call('plan_shots', { project_id: pid });
  assert.equal(r.isError, undefined, textOf(r));
  const plan = r.structuredContent;
  assert.equal(plan.look_id, 'bold-value');
  assert.ok(plan.beats.length >= 2);
  assert.ok(plan.hook.text.length > 0);
  assert.ok(JSON.stringify(plan).length < 50000);
  assert.match(textOf(r), /Next: render_reel with quality draft/);

  const beat = plan.beats[1];
  const edited = await kit.call('update_shot_plan', { project_id: pid, beats: [{ id: beat.id, text: 'Pick a look', treatment: 'text-emphasis' }] });
  assert.equal(edited.isError, undefined, textOf(edited));
  const b2 = edited.structuredContent.beats.find((b) => b.id === beat.id);
  assert.equal(b2.screen_text, 'Pick a look');
  assert.equal(b2.treatment, 'text-emphasis');
  assert.notEqual(edited.structuredContent.plan_hash, plan.plan_hash);

  const twelve = 'one two three four five six seven eight nine ten eleven twelve';
  const rejected = await kit.call('plan_shots', { project_id: pid, hook_text: twelve });
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error, 'hook_rejected');
  assert.ok(rejected.structuredContent.reasons.length >= 1);
  assert.match(textOf(rejected), /cannot be used/);
  const dash = await kit.call('update_shot_plan', { project_id: pid, hook_text: `Stop ${String.fromCharCode(0x2014)} listen` });
  assert.equal(dash.isError, true);
  const badTreatment = await kit.call('update_shot_plan', { project_id: pid, beats: [{ id: beat.id, treatment: 'sparkle' }] });
  assert.equal(badTreatment.isError, true);
});

test('render_reel draft: preview card data, a playable preview file and frames through read_asset', { skip }, async () => {
  const r = await kit.call('render_reel', { project_id: pid, quality: 'draft' });
  assert.equal(r.isError, undefined, textOf(r));
  const d = r.structuredContent;
  assert.equal(d.active, 'draft');
  const draft = d.renders.find((x) => x.id === 'draft');
  assert.ok(existsSync(draft.file));
  assert.ok(textOf(r).includes(draft.file), 'text has the exact path');
  assert.ok(draft.checks.length >= 8);
  assert.equal(draft.frame_asset_ids.length, 8);
  assert.ok(draft.video_asset_id);
  assert.equal(draft.stale, false);
  const chunk = await kit.call('read_asset', { asset_id: draft.video_asset_id, offset: 0, bytes: 64 });
  assert.equal(chunk.structuredContent.mime, 'video/mp4');
  assert.match(Buffer.from(chunk.structuredContent.data, 'base64').subarray(4, 8).toString(), /ftyp/);
  assert.ok(JSON.stringify(d).length < 50000);
  const p = await kit.call('get_project', { project_id: pid });
  assert.equal(p.structuredContent.project.has_draft, true);
});

test('render_reel final, check_reel, make_variants, export and offer_post finish the chain', { skip, timeout: 420000 }, async () => {
  const f = await kit.call('render_reel', { project_id: pid, quality: 'final' });
  assert.equal(f.isError, undefined, textOf(f));
  assert.deepEqual(f.structuredContent.renders.map((x) => x.id), ['draft', 'final']);
  const final = f.structuredContent.renders[1];
  assert.equal(final.quality, 'final');
  assert.ok(!final.checks.some((c) => c.status === 'stop'), JSON.stringify(final.checks.filter((c) => c.status === 'stop')));
  assert.match(textOf(f), /Checks \(\d+ pass/);

  const c = await kit.call('check_reel', { project_id: pid });
  assert.equal(c.isError, undefined, textOf(c));
  assert.equal(c.structuredContent.active, 'final');
  const wrongFile = await kit.call('check_reel', { project_id: pid, file: join(home, 'x.mp4') });
  assert.equal(wrongFile.isError, true);

  const v = await kit.call('make_variants', { project_id: pid, count: 2 });
  assert.equal(v.isError, undefined, textOf(v));
  const variants = v.structuredContent.renders.filter((x) => x.variant_id);
  assert.equal(variants.length, 2);
  assert.ok(variants.every((x) => x.axes && x.axes.hook_text), 'variants carry their axes');
  assert.ok(variants.every((x) => x.stale === false));
  assert.match(textOf(v), /This variant: hook/);

  const e = await kit.call('export', { project_id: pid, to_dir: join(home, 'exported') });
  assert.equal(e.isError, undefined, textOf(e));
  const kinds = e.structuredContent.files.map((x) => x.kind);
  assert.equal(kinds.filter((k) => k === 'video').length, 3);
  assert.ok(kinds.includes('caption'));
  const srt = e.structuredContent.files.find((x) => x.kind === 'caption');
  assert.match(readFileSync(srt.path, 'utf8'), /^1\r?\n\d\d:\d\d:\d\d,\d\d\d --> /);
  assert.ok(!DASH_RE.test(readFileSync(e.structuredContent.summary_path, 'utf8')));

  const o = await kit.call('offer_post', { kind: 'video', project_id: pid, text: 'Turn one clip into a reel in minutes.' });
  assert.equal(o.isError, undefined, textOf(o));
  const bundle = o.structuredContent.bundle;
  assert.equal(bundle.files.length, 1);
  assert.equal(bundle.files[0], final.file);
  assert.equal(bundle.channels.instagram.format, 'Reel');
  assert.ok(bundle.preview_asset_ids.length >= 1);
  assert.deepEqual(Object.keys(bundle.channels).length, 8);
});

test('a new rough cut makes the old plan and renders stale', { skip }, async () => {
  const r = await kit.call('rough_cut', { project_id: pid, preset: 'punchy' });
  assert.equal(r.isError, undefined, textOf(r));
  const p = await kit.call('get_project', { project_id: pid });
  assert.equal(p.structuredContent.project.has_shot_plan, false);
  assert.equal(p.structuredContent.project.has_final, false);
  assert.equal(p.structuredContent.next, 'plan_shots', 'the look is kept, the plan is not');
  const noPlan = await kit.call('render_reel', { project_id: pid, quality: 'draft' });
  assert.equal(noPlan.isError, true);
  assert.match(textOf(noPlan), /plan_shots first/);
});
