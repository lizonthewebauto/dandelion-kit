import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUGH_CUT_PRESETS,
  roughCut,
  detectRemovals,
  layoutCut,
  applyChoices,
  wordsOnTimeline,
  srcToOut,
  cutStats,
} from '../core/edit/roughcut.mjs';
import { loadFixture, must } from './helpers-edit.mjs';

const fx = loadFixture();
const T = fx.transcript;
const opts = { duration_ms: fx.duration_ms };

test('presets use the plan numbers for silence and pads', () => {
  assert.equal(ROUGH_CUT_PRESETS.gentle.silence_threshold_ms, 900);
  assert.equal(ROUGH_CUT_PRESETS.standard.silence_threshold_ms, 650);
  assert.equal(ROUGH_CUT_PRESETS.punchy.silence_threshold_ms, 350);
  assert.equal(ROUGH_CUT_PRESETS.gentle.pad_out_ms, 200);
  assert.equal(ROUGH_CUT_PRESETS.standard.pad_out_ms, 160);
  assert.equal(ROUGH_CUT_PRESETS.standard.pad_in_ms, 90);
  assert.equal(ROUGH_CUT_PRESETS.punchy.pad_out_ms, 90);
});

test('an unknown preset is a plain error', () => {
  assert.throws(() => roughCut(T, { preset: /** @type {any} */ ('wild') }), /gentle, standard or punchy/);
});

test('the fixture has the shape the tests rely on', () => {
  assert.ok(T.words.length >= 60 && T.words.length <= 75);
  for (let i = 1; i < T.words.length; i += 1) assert.ok(T.words[i].start_ms >= T.words[i - 1].end_ms);
});

test('finds the filler, the stutter, the restart and the phrase filler', () => {
  const removed = detectRemovals(T, opts);
  const byKind = (k) => removed.filter((r) => r.kind === k);
  assert.deepEqual(byKind('filler').map((r) => r.text), ['Um,']);
  assert.deepEqual(byKind('stutter').map((r) => r.text), ['The']);
  assert.deepEqual(byKind('restart').map((r) => r.text), ['I want to']);
  assert.deepEqual(byKind('phrase-filler').map((r) => r.text), ['You know,']);
});

test('finds the long pause and the dead air at the start and end', () => {
  const silences = detectRemovals(T, opts).filter((r) => r.kind === 'silence');
  assert.equal(silences.length, 3);
  assert.equal(silences[0].src_start_ms, 0);
  assert.ok(silences.some((s) => s.src_end_ms - s.src_start_ms > 900), 'the 1.35 s pause is a silence');
  assert.equal(silences[silences.length - 1].src_end_ms, fx.duration_ms);
});

test('natural pauses under the threshold stay', () => {
  const removed = detectRemovals(T, opts);
  // The 520 ms pause before "You" is shorter than the 650 ms standard threshold.
  const youIdx = T.words.findIndex((w) => w.text === 'You');
  const gap = T.words[youIdx].start_ms - T.words[youIdx - 1].end_ms;
  assert.ok(gap < 650);
  assert.ok(!removed.some((r) => r.kind === 'silence' && r.src_start_ms >= T.words[youIdx - 1].end_ms - 1 && r.src_end_ms <= T.words[youIdx].start_ms + 1));
});

test('every removal starts out as a proposal (keep is false) with a unique id', () => {
  const removed = detectRemovals(T, opts);
  assert.ok(removed.every((r) => r.keep === false));
  assert.equal(new Set(removed.map((r) => r.id)).size, removed.length);
});

test('pieces are ordered, never overlap, and the timeline is back to back', () => {
  const plan = roughCut(T, opts);
  let cursor = 0;
  let prevEnd = -1;
  for (const p of plan.pieces) {
    assert.ok(p.src_start_ms >= prevEnd, 'no overlap');
    assert.equal(p.out_start_ms, cursor);
    assert.ok(p.out_end_ms > p.out_start_ms);
    assert.equal(p.out_end_ms - p.out_start_ms, p.src_end_ms - p.src_start_ms);
    cursor = p.out_end_ms;
    prevEnd = p.src_end_ms;
  }
  assert.equal(plan.after_ms, cursor);
  assert.equal(plan.before_ms, fx.duration_ms);
  assert.ok(plan.after_ms < plan.before_ms);
});

