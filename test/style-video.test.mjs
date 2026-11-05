import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOOK_IDS } from '../core/types.mjs';
import { getLook, LOOKS } from '../core/edit/looks.mjs';
import { roughCut } from '../core/edit/roughcut.mjs';
import { planShots, hashShotPlan, editShotPlan } from '../core/edit/shotplan.mjs';
import { buildVariantPlan, planVariantAxes } from '../core/render/variants.mjs';
import { buildVideoGraph } from '../core/render/filtergraph.mjs';
import { planKey } from '../server/lib/render-jobs.mjs';
import { renderIsFresh } from '../server/lib/data.mjs';
import { createProject, requireProject, updateProject } from '../server/store/project.mjs';
import { saveStyle } from '../core/style/store.mjs';
import { loadFixture, must } from './helpers-edit.mjs';
import { connectKit, textOf } from './server-helpers.mjs';

let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-video-style-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

const fixture = loadFixture();
const transcript = fixture.transcript;
const cut = roughCut(transcript, { duration_ms: fixture.duration_ms });
const overrides = {
  cut_every_ms_min: 2000, cut_every_ms_max: 3800,
  camera_aggression: 'calm', sfx_per_minute: 1,
  density_per_10s: { min: 3, target: 4, max: 6 },
  grade: { saturation: 0.9, contrast: 1.16, warmth: -0.1 },
};

test('all five unmodified looks keep their fields and nested objects stay independent', () => {
  for (const id of LOOK_IDS) {
    const look = getLook(id);
    assert.deepEqual(look, LOOKS[id]);
    assert.notEqual(look.grade, LOOKS[id].grade);
    assert.notEqual(look.density_per_10s, LOOKS[id].density_per_10s);
  }
});

test('look overrides merge each field and validate the effective look', () => {
  const look = getLook('karaoke-clean', { ...overrides, caption_theme: 'mono-terminal', accent: '#aabbcc' });
  for (const key of Object.keys(overrides)) assert.deepEqual(look[key], overrides[key], key);
  assert.equal(look.caption_theme, 'mono-terminal');
  assert.equal(look.accent, '#AABBCC');
  const partial = getLook('karaoke-clean', { grade: { warmth: 0.06 }, density_per_10s: { target: 5 } });
  assert.deepEqual(partial.grade, { ...LOOKS['karaoke-clean'].grade, warmth: 0.06 });
  assert.deepEqual(partial.density_per_10s, { min: 4, target: 5, max: 8 });
  const invalid = [
    { cut_every_ms_min: 599 }, { cut_every_ms_min: 8001 },
    { cut_every_ms_max: 899 }, { cut_every_ms_max: 12001 },
    { cut_every_ms_min: 3000, cut_every_ms_max: 3299 },
    { cut_every_ms_min: 8000 }, { cut_every_ms_max: 900 },
    { sfx_per_minute: -1 }, { sfx_per_minute: 9 },
    { density_per_10s: { min: 1 } }, { density_per_10s: { max: 11 } },
    { density_per_10s: { target: 3 } },
    { grade: { saturation: 0.84 } }, { grade: { saturation: 1.21 } },
    { grade: { contrast: 0.89 } }, { grade: { contrast: 1.21 } },
    { grade: { warmth: -0.16 } }, { grade: { warmth: 0.16 } },
    { camera_aggression: 'wild' },
  ];
  for (const value of invalid) assert.throws(() => getLook('karaoke-clean', /** @type {any} */ (value)), { message: /./ }, JSON.stringify(value));
});

test('motion and grade choices change plans and hashes and survive plan edits', () => {
  const plain = planShots(transcript, cut, getLook('karaoke-clean'), { seed: 4 });
  const styled = planShots(transcript, cut, getLook('karaoke-clean', overrides), { seed: 4 });
  assert.notDeepEqual(styled.camera, plain.camera);
  assert.notEqual(styled.hash, plain.hash);
  assert.deepEqual(styled.look_overrides, overrides);
  assert.equal(styled.hash, hashShotPlan(styled));
  const grade = planShots(transcript, cut, getLook('karaoke-clean', { grade: { warmth: 0.06 } }), { seed: 4 });
  assert.notEqual(grade.hash, plain.hash, 'a color change alone changes the hash');
  assert.notEqual(planKey(grade), planKey(plain));
  const changed = editShotPlan(transcript, cut, styled, { hook_text: 'Make your next video clear' });
  assert.deepEqual(changed.look_overrides, styled.look_overrides);
  assert.equal(changed.hash, hashShotPlan(changed));
});

test('variant plans keep saved color sound camera and cadence choices', () => {
  const base = planShots(transcript, cut, getLook('karaoke-clean', overrides), { seed: 4 });
  for (const axes of planVariantAxes(base, 4)) {
    const variant = buildVariantPlan(transcript, cut, base, axes);
    assert.deepEqual(variant.look_overrides?.grade, overrides.grade);
    assert.equal(variant.look_overrides?.camera_aggression, overrides.camera_aggression);
    assert.equal(variant.look_overrides?.sfx_per_minute, overrides.sfx_per_minute);
    assert.ok(variant.look_overrides?.cut_every_ms_min);
    assert.ok(variant.look_overrides?.cut_every_ms_max);
    assert.equal(variant.hash, hashShotPlan(variant));
  }
});

