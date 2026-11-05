import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestStyle } from '../core/style/map.mjs';
import { parseStyle } from '../core/style/schema.mjs';
import { contrast } from '../core/carousel/color.mjs';

/** A long enough sample with four cuts and enough heard words. */
function sample(changes = {}) {
  return {
    duration_ms: 12000, cut_times_ms: [1500, 3000, 4500, 6000],
    shot_ms: { p25: 1200, median: 1800, p75: 2400 }, cuts_per_10s: 4,
    words_per_minute: 150, word_count: 30, pause_ms: { median: 300, p90: 400 },
    grade: { saturation: 0.2, contrast: 0.2, warmth: 0 }, speech: 'measured', confidence: 'ok', ...changes,
  };
}

/** @returns {NonNullable<import('../core/style/schema.mjs').StyleInput['video']>} */
function mapped(videos) {
  return /** @type {any} */ (suggestStyle([], videos)).video ?? {};
}

test('one measured video maps cadence pause density and grade inside saved bounds', () => {
  const result = suggestStyle([], [sample()]);
  assert.deepEqual(result, { video: {
    base_look: 'bold-value', rough_cut: 'punchy', overrides: {
      cut_every_ms_min: 1200, cut_every_ms_max: 2400, camera_aggression: 'bold',
      density_per_10s: { min: 3, target: 5, max: 7 }, grade: { saturation: 1.05, contrast: 1.05, warmth: 0 },
    },
  } });
  assert.doesNotThrow(() => parseStyle(result));
  assert.deepEqual(suggestStyle([], [sample()]), result);
});

test('shot clamps enforce both endpoints and the gap between min and max', () => {
  const cases = [
    { p25: 20, p75: 200, min: 800, max: 1400 },
    { p25: 20000, p75: 50000, min: 6000, max: 9000 },
    { p25: 3000, p75: 3100, min: 3000, max: 3600 },
    { p25: 800, p75: 9000, min: 800, max: 9000 },
  ];
  for (const c of cases) {
    const video = mapped([sample({ shot_ms: { p25: c.p25, median: 2500, p75: c.p75 } })]);
    assert.equal(video.overrides?.cut_every_ms_min, c.min);
    assert.equal(video.overrides?.cut_every_ms_max, c.max);
    assert.doesNotThrow(() => parseStyle({ video }));
  }
});

test('camera and base look use the exact median shot thresholds', () => {
  for (const [median, camera, look] of [[1999, 'bold', 'bold-value'], [2000, 'standard', 'karaoke-clean'], [3499, 'standard', 'karaoke-clean'], [3500, 'calm', 'minimal-educator']]) {
    const video = mapped([sample({ shot_ms: { p25: 1000, median, p75: 4000 } })]);
    assert.equal(video.overrides?.camera_aggression, camera);
    assert.equal(video.base_look, look);
  }
});

test('density rounds the cuts plus one and clamps each end', () => {
  for (const [cuts, density] of [[0, { min: 3, target: 3, max: 5 }], [3.4, { min: 3, target: 4, max: 6 }], [3.5, { min: 3, target: 5, max: 7 }], [40, { min: 6, target: 8, max: 8 }]]) {
    assert.deepEqual(mapped([sample({ cuts_per_10s: cuts })]).overrides?.density_per_10s, density);
  }
});

test('pause thresholds apply only with enough measured speech', () => {
  for (const [p90, preset] of [[449, 'punchy'], [450, 'standard'], [799, 'standard'], [800, 'gentle']]) {
    assert.equal(mapped([sample({ pause_ms: { p90 } })]).rough_cut, preset);
  }
  for (const changes of [{ speech: 'unavailable' }, { word_count: 19 }, { word_count: undefined }, { pause_ms: null }]) {
    assert.equal(mapped([sample(changes)]).rough_cut, undefined);
  }
  assert.equal(mapped([sample({ word_count: 20 })]).rough_cut, 'punchy');
});

test('grade thresholds include the exact boundary values', () => {
  for (const [saturation, want] of [[0, 0.95], [0.179, 0.95], [0.18, 1.05], [0.319, 1.05], [0.32, 1.12], [1, 1.12]]) {
    assert.equal(mapped([sample({ grade: { saturation } })]).overrides?.grade?.saturation, want);
  }
  for (const [contrast, want] of [[0, 1], [0.179, 1], [0.18, 1.05], [0.259, 1.05], [0.26, 1.1], [1, 1.1]]) {
    assert.equal(mapped([sample({ grade: { contrast } })]).overrides?.grade?.contrast, want);
  }
  for (const [warmth, want] of [[-1, -0.06], [-0.081, -0.06], [-0.08, 0], [0.08, 0], [0.081, 0.06], [1, 0.06]]) {
    assert.equal(mapped([sample({ grade: { warmth } })]).overrides?.grade?.warmth, want);
  }
});

