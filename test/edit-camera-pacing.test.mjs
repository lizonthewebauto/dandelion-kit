import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planCamera,
  CAMERA_AGGRESSION,
  ceilingFor,
  validateCamera,
  splitMoveAt,
  mergeMoveInto,
  makeMove,
  zoomAt,
  MICRO_PUNCH_ZOOM,
  PUNCH_MIN_ZOOM,
  ZOOM_HARD_MAX,
  CREEP_PER_SECOND,
} from '../core/edit/camera.mjs';
import {
  CUT_LENGTH_BANDS,
  DENSITY_GOVERNOR,
  DEFAULT_PACING,
  pacingArcMultiplier,
  cadenceBudget,
  visualEvents,
  cameraEventIndexes,
  analyzePacing,
  applyPacingPass,
  governDensity,
  shapePacing,
  checkDensity,
  windowCounts,
} from '../core/edit/pacing.mjs';
import { makeRng } from '../core/edit/util.mjs';
import { synthBeats } from './helpers-edit.mjs';

// ---- camera ----

test('camera ceilings: calm 1.08, standard 1.12, bold 1.20, chaos 1.25', () => {
  assert.equal(CAMERA_AGGRESSION.calm.ceiling, 1.08);
  assert.equal(CAMERA_AGGRESSION.standard.ceiling, 1.12);
  assert.equal(CAMERA_AGGRESSION.bold.ceiling, 1.2);
  assert.equal(CAMERA_AGGRESSION.chaos.ceiling, 1.25);
  assert.equal(ZOOM_HARD_MAX, 1.25);
  assert.throws(() => ceilingFor(/** @type {any} */ ('wild')), /calm, standard, bold or chaos/);
});

test('plans never zoom past the ceiling and punch-ins are at least 1.05', () => {
  for (const aggression of /** @type {const} */ (['calm', 'standard', 'bold', 'chaos'])) {
    const ceiling = ceilingFor(aggression);
    for (let seed = 1; seed <= 12; seed += 1) {
      const beats = synthBeats(40000, 2200, (i) => ({ treatment: i % 3 === 0 ? 'punch-in' : 'face', emphasis_words: i % 2 ? [1] : [] }));
      const cam = planCamera(beats, { aggression, seed, cadence_max_ms: 3000 });
      for (const m of cam) {
        assert.ok(m.zoom_to <= ceiling + 1e-9 && m.zoom_from >= 1, `${aggression} ${m.zoom_from}->${m.zoom_to}`);
        if (m.kind === 'punch-in') assert.ok(m.zoom_to >= PUNCH_MIN_ZOOM);
      }
      assert.deepEqual(validateCamera(cam, { ceiling, duration_ms: 40000 }), []);
    }
  }
});

test('the same kind never repeats more than twice in a row', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const beats = synthBeats(60000, 1800, () => ({ emphasis_words: [3] }));
    const cam = planCamera(beats, { aggression: 'bold', seed });
    let run = 1;
    for (let i = 1; i < cam.length; i += 1) {
      run = cam[i].kind === cam[i - 1].kind ? run + 1 : 1;
      assert.ok(run <= 2, `seed ${seed} run of ${run} at ${i}`);
    }
  }
});

