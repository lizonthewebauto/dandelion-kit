import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { planShots, editShotPlan, hashShotPlan, HOOK_CARD_MS } from '../core/edit/shotplan.mjs';
import { roughCut } from '../core/edit/roughcut.mjs';
import { listLooks } from '../core/edit/looks.mjs';
import { validateCamera, ceilingFor } from '../core/edit/camera.mjs';
import { visualEvents, checkDensity } from '../core/edit/pacing.mjs';
import { LOOK_IDS, TREATMENTS, CAPTION_THEMES, SFX_NAMES } from '../core/types.mjs';
import { loadFixture, goldenPath, must } from './helpers-edit.mjs';

const fx = loadFixture();
const T = fx.transcript;
const cut = roughCut(T, { duration_ms: fx.duration_ms });
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function golden(name, value) {
  const file = goldenPath(name);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('golden: the rough cut of the fixture transcript is stable', () => {
  const expected = golden('golden-cut-plan.json', cut);
  assert.deepEqual(JSON.parse(JSON.stringify(cut)), expected);
});

test('golden: the shot plan for the fixture, karaoke clean, seed 1, is stable', () => {
  const plan = planShots(T, cut, 'karaoke-clean', { seed: 1 });
  const expected = golden('golden-shot-plan.json', plan);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), expected);
});

test('same seed, same plan, same hash; another seed changes the hash', () => {
  const a = planShots(T, cut, 'karaoke-clean', { seed: 5 });
  const b = planShots(T, cut, 'karaoke-clean', { seed: 5 });
  const c = planShots(T, cut, 'karaoke-clean', { seed: 6 });
  assert.deepEqual(a, b);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.equal(a.hash, hashShotPlan(a));
});

test('a string seed works and is stable', () => {
  const a = planShots(T, cut, 'karaoke-clean', { seed: 'morning-routine' });
  const b = planShots(T, cut, 'karaoke-clean', { seed: 'morning-routine' });
  assert.deepEqual(a, b);
  assert.equal(typeof a.seed, 'number');
});

test('the plan has every part the render needs', () => {
  const plan = planShots(T, cut, 'karaoke-clean');
  assert.equal(plan.look_id, 'karaoke-clean');
  assert.equal(plan.caption_theme, 'karaoke-highlight');
  assert.equal(plan.duration_ms, cut.after_ms);
  assert.ok(plan.beats.length >= 5);
  assert.ok(plan.captions.length > plan.beats.length);
  assert.ok(plan.camera.length >= plan.beats.length);
  assert.equal(plan.caption_anchor, null);
  assert.match(plan.hash, /^[0-9a-f]{16}$/);
});

test('the first beat is the hook card and carries the hook text, the last prompt becomes the closing treatment', () => {
  const plan = planShots(T, cut, 'karaoke-clean');
  assert.equal(plan.beats[0].treatment, 'hook-card');
  assert.equal(plan.beats[0].screen_text, plan.hook.text);
  assert.ok(plan.hook.score >= 70);
  assert.ok(plan.hook.text.split(' ').length <= 9);
  assert.equal(plan.beats[plan.beats.length - 1].kind, 'cta');
  assert.equal(plan.beats[plan.beats.length - 1].treatment, 'cta-end');
  assert.ok(HOOK_CARD_MS === 2000);
});

test('every treatment is one the render path can draw, and richer ones are recorded as wanted', () => {
  const plan = planShots(T, cut, 'karaoke-clean');
  for (const b of plan.beats) {
    assert.ok(TREATMENTS.includes(b.treatment), b.treatment);
    if (b.wanted_treatment) assert.ok(TREATMENTS.includes(/** @type {any} */ (b.rendered_as)), `${b.id}: ${b.rendered_as}`);
  }
  assert.ok(plan.beats.some((b) => b.wanted_treatment));
});

test('beats, captions, camera and sound all sit inside the reel and in order', () => {
  const plan = planShots(T, cut, 'bold-value');
  for (const b of plan.beats) assert.ok(b.out_start_ms >= 0 && b.out_end_ms <= plan.duration_ms);
  for (const c of plan.captions) assert.ok(c.start_ms >= 0 && c.end_ms <= plan.duration_ms + 300);
  for (let i = 1; i < plan.sfx.length; i += 1) assert.ok(plan.sfx[i].out_ms > plan.sfx[i - 1].out_ms);
  for (const s of plan.sfx) assert.ok(SFX_NAMES.includes(s.name) && s.out_ms <= plan.duration_ms);
  assert.deepEqual(validateCamera(plan.camera, { ceiling: ceilingFor('bold'), duration_ms: plan.duration_ms, check_repeats: false }), []);
});

test('all five looks make a valid plan with their own caption theme and no more than one emphasized word per caption group', () => {
  const themes = new Set();
  for (const look of listLooks()) {
    const plan = planShots(T, cut, look.id, { seed: 2 });
    assert.equal(plan.caption_theme, look.caption_theme);
    assert.ok(CAPTION_THEMES.includes(plan.caption_theme));
    themes.add(plan.caption_theme);
    const emphasized = new Set(plan.beats.flatMap((b) => b.emphasis_words));
    const seenGroups = new Set();
    for (const cue of plan.captions) {
      const key = cue.word_indexes.join(',');
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      assert.ok(cue.word_indexes.filter((i) => emphasized.has(i)).length <= 1, `${look.id}: "${cue.text}"`);
    }
  }
  assert.equal(themes.size, 5);
});