test('mapping uses medians across usable videos and ignores weak cadence', () => {
  const videos = [
    sample({ shot_ms: { p25: 1000, median: 1000, p75: 2000 }, cuts_per_10s: 2, pause_ms: { p90: 200 }, grade: { saturation: 0.1, contrast: 0.1, warmth: -0.1 } }),
    sample({ shot_ms: { p25: 3000, median: 4000, p75: 6000 }, cuts_per_10s: 6, pause_ms: { p90: 1000 }, grade: { saturation: 0.4, contrast: 0.4, warmth: 0.1 } }),
    sample({ duration_ms: 7000, cut_times_ms: [], shot_ms: { p25: 6000, median: 6000, p75: 8000 }, word_count: 2, grade: null }),
  ];
  const video = mapped(videos);
  assert.equal(video.overrides?.cut_every_ms_min, 2000);
  assert.equal(video.overrides?.cut_every_ms_max, 4000);
  assert.equal(video.overrides?.camera_aggression, 'standard');
  assert.equal(video.overrides?.density_per_10s?.target, 5);
  assert.equal(video.rough_cut, 'standard');
  assert.deepEqual(video.overrides?.grade, { saturation: 1.05, contrast: 1.05, warmth: 0 });
});

test('short single shot and too few cuts omit cadence camera density and base look', () => {
  for (const changes of [{ duration_ms: 7999 }, { cut_times_ms: [] }, { cut_times_ms: [1000, 2000] }]) {
    const video = mapped([sample({ ...changes, confidence: 'low' })]);
    assert.equal(video.base_look, undefined);
    assert.equal(video.overrides?.cut_every_ms_min, undefined);
    assert.equal(video.overrides?.cut_every_ms_max, undefined);
    assert.equal(video.overrides?.camera_aggression, undefined);
    assert.equal(video.overrides?.density_per_10s, undefined);
    assert.ok(video.overrides?.grade);
  }
  assert.equal(mapped([sample({ duration_ms: 8000, cut_times_ms: [1000, 2000, 3000], confidence: 'low', word_count: 0 })]).base_look, 'bold-value', 'low speech does not discard useful cut measurements');
});

test('first image suggests colors only and gives video its accent without guessing captions or sound', () => {
  const images = [
    { bg_hex: '#102A43', text_hex: '#203A53', accent_hex: '#FFB400' },
    { bg_hex: '#FFFFFF', text_hex: '#111111', accent_hex: '#FF0000' },
  ];
  const result = /** @type {import('../core/style/schema.mjs').StyleInput} */ (suggestStyle(images, [sample()]));
  assert.equal(result.brand?.colors?.bg, '#102A43');
  assert.equal(result.brand?.colors?.accent, '#FFB400');
  assert.ok(contrast(result.brand.colors.bg, result.brand.colors.fg) >= 4.5);
  assert.ok(contrast(result.brand.colors.bg, result.brand.colors.muted) >= 4.5);
  assert.equal(result.brand.fonts, undefined);
  assert.equal(result.carousel, undefined);
  assert.equal(result.video?.accent, '#FFB400');
  assert.equal(result.video?.caption_theme, undefined);
  assert.equal(result.video?.overrides?.sfx_per_minute, undefined);
  assert.equal(/** @type {any} */ (suggestStyle(images)).video, undefined);
  assert.deepEqual(suggestStyle(), {});
  assert.doesNotThrow(() => parseStyle(result));
});

test('missing or nonfinite measurements do not become saved guesses', () => {
  const absent = sample({ duration_ms: NaN, words_per_minute: null, word_count: 0, pause_ms: null, grade: { saturation: NaN, contrast: Infinity, warmth: undefined } });
  assert.deepEqual(suggestStyle([], [absent]), {});
  const incomplete = mapped([sample({ shot_ms: { p25: 1000, median: NaN, p75: 4000 }, speech: 'unavailable' })]);
  assert.equal(incomplete.base_look, undefined);
  assert.equal(incomplete.rough_cut, undefined);
  assert.equal(incomplete.overrides?.camera_aggression, undefined);
  assert.ok(incomplete.overrides?.grade);
});