test('filter graph uses the supplied grade rather than the base look', () => {
  const graph = buildVideoGraph({
    segments: [{ src_frame: 0, frames: 60, out_frame: 0 }], camera: [],
    look_id: 'karaoke-clean', quality: 'draft', grade: overrides.grade,
  });
  assert.match(graph, /eq=saturation=0\.9:contrast=1\.16/);
  assert.match(graph, /colorbalance=rm=-0\.05:bm=0\.05/);
  assert.doesNotMatch(graph, /saturation=1\.05/);
});

async function fixtureProject() {
  const project = await createProject({ type: 'video', title: 'Style fixture' });
  await updateProject(project.id, (p) => {
    p.transcript = transcript;
    p.transcript_ready = true;
    p.cut = cut;
    p.cut_applied = true;
  });
  return project.id;
}

test('saved video style is named in the menu and applies only its chosen fields', async () => {
  const id = await fixtureProject();
  const kit = await connectKit();
  try {
    await saveStyle('Quiet clips', { video: { base_look: 'minimal-educator', caption_theme: 'mono-terminal', accent: '#115588', overrides } });
    const menu = await kit.call('pick_look', { project_id: id });
    assert.ok(!menu.isError, textOf(menu));
    assert.match(textOf(menu), /Your saved style Quiet clips is the default\. Call pick_look with style to use it\./);
    const picked = await kit.call('pick_look', { project_id: id, style: 'Quiet clips' });
    assert.ok(!picked.isError, textOf(picked));
    assert.match(textOf(picked), /Style used: Quiet clips/);
    const p = await requireProject(id);
    assert.equal(p.look_id, 'minimal-educator');
    assert.equal(p.caption_theme, 'mono-terminal');
    assert.equal(p.accent, '#115588');
    assert.equal(p.style_name, 'Quiet clips');
    assert.deepEqual(p.look_overrides, overrides);
    await saveStyle('Only captions', { video: { caption_theme: 'box-caption' } }, { make_default: false });
    const partial = await kit.call('pick_look', { project_id: id, style: 'Only captions' });
    assert.ok(!partial.isError, textOf(partial));
    assert.equal((await requireProject(id)).caption_theme, 'box-caption');
  } finally { await kit.close(); }
});

test('reapplying a changed style clears the old plan and makes its render stale', async () => {
  const id = await fixtureProject();
  const kit = await connectKit();
  try {
    await saveStyle('My video', { video: { overrides: { grade: { warmth: 0.06 } } } });
    await kit.call('pick_look', { project_id: id, style: 'My video' });
    const planned = await kit.call('plan_shots', { project_id: id, hook_text: 'Make your next video clear' });
    assert.ok(!planned.isError, textOf(planned));
    const before = await requireProject(id);
    const plan = must(before.shot_plan);
    assert.equal(plan.look_overrides?.grade?.warmth, 0.06);
    const file = join(home, 'fake-render.mp4');
    await writeFile(file, 'test');
    await updateProject(id, (p) => { p.renders = { draft: /** @type {any} */ ({ file, plan_hash: plan.hash }) }; });
    assert.equal(renderIsFresh(await requireProject(id), 'draft'), true);
    await saveStyle('My video', { video: { overrides: { grade: { warmth: -0.06 } } } });
    const applied = await kit.call('pick_look', { project_id: id, style: 'My video' });
    assert.ok(!applied.isError, textOf(applied));
    const after = await requireProject(id);
    assert.equal(after.shot_plan, undefined);
    assert.equal(renderIsFresh(after, 'draft'), false);
    const replanned = await kit.call('plan_shots', { project_id: id, hook_text: 'Make your next video clear' });
    assert.ok(!replanned.isError, textOf(replanned));
    assert.notEqual((await requireProject(id)).shot_plan?.hash, plan.hash);
    assert.equal(renderIsFresh(await requireProject(id), 'draft'), false);
  } finally { await kit.close(); }
});

test('rough cut uses the default pacing style unless a preset is given', async () => {
  const id = await fixtureProject();
  const kit = await connectKit();
  try {
    await saveStyle('Fast cuts', { video: { rough_cut: 'punchy' } });
    const automatic = await kit.call('rough_cut', { project_id: id });
    assert.ok(!automatic.isError, textOf(automatic));
    assert.equal(automatic.structuredContent.preset, 'punchy');
    assert.match(textOf(automatic), /Fast cuts/);
    const explicit = await kit.call('rough_cut', { project_id: id, preset: 'gentle' });
    assert.equal(explicit.structuredContent.preset, 'gentle');
  } finally { await kit.close(); }
});