test('a look with calmer cadence makes longer beats than a bold one', () => {
  const calm = planShots(T, cut, 'editorial-luxe', { seed: 1 });
  const bold = planShots(T, cut, 'bold-value', { seed: 1 });
  assert.ok(calm.beats.length <= bold.beats.length);
});

test('a longer reel keeps density inside 4 to 8 per 10 seconds', () => {
  // Three copies of the fixture back to back: about 76 seconds of speech after the cut.
  const words = [];
  const off = fx.duration_ms;
  for (let k = 0; k < 3; k += 1) for (const w of T.words) words.push({ ...w, start_ms: w.start_ms + k * off, end_ms: w.end_ms + k * off });
  const long = { ...T, words, segments: [] };
  const longCut = roughCut(long, { duration_ms: off * 3 });
  for (const id of LOOK_IDS) {
    const plan = planShots(long, longCut, id, { seed: 3 });
    const events = visualEvents(plan.camera, plan.hook.text ? [0, HOOK_CARD_MS] : []);
    const check = checkDensity(events, plan.duration_ms);
    assert.ok(check.ok, `${id}: min ${check.min_seen} max ${check.max_seen}`);
    assert.ok(check.min_gap_ok, `${id} min gap`);
  }
});

test('hook_text is used as written when it is good', () => {
  const plan = planShots(T, cut, 'karaoke-clean', { hook_text: 'Captions cost you three hours' });
  assert.equal(plan.hook.text, 'Captions cost you three hours');
  assert.equal(plan.beats[0].screen_text, 'Captions cost you three hours');
  assert.ok(plan.hook.candidates.length >= 1);
});

test('a hook with a dash or too many words is refused with a plain reason', () => {
  assert.throws(() => planShots(T, cut, 'karaoke-clean', { hook_text: `Captions ${EM} the slow part` }), /** @param {any} e */ (e) => e.code === 'hook_rejected' && /dash/.test(e.message));
  assert.throws(() => planShots(T, cut, 'karaoke-clean', { hook_text: 'one two three four five six seven eight nine ten' }), /** @param {any} e */ (e) => e.code === 'hook_rejected');
});

test('caption theme and accent can be changed without changing the speech plan', () => {
  const base = planShots(T, cut, 'karaoke-clean', { seed: 1 });
  const pill = planShots(T, cut, 'karaoke-clean', { seed: 1, caption_theme: 'box-caption', accent: '#00ffaa' });
  assert.equal(pill.caption_theme, 'box-caption');
  assert.equal(pill.accent, '#00FFAA');
  assert.deepEqual(pill.beats.map((b) => b.text), base.beats.map((b) => b.text));
  assert.notEqual(pill.hash, base.hash);
});

test('an empty cut is a clear error', () => {
  const empty = { ...cut, pieces: [], after_ms: 0 };
  assert.throws(() => planShots(T, empty, 'karaoke-clean'), /no speech/);
});

test('editing a beat changes its treatment, rebuilds the camera and changes the hash', () => {
  const plan = planShots(T, cut, 'karaoke-clean', { seed: 1 });
  const target = must(plan.beats.find((b) => b.treatment === 'face' || b.treatment === 'punch-in'));
  const edited = editShotPlan(T, cut, plan, { beats: [{ id: target.id, treatment: 'hold-wide', screen_text: 'Three hours gone' }] });
  assert.equal(must(edited.beats.find((b) => b.id === target.id)).treatment, 'hold-wide');
  assert.equal(must(edited.beats.find((b) => b.id === target.id)).screen_text, 'Three hours gone');
  assert.notEqual(edited.hash, plan.hash);
  assert.equal(edited.hash, hashShotPlan(edited));
  assert.deepEqual(edited.captions, plan.captions, 'speech and captions are untouched');
  const move = must(edited.camera.find((m) => (target.out_start_ms + target.out_end_ms) / 2 >= m.out_start_ms && (target.out_start_ms + target.out_end_ms) / 2 < m.out_end_ms));
  assert.ok(move.kind === 'wide' || move.kind === 'punch-in', 'pacing may add a change inside a long hold');
});

test('edits that make no sense are refused in plain words', () => {
  const plan = planShots(T, cut, 'karaoke-clean');
  assert.throws(() => editShotPlan(T, cut, plan, { beats: [{ id: 'b99', treatment: 'face' }] }), /no beat "b99"/);
  assert.throws(() => editShotPlan(T, cut, plan, { beats: [{ id: plan.beats[1].id, treatment: 'sparkle' }] }), /Unknown treatment/);
  assert.throws(() => editShotPlan(T, cut, plan, { beats: [{ id: plan.beats[1].id, treatment: 'hook-card' }] }), /first beat/);
  assert.throws(() => editShotPlan(T, cut, plan, { hook_text: 'Stop -- now' }), /** @param {any} e */ (e) => e.code === 'hook_rejected');
});

test('editing the hook updates the hook card', () => {
  const plan = planShots(T, cut, 'karaoke-clean');
  const edited = editShotPlan(T, cut, plan, { hook_text: 'Nobody tells you this about captions' });
  assert.equal(edited.hook.text, 'Nobody tells you this about captions');
  assert.equal(edited.beats[0].screen_text, 'Nobody tells you this about captions');
});

test('no plan text contains a dash that reads like an em or en dash', () => {
  for (const id of LOOK_IDS) {
    const text = JSON.stringify(planShots(T, cut, id));
    assert.ok(!text.includes(EM) && !text.includes(EN) && !text.includes('\\u2014') && !text.includes('\\u2013'), id);
  }
});