test('camera plans are deterministic for a seed and differ for another', () => {
  const beats = synthBeats(40000, 2500);
  const a = planCamera(beats, { seed: 7 });
  const b = planCamera(beats, { seed: 7 });
  const c = planCamera(beats, { seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('moves are back to back and cover the whole reel', () => {
  const cam = planCamera(synthBeats(30000, 2500), { duration_ms: 30000 });
  assert.equal(cam[0].out_start_ms, 0);
  assert.equal(cam[cam.length - 1].out_end_ms, 30000);
  for (let i = 1; i < cam.length; i += 1) assert.equal(cam[i].out_start_ms, cam[i - 1].out_end_ms);
});

test('long calm beats creep at 0.011 per second, and micro-punch is 1.03', () => {
  const creep = makeMove('creep', 0, 4000, { amplitude: 1, ceiling: 1.2 });
  assert.equal(creep.zoom_to, Math.round((1 + CREEP_PER_SECOND * 4) * 10000) / 10000);
  assert.equal(makeMove('micro-punch', 0, 1000, { amplitude: 1, ceiling: 1.2 }).zoom_to, MICRO_PUNCH_ZOOM);
  const cam = planCamera(synthBeats(20000, 4000), { aggression: 'standard', seed: 3 });
  assert.ok(cam.some((m) => m.kind === 'creep'));
});

test('an emotional beat gets a slow push and no punch-in', () => {
  const beats = synthBeats(12000, 4000, (i) => (i === 1 ? { kind: 'emotional', emphasis_words: [2] } : {}));
  const cam = planCamera(beats, { seed: 1 });
  assert.equal(cam[1].kind, 'creep');
  assert.ok(cam[1].zoom_to <= 1.04);
});

test('zoomAt follows the shape of each move', () => {
  const punch = makeMove('punch-in', 1000, 4000, { amplitude: 1.1, ceiling: 1.2 });
  assert.equal(zoomAt(punch, 1000), 1);
  assert.equal(zoomAt(punch, 2000), 1.1);
  const creep = makeMove('creep', 0, 4000, { amplitude: 1, ceiling: 1.2 });
  assert.ok(zoomAt(creep, 2000) > 1 && zoomAt(creep, 2000) < creep.zoom_to);
});

test('splitting adds a visual change at that time and merging takes one away', () => {
  const cam = planCamera(synthBeats(20000, 5000), { seed: 2, duration_ms: 20000 });
  const lastStart = cam[cam.length - 1].out_start_ms;
  const before = cameraEventIndexes(cam).length;
  const split = splitMoveAt(cam, lastStart + 2500, { rng: makeRng(1), ceiling: 1.12 });
  assert.ok(split);
  assert.equal(cameraEventIndexes(split).length, before + 1);
  assert.ok(visualEvents(split).includes(lastStart + 2500));
  assert.equal(splitMoveAt(cam, 50, { rng: makeRng(1), ceiling: 1.12 }), null, 'too close to an edge');
  const idx = split.findIndex((m) => m.out_start_ms === lastStart + 2500);
  const merged = mergeMoveInto(split, idx, 1.12);
  assert.equal(merged.length, split.length - 1);
  assert.equal(merged[merged.length - 1].out_end_ms, 20000);
});

// ---- pacing numbers ----

test('cut length bands and density limits are the plan numbers', () => {
  assert.deepEqual(CUT_LENGTH_BANDS.tiktok, { min_ms: 1500, max_ms: 3000 });
  assert.deepEqual(CUT_LENGTH_BANDS['instagram-reels'], { min_ms: 2500, max_ms: 4000 });
  assert.deepEqual(CUT_LENGTH_BANDS['youtube-shorts'], { min_ms: 3000, max_ms: 5000 });
  assert.equal(DENSITY_GOVERNOR.min, 4);
  assert.equal(DENSITY_GOVERNOR.target, 6);
  assert.equal(DENSITY_GOVERNOR.max, 8);
  assert.equal(DENSITY_GOVERNOR.min_gap_ms, 800);
  assert.equal(DENSITY_GOVERNOR.window_ms, 10000);
  assert.equal(DEFAULT_PACING.max_gap_ms, 3000);
  assert.equal(DEFAULT_PACING.opening_gap_ms, 2000);
});

test('pacing arc: first 15 percent x1.25, middle x0.9, last 30 percent x1.15', () => {
  assert.equal(pacingArcMultiplier(0), 1.25);
  assert.equal(pacingArcMultiplier(0.14), 1.25);
  assert.equal(pacingArcMultiplier(0.15), 0.9);
  assert.equal(pacingArcMultiplier(0.69), 0.9);
  assert.equal(pacingArcMultiplier(0.7), 1.15);
  assert.equal(pacingArcMultiplier(1), 1.15);
  assert.throws(() => pacingArcMultiplier(1.2), /between 0 and 1/);
  assert.deepEqual(cadenceBudget({ platform: 'tiktok', progress: 0.5 }), { min_ms: 1667, max_ms: 3333 });
  assert.ok(cadenceBudget({ platform: 'tiktok', progress: 0.05 }).max_ms < cadenceBudget({ platform: 'tiktok', progress: 0.5 }).max_ms);
});

// ---- pacing passes ----

test('visual events include the start, fixed events and every real zoom step', () => {
  const cam = [
    makeMove('wide', 0, 3000, { amplitude: 1, ceiling: 1.12 }),
    makeMove('punch-in', 3000, 6000, { amplitude: 1.08, ceiling: 1.12 }),
    makeMove('micro-punch', 6000, 9000, { amplitude: 1, ceiling: 1.12 }),
    makeMove('wide', 9000, 12000, { amplitude: 1, ceiling: 1.12 }),
  ];
  // punch-in at 3000 counts; micro-punch at 6000 steps down from 1.08 so counts; wide at 9000 follows 1.03 and does not.
  assert.deepEqual(visualEvents(cam, [1500]), [0, 1500, 3000, 6000]);
});

test('analyzePacing reports a long quiet stretch and the opening limit', () => {
  const cam = [makeMove('wide', 0, 20000, { amplitude: 1, ceiling: 1.12 })];
  const report = analyzePacing({ camera: cam, duration_ms: 20000 });
  assert.equal(report.max_gap_ms, 20000);
  assert.equal(report.gaps_over_limit.length, 1);
});

test('the cut-the-curve pass leaves no gap over 3 seconds, or 2 seconds in the opening', () => {
  const cam = planCamera(synthBeats(30000, 6000), { seed: 4, duration_ms: 30000 });
  const out = applyPacingPass(cam, 30000, { ceiling: 1.12 });
  const report = analyzePacing({ camera: out.camera, duration_ms: 30000 });
  assert.deepEqual(report.gaps_over_limit, []);
  assert.ok(out.added_ms.length > 0);
  assert.ok(report.events.filter((t) => t < 3000).length >= 2, 'something new inside the first 2 seconds');
});

test('density governor keeps events per 10 s within [4, 8] on a synthetic 60 s plan', () => {
  const beats = synthBeats(60000, 2500, (i) => ({ treatment: i % 2 ? 'punch-in' : 'face', emphasis_words: i % 2 ? [1] : [] }));
  const planned = planCamera(beats, { aggression: 'bold', seed: 11, duration_ms: 60000 });
  const out = shapePacing(planned, 60000, { ceiling: 1.2, seed: 11 });
  const events = visualEvents(out.camera);
  const check = checkDensity(events, 60000);
  assert.ok(check.ok, `windows out of range: ${JSON.stringify(check.violations.slice(0, 3))} (min ${check.min_seen}, max ${check.max_seen})`);
  assert.ok(check.min_seen >= 4 && check.max_seen <= 8, `min ${check.min_seen} max ${check.max_seen}`);
  assert.ok(check.min_gap_ok, 'no two changes closer than 0.8 s');
});

test('the governor thins a plan that is far too busy', () => {
  // A punch-in every second: 10 events per window.
  const cam = [];
  for (let t = 0; t < 40000; t += 1000) cam.push(makeMove(t / 1000 % 2 === 0 ? 'punch-in' : 'wide', t, t + 1000, { amplitude: 1.1, ceiling: 1.2 }));
  const before = checkDensity(visualEvents(cam), 40000);
  assert.ok(!before.ok);
  const out = governDensity(cam, 40000, { ceiling: 1.2 });
  const after = checkDensity(visualEvents(out.camera), 40000);
  assert.ok(after.ok, JSON.stringify(after.violations.slice(0, 2)));
  assert.ok(out.removed_ms.length > 0);
});

test('the governor fills a plan that is far too quiet', () => {
  const cam = [makeMove('wide', 0, 60000, { amplitude: 1, ceiling: 1.12 })];
  const out = governDensity(cam, 60000, { ceiling: 1.12 });
  const after = checkDensity(visualEvents(out.camera), 60000);
  assert.ok(after.ok, `min ${after.min_seen} max ${after.max_seen}`);
  assert.ok(out.added_ms.length >= 20);
});

test('every look density stays inside the governor limits', () => {
  for (const density of [{ min: 4, target: 4, max: 6 }, { min: 5, target: 7, max: 8 }, { min: 4, target: 6, max: 8 }]) {
    const cam = planCamera(synthBeats(60000, 3000), { seed: 5, duration_ms: 60000 });
    const out = shapePacing(cam, 60000, { ceiling: 1.12, density, seed: 5 });
    const check = checkDensity(visualEvents(out.camera), 60000);
    assert.ok(check.ok, `density ${JSON.stringify(density)}: min ${check.min_seen} max ${check.max_seen}`);
  }
});

test('short reels scale the limits down and are still fixed to something sensible', () => {
  const cam = planCamera(synthBeats(6000, 3000), { seed: 1, duration_ms: 6000 });
  const out = shapePacing(cam, 6000, { ceiling: 1.12 });
  const counts = windowCounts(visualEvents(out.camera), 6000);
  assert.equal(counts.length, 1);
  assert.ok(counts[0].count >= 2 && counts[0].count <= 5);
});

test('shaping is deterministic', () => {
  const run = () => shapePacing(planCamera(synthBeats(60000, 2500), { seed: 9, duration_ms: 60000 }), 60000, { ceiling: 1.12, seed: 9 });
  assert.deepEqual(run(), run());
});