test('breath safe: no cut lands inside a word, and every kept word has air around it', () => {
  const plan = roughCut(T, opts);
  for (const p of plan.pieces) {
    for (const edge of [p.src_start_ms, p.src_end_ms]) {
      for (const w of T.words) {
        assert.ok(!(edge > w.start_ms && edge < w.end_ms), `cut at ${edge} is inside "${w.text}"`);
      }
    }
  }
  const kept = wordsOnTimeline(T, plan.pieces);
  assert.ok(kept.length >= 55);
  // Dropped words do not appear.
  const texts = kept.map((w) => w.text);
  assert.ok(!texts.includes('Um,'));
  assert.ok(!texts.includes('know,'));
});

test('punchy cuts more than standard, standard more than gentle', () => {
  const g = roughCut(T, { ...opts, preset: 'gentle' }).after_ms;
  const s = roughCut(T, { ...opts, preset: 'standard' }).after_ms;
  const p = roughCut(T, { ...opts, preset: 'punchy' }).after_ms;
  assert.ok(p <= s && s <= g, `${p} <= ${s} <= ${g}`);
  assert.ok(p < g);
});

test('keeping a filler on the card puts it back in the reel', () => {
  const base = roughCut(T, opts);
  const filler = must(base.removed.find((r) => r.kind === 'filler'));
  const back = applyChoices(T, base, { keep_ids: [filler.id] });
  assert.ok(back.after_ms > base.after_ms);
  assert.ok(wordsOnTimeline(T, back.pieces).some((w) => w.text === 'Um,'));
  assert.equal(must(back.removed.find((r) => r.id === filler.id)).keep, true);
  // And dropping it again restores the first plan.
  const again = applyChoices(T, back, { drop_ids: [filler.id] });
  assert.deepEqual(again.pieces, base.pieces);
});

test('keeping a silence keeps the pause', () => {
  const base = roughCut(T, opts);
  const long = base.removed.filter((r) => r.kind === 'silence').sort((a, b) => b.src_end_ms - b.src_start_ms - (a.src_end_ms - a.src_start_ms))[0];
  const back = applyChoices(T, base, { keep_ids: [long.id] });
  const gained = back.after_ms - base.after_ms;
  assert.ok(Math.abs(gained - (long.src_end_ms - long.src_start_ms)) <= 2, `gained ${gained}`);
});

test('layoutCut with every span kept leaves the whole clip', () => {
  const removed = detectRemovals(T, opts).map((r) => ({ ...r, keep: true }));
  const plan = layoutCut(T, removed, opts);
  assert.equal(plan.pieces.length, 1);
  assert.equal(plan.after_ms, fx.duration_ms);
});

test('a piece that is too short joins its neighbour and no speech is dropped', () => {
  const words = [
    { text: 'one', start_ms: 100, end_ms: 300 },
    { text: 'two', start_ms: 2300, end_ms: 2500 },
    { text: 'three', start_ms: 4500, end_ms: 4700 },
  ];
  const t = { words, segments: [], language: 'en', quality: 'precise', engine: 'transformers' };
  const plan = roughCut(/** @type {any} */ (t), { duration_ms: 5000, min_piece_ms: 1500 });
  const kept = new Set(wordsOnTimeline(/** @type {any} */ (t), plan.pieces).map((w) => w.text));
  assert.deepEqual([...kept].sort(), ['one', 'three', 'two']);
});

test('no words gives an empty plan and not a crash', () => {
  const t = { words: [], segments: [], language: 'en', quality: 'precise', engine: 'transformers' };
  const plan = roughCut(/** @type {any} */ (t), { duration_ms: 4000 });
  assert.deepEqual(plan.pieces, []);
  assert.equal(plan.before_ms, 4000);
  assert.equal(plan.after_ms, 0);
});

test('srcToOut maps kept moments and returns null for cut ones', () => {
  const plan = roughCut(T, opts);
  const p = plan.pieces[1];
  assert.equal(srcToOut(plan.pieces, p.src_start_ms + 100), p.out_start_ms + 100);
  assert.equal(srcToOut(plan.pieces, 5), null);
});

test('cutStats counts what comes out', () => {
  const stats = cutStats(roughCut(T, opts));
  assert.equal(stats.filler_count, 2);
  assert.equal(stats.stutter_count, 2);
  assert.equal(stats.silence_count, 3);
  assert.equal(stats.saved_ms, stats.before_ms - stats.after_ms);
});

test('the rough cut is deterministic', () => {
  assert.deepEqual(roughCut(T, opts), roughCut(T, opts));
});
