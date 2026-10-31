// Render path, parts that need no ffmpeg: sound synth, font widths, captions file, filter graph text,
// face anchor math and variant choices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPTION_THEMES, SFX_NAMES } from '../core/types.mjs';
import { planShots, HOOK_ZONE } from '../core/edit/shotplan.mjs';
import { roughCut } from '../core/edit/roughcut.mjs';
import { zoomAt } from '../core/edit/camera.mjs';
import { ensureSfx, synthSfx, SFX_SAMPLE_RATE } from '../core/render/sfx.mjs';
import { loadFontFace } from '../core/render/fontmetrics.mjs';
import {
  FONT_FILES,
  MAX_TEXT_WIDTH,
  SAFE_ZONE,
  THEME_STYLES,
  assColor,
  balanceLines,
  buildAss,
  formatAssTime,
  layoutCue,
  readableOn,
} from '../core/render/ass.mjs';
import {
  buildSpeechGraph,
  buildVideoGraph,
  gradeFilters,
  snapPieces,
  zoomExpression,
} from '../core/render/filtergraph.mjs';
import { loudnormFilter, parseLoudnormJson } from '../core/render/audio.mjs';
import {
  ANCHOR_RULES,
  anchorFromSamples,
  chinAtZoom,
  chinTrack,
  decodeYunet,
  maxZoomOf,
  nonMaxSuppression,
} from '../core/render/facezone.mjs';
import { axesDiffer, axesOf, buildVariantPlan, planVariantAxes } from '../core/render/variants.mjs';
import { loadFixture } from './helpers-edit.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const fx = loadFixture();
const T = fx.transcript;
const cut = roughCut(T, { duration_ms: fx.duration_ms });
const plan = planShots(T, cut, 'karaoke-clean', { seed: 1 });

// ---------------------------------------------------------------------------
// Sound synth
// ---------------------------------------------------------------------------

test('the synth makes all ten sounds, the same bytes every time', () => {
  for (const name of SFX_NAMES) {
    const a = synthSfx(name);
    const b = synthSfx(name);
    assert.ok(a.bytes.equals(b.bytes), `${name} is not repeatable`);
    assert.equal(a.bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(a.bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(a.bytes.readUInt32LE(24), SFX_SAMPLE_RATE);
    assert.equal(a.bytes.readUInt16LE(34), 16);
    assert.ok(a.peak > 0.15 && a.peak < 0.4, `${name} peak ${a.peak}`);
    assert.equal(a.bytes.readInt16LE(44), 0, `${name} starts at silence`);
    assert.ok(a.duration_ms >= 70 && a.duration_ms <= 1200);
  }
  assert.throws(() => synthSfx(/** @type {any} */ ('kazoo')), /no sound/);
});

test('ensureSfx writes the files once and reuses them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-sfx-'));
  try {
    const first = ensureSfx(dir);
    assert.equal(Object.keys(first.files).length, SFX_NAMES.length);
    const sha = first.files.pop.sha256;
    const second = ensureSfx(dir);
    assert.equal(second.files.pop.sha256, sha);
    assert.equal(readFileSync(second.files.pop.path).length, 44 + Math.round(0.07 * SFX_SAMPLE_RATE) * 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fonts and captions
// ---------------------------------------------------------------------------

test('font widths come from the real font files', () => {
  const m = loadFontFace(FONT_FILES.montserrat.file);
  assert.equal(m.family, 'Montserrat ExtraBold');
  assert.ok(m.width('Hello', 66) > m.width('Hi', 66));
  assert.ok(Math.abs(m.width('Hello', 132) / m.width('Hello', 66) - 2) < 0.001);
  const mono = loadFontFace(FONT_FILES.mono.file);
  assert.ok(Math.abs(mono.width('iiii', 50) - mono.width('WWWW', 50)) < 0.5, 'a mono font has equal widths');
  assert.ok(m.line_height(100) > 100);
});

test('ass colors and times are written the way libass reads them', () => {
  assert.equal(assColor('#FFD93D'), '&H003DD9FF');
  assert.equal(assColor('#000000', 255), '&HFF000000');
  assert.equal(formatAssTime(0), '0:00:00.00');
  assert.equal(formatAssTime(61230), '0:01:01.23');
  assert.equal(formatAssTime(3600000), '1:00:00.00');
  assert.equal(readableOn('#FFD93D'), '#111111');
  assert.equal(readableOn('#1A1A40'), '#FFFFFF');
});

test('every caption theme builds, fits the safe zone and keeps the hook in its zone', () => {
  for (const theme of CAPTION_THEMES) {
    const p = planShots(T, cut, 'karaoke-clean', { seed: 3, caption_theme: theme });
    const { text, layout } = buildAss(p, { quality: 'final' });
    assert.ok(layout.cues > 10, `${theme} has cues`);
    assert.ok(layout.widest <= MAX_TEXT_WIDTH + 1, `${theme} widest ${layout.widest}`);
    assert.ok(layout.top_min >= SAFE_ZONE.y_min, theme);
    assert.ok(layout.bottom_max <= SAFE_ZONE.y_max + 0.5, `${theme} bottom ${layout.bottom_max}`);
    assert.match(text, /\[Script Info\][\s\S]*PlayResX: 1080[\s\S]*PlayResY: 1920/);
    assert.ok(layout.hook, `${theme} has a hook card`);
    const hook = /** @type {NonNullable<typeof layout.hook>} */ (layout.hook);
    assert.ok(
      hook.top >= HOOK_ZONE.y_min && hook.bottom <= HOOK_ZONE.y_max + 20,
      `${theme} hook ${hook.top}-${hook.bottom}`,
    );
    assert.ok(hook.lines.length <= 3);
    assert.ok(!text.includes(EM) && !text.includes(EN), `${theme} has no dashes`);
  }
});

test('karaoke makes one event per cue with the active word lit, pills add a second layer', () => {
  const k = planShots(T, cut, 'karaoke-clean', { seed: 1 });
  const ass = buildAss(k).text;
  const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,') && l.includes(',Cap,'));
  assert.equal(dialogues.length, k.captions.length);
  assert.ok(
    dialogues.every((l) => l.includes(`\\1c&H${assColor(k.accent).slice(2, 8)}&`) || l.includes('\\1c')),
    'colors are set per word',
  );
  const lit = dialogues.filter((l) => l.includes('&H3DD9FF&'));
  assert.equal(lit.length, k.captions.length, 'one word is lit in every karaoke cue');

  const pill = planShots(T, cut, 'karaoke-clean', { seed: 1, caption_theme: 'karaoke-pill' });
  const pillAss = buildAss(pill).text;
  assert.ok(pillAss.split('\n').some((l) => l.startsWith('Dialogue: 1,') && l.includes(',Pill,')));
  const one = planShots(T, cut, 'storytime-energy', { seed: 1 });
  assert.match(buildAss(one).text, /\\fscx82\\fscy82\\t\(0,110,\\fscx112/);
});

test('a draft gets a DRAFT stamp and a final does not', () => {
  assert.match(buildAss(plan, { quality: 'draft' }).text, /,Stamp,.*DRAFT/);
  assert.doesNotMatch(buildAss(plan, { quality: 'final' }).text, /DRAFT/);
});

test('a long line is shrunk to fit and never starts below the safe zone', () => {
  const style = THEME_STYLES['karaoke-highlight'];
  const wide = layoutCue(style, ['extraordinarily', 'unquestionably', 'misunderstood'], 700);
  assert.ok(wide.width <= MAX_TEXT_WIDTH + 1 || wide.size <= Math.floor(style.size * 0.7) + 1);
  assert.ok(wide.size < style.size);
  assert.ok(wide.size >= Math.floor(style.size * 0.7));
  const low = layoutCue(
    THEME_STYLES['clean-minimal'],
    ['two', 'lines', 'of', 'words', 'that', 'wrap', 'around', 'the', 'screen'],
    1800,
  );
  assert.ok(low.top + low.height <= SAFE_ZONE.y_max + 0.5);
  assert.equal(low.lines.length, 2);
  const high = layoutCue(style, ['hi', 'there'], 10);
  assert.ok(high.top >= SAFE_ZONE.y_min);
});

test('balanceLines splits a phrase into two even lines', () => {
  const widthOf = (l) => l.length * 30;
  const lines = balanceLines('one two three four five six seven eight'.split(' '), widthOf, 2);
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 6);
  assert.deepEqual(balanceLines(['short', 'one'], widthOf, 2), ['short one']);
  assert.equal(
    balanceLines('a b c d e f g h i j k l m n o p q r s t u v w x y z'.split(' '), () => 5000, 1).length,
    1,
  );
});

test('the caption anchor drives where captions are placed', () => {
  const lowered = { ...plan, caption_anchor: { x: 540, y: 1300 } };
  const { layout } = buildAss(lowered);
  assert.equal(layout.anchor_y, 1300);
  const none = buildAss({ ...plan, caption_anchor: null }, { fallback_y: 1111 });
  assert.equal(none.layout.anchor_y, 1111);
});

// ---------------------------------------------------------------------------
// Filter graph
// ---------------------------------------------------------------------------

/** Evaluate an ffmpeg expression for t, using the same functions ffmpeg has. */
function evalExpr(expr, t) {
  const fn = new Function('t', 'lt', 'clip', 'if_', `return ${expr.replace(/\bif\(/g, 'if_(')};`);
  return fn(
    t,
    (a, b) => (a < b ? 1 : 0),
    (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    (c, a, b) => (c ? a : b),
  );
}

test('snapPieces puts every cut on a whole frame and never drifts', () => {
  const pieces = [
    {
      id: 'p1',
      src_start_ms: 100,
      src_end_ms: 1990,
      out_start_ms: 0,
      out_end_ms: 1890,
      first_word: 0,
      last_word: 3,
    },
    {
      id: 'p2',
      src_start_ms: 2410,
      src_end_ms: 5003,
      out_start_ms: 1890,
      out_end_ms: 4483,
      first_word: 4,
      last_word: 9,
    },
    {
      id: 'p3',
      src_start_ms: 6000,
      src_end_ms: 6013,
      out_start_ms: 4483,
      out_end_ms: 4496,
      first_word: 10,
      last_word: 10,
    },
    {
      id: 'p4',
      src_start_ms: 7000,
      src_end_ms: 9777,
      out_start_ms: 4496,
      out_end_ms: 7273,
      first_word: 11,
      last_word: 12,
    },
  ];
  const { segments, total_frames } = snapPieces(pieces, 30);
  assert.equal(
    segments.reduce((s, x) => s + x.frames, 0),
    total_frames,
  );
  assert.equal(total_frames, Math.round((7273 * 30) / 1000));
  let cursor = 0;
  for (const s of segments) {
    assert.equal(s.out_frame, cursor);
    cursor += s.frames;
    assert.ok(s.frames >= 1);
  }
  // Boundaries stay within half a frame of the plan's times.
  for (const [i, s] of segments.entries())
    assert.ok(Math.abs((s.out_frame * 1000) / 30 - pieces[i].out_start_ms) <= 17);
});

test('the zoom expression matches the camera plan at any time', () => {
  const expr = zoomExpression(plan.camera);
  assert.ok(!expr.includes("'"), 'no quotes inside the expression');
  for (let t = 0; t < plan.duration_ms; t += 137) {
    const move =
      plan.camera.find((m) => t >= m.out_start_ms && t < m.out_end_ms) ?? plan.camera[plan.camera.length - 1];
    const want = zoomAt(move, t);
    const got = evalExpr(expr, t / 1000);
    assert.ok(Math.abs(got - want) < 0.002, `t=${t} want ${want} got ${got} (${move.kind})`);
  }
  assert.equal(zoomExpression([]), '1');
  assert.equal(
    zoomExpression([{ out_start_ms: 0, out_end_ms: 1000, kind: 'wide', zoom_from: 1, zoom_to: 1 }]),
    '1',
  );
});

test('the video graph trims every piece, joins them, zooms, grades and draws captions', () => {
  const segments = [
    { src_frame: 0, frames: 60, out_frame: 0 },
    { src_frame: 90, frames: 30, out_frame: 60 },
    { src_frame: 150, frames: 45, out_frame: 90 },
  ];
  const final = buildVideoGraph({
    segments,
    camera: plan.camera,
    look_id: 'karaoke-clean',
    quality: 'final',
  });
  assert.match(final, /\[0:v\]split=3\[v0\]\[v1\]\[v2\]/);
  assert.equal((final.match(/trim=start_frame=/g) ?? []).length, 3);
  assert.match(final, /trim=start_frame=90:end_frame=120/);
  assert.match(final, /concat=n=3:v=1:a=0\[cat\]/);
  assert.match(final, /eval=frame/);
  assert.match(final, /crop=1080:1920:/);
  assert.match(final, /eq=saturation=1\.05:contrast=1\.05/);
  assert.match(final, /ass=captions\.ass:fontsdir=fonts,format=yuv420p\[vout\]/);
  assert.doesNotMatch(final, /scale=540/);
  const draft = buildVideoGraph({ segments, camera: [], look_id: 'karaoke-clean', quality: 'draft' });
  assert.match(draft, /fps=15,scale=540:960/);
  assert.doesNotMatch(draft, /eval=frame/, 'no zoom stage when the camera never moves');
  const one = buildVideoGraph({
    segments: [segments[0]],
    camera: [],
    look_id: 'editorial-luxe',
    quality: 'final',
  });
  assert.match(one, /\[0:v\]null\[v0\]/);
  assert.match(one, /colorbalance=/);
  assert.throws(
    () => buildVideoGraph({ segments: [], camera: [], look_id: 'karaoke-clean', quality: 'final' }),
    /nothing to render/,
  );
});

test('the speech graph cuts on exact samples and fades each cut', () => {
  const g = buildSpeechGraph([
    { src_frame: 30, frames: 15, out_frame: 0 },
    { src_frame: 90, frames: 30, out_frame: 15 },
  ]);
  assert.match(g, /atrim=start_sample=48000:end_sample=72000/);
  assert.match(g, /atrim=start_sample=144000:end_sample=192000/);
  assert.match(g, /afade=t=in:d=0\.005/);
  assert.match(g, /concat=n=2:v=0:a=1\[joined\]/);
  assert.match(g, /\[joined\]alimiter=limit=0\.24:attack=2:release=40:level=false\[speech\]/);
});

test('looks map to grade filters', () => {
  assert.deepEqual(gradeFilters('minimal-educator'), ['eq=saturation=1.05:contrast=1.05']);
  assert.ok(gradeFilters('storytime-energy').some((f) => f.startsWith('colorbalance=rm=0.06')));
  assert.deepEqual(gradeFilters('no-such-look'), []);
});

// ---------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------

test('loudnorm numbers are read from the end of the log and fed to the second pass', () => {
  const log = `blah\n[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-21.30",\n\t"input_tp" : "-4.10",\n\t"input_lra" : "6.20",\n\t"input_thresh" : "-31.60",\n\t"output_i" : "-14.1",\n\t"target_offset" : "0.10"\n}\n`;
  const m = parseLoudnormJson(log);
  assert.equal(m?.input_i, '-21.30');
  const f = loudnormFilter(m);
  assert.match(
    f,
    /I=-14:TP=-1:LRA=11:measured_I=-21.30:measured_TP=-4.10:measured_LRA=6.20:measured_thresh=-31.60:offset=0.10:linear=true/,
  );
  assert.equal(parseLoudnormJson('no json here'), null);
  assert.equal(loudnormFilter(null), 'loudnorm=I=-14:TP=-1:LRA=11');
  const silent = parseLoudnormJson(
    '{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0", "input_thresh" : "-70", "target_offset" : "0" }',
  );
  assert.equal(loudnormFilter(silent), 'loudnorm=I=-14:TP=-1:LRA=11', 'silence falls back to one pass');
});

// ---------------------------------------------------------------------------
// Face anchor
// ---------------------------------------------------------------------------

/** @param {number} n @param {(i:number)=>({x:number,y:number,w:number,h:number}|null)} box */
const samples = (n, box) => Array.from({ length: n }, (_, i) => ({ t_ms: i * 500, box: box(i) }));

test('the anchor sits below the chin and allows for the zoom', () => {
  const s = samples(40, () => ({ x: 300, y: 770, w: 240, h: 330 }));
  const a = anchorFromSamples(s, { zoom: 1 });
  assert.equal(a.source, 'face');
  assert.equal(a.face_ratio, 1);
  assert.equal(a.chin_y, 1100);
  // chin 1100 + the larger of 40 px and 4% of the height (77 px)
  assert.equal(a.y, 1100 + 77);
  const zoomed = anchorFromSamples(s, { zoom: 1.2 });
  assert.ok(zoomed.y > a.y, 'a punch-in pushes the chin lower in the frame');
  assert.equal(zoomed.y, Math.round(chinAtZoom(1100, 1.2) + 77));
  assert.equal(a.x, 540);
});

test('the anchor is held between 50% and 78% of the frame height', () => {
  const high = anchorFromSamples(samples(20, () => ({ x: 0, y: 100, w: 100, h: 100 })));
  assert.equal(high.y, Math.round(ANCHOR_RULES.clamp_min * 1920));
  const low = anchorFromSamples(samples(20, () => ({ x: 0, y: 1500, w: 200, h: 300 })));
  assert.equal(low.y, Math.round(ANCHOR_RULES.clamp_max * 1920));
});

test('with no face in enough samples the anchor falls back with a plain note', () => {
  const some = anchorFromSamples(samples(10, (i) => (i < 5 ? { x: 0, y: 800, w: 200, h: 300 } : null)));
  assert.equal(some.source, 'fallback');
  assert.equal(some.y, Math.round(0.72 * 1920));
  assert.match(some.note ?? '', /fixed height/);
  assert.equal(anchorFromSamples([]).source, 'fallback');
  const enough = anchorFromSamples(samples(10, (i) => (i < 7 ? { x: 0, y: 800, w: 200, h: 300 } : null)));
  assert.equal(enough.source, 'face');
});

test('the chin track ignores small moves and stays within 40 keys', () => {
  const steady = chinTrack(samples(50, (i) => ({ x: 0, y: 700 + (i % 2) * 6, w: 200, h: 300 })));
  assert.equal(steady.length, 1);
  const moving = chinTrack(samples(300, (i) => ({ x: 0, y: 500 + i * 3, w: 200, h: 300 })));
  assert.ok(moving.length > 1 && moving.length <= 40);
  for (let i = 1; i < moving.length; i++) assert.ok(moving[i].t_ms - moving[i - 1].t_ms >= 400);
  // One bad frame in the middle does not move the track (median of 5).
  const spike = chinTrack(samples(20, (i) => ({ x: 0, y: i === 10 ? 1400 : 700, w: 200, h: 300 })));
  assert.equal(spike.length, 1);
});

test('overlapping face boxes collapse to the best one', () => {
  const boxes = [
    { x: 100, y: 100, w: 100, h: 100, score: 0.7 },
    { x: 105, y: 102, w: 100, h: 100, score: 0.9 },
    { x: 500, y: 500, w: 80, h: 80, score: 0.65 },
  ];
  const kept = nonMaxSuppression(boxes, 0.3);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].score, 0.9);
});

test('the face model output is read into boxes in the 640 square', () => {
  const names = [
    'cls_8',
    'cls_16',
    'cls_32',
    'obj_8',
    'obj_16',
    'obj_32',
    'bbox_8',
    'bbox_16',
    'bbox_32',
    'kps_8',
    'kps_16',
    'kps_32',
  ];
  const cells = { 8: 80, 16: 40, 32: 20 };
  /** @type {Record<string, {data: Float32Array}>} */
  const out = {};
  for (const s of [8, 16, 32]) {
    const n = cells[s] * cells[s];
    out[`cls_${s}`] = { data: new Float32Array(n) };
    out[`obj_${s}`] = { data: new Float32Array(n) };
    out[`bbox_${s}`] = { data: new Float32Array(n * 4) };
    out[`kps_${s}`] = { data: new Float32Array(n * 10) };
  }
  // One confident cell on the stride 16 map: row 10, column 12, a box about 96 px wide and 128 px tall.
  const i = 10 * 40 + 12;
  out.cls_16.data[i] = 0.95;
  out.obj_16.data[i] = 0.95;
  out.bbox_16.data.set([0.5, 0.5, Math.log(6), Math.log(8)], i * 4);
  const boxes = decodeYunet(out, names);
  assert.equal(boxes.length, 1);
  const b = boxes[0];
  assert.ok(Math.abs(b.w - 96) < 0.5 && Math.abs(b.h - 128) < 0.5);
  assert.ok(Math.abs(b.x + b.w / 2 - 12.5 * 16) < 0.5);
  assert.ok(Math.abs(b.y + b.h / 2 - 10.5 * 16) < 0.5);
  assert.ok(b.score > 0.9);
  assert.equal(decodeYunet({ ...out, cls_16: { data: new Float32Array(1600) } }, names).length, 0);
});

test('maxZoomOf reads the plan', () => {
  assert.equal(maxZoomOf(undefined), ANCHOR_RULES.default_zoom);
  assert.ok(maxZoomOf(plan) >= 1 && maxZoomOf(plan) <= 1.25);
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

test('variant choices differ from the plan and from each other on at least two axes', () => {
  const base = axesOf(plan);
  for (const count of [2, 3, 4]) {
    const sets = planVariantAxes(plan, count);
    assert.equal(sets.length, count);
    for (const s of sets) assert.ok(axesDiffer(base, s).length >= 2, 'differs from the plan');
    for (let i = 0; i < sets.length; i++)
      for (let j = i + 1; j < sets.length; j++)
        assert.ok(axesDiffer(sets[i], sets[j]).length >= 2, `v${i + 1} vs v${j + 1}`);
  }
  assert.deepEqual(planVariantAxes(plan, 3), planVariantAxes(plan, 3));
});

test('the hook line only counts as a difference when a hook card shows', () => {
  const a = {
    hook_text: 'One',
    opening: /** @type {const} */ ('cold-open'),
    caption_theme: 'bold-stroke',
    pace: /** @type {const} */ ('standard'),
  };
  const b = { ...a, hook_text: 'Two' };
  assert.deepEqual(axesDiffer(a, b), []);
  assert.deepEqual(axesDiffer({ ...a, opening: 'hook-card' }, b), ['hook_text', 'opening']);
});

test('a variant keeps the same speech and the same cut length', () => {
  const sets = planVariantAxes(plan, 3);
  const flat = (p) => [...new Set(p.captions.flatMap((c) => c.word_indexes))];
  for (const axes of sets) {
    const v = buildVariantPlan(T, cut, plan, axes);
    assert.equal(v.duration_ms, plan.duration_ms);
    assert.deepEqual(flat(v), flat(plan), 'every spoken word is still captioned, in the same order');
    assert.equal(v.caption_theme, axes.caption_theme);
    assert.equal(v.look_id, plan.look_id);
    if (axes.opening === 'cold-open') {
      assert.notEqual(v.beats[0].treatment, 'hook-card');
      assert.equal(v.beats[0].screen_text, undefined);
    } else {
      assert.equal(v.beats[0].treatment, 'hook-card');
      assert.equal(v.beats[0].screen_text, axes.hook_text);
    }
    assert.notEqual(v.hash, plan.hash);
  }
});

test('a punchier pace changes the picture more often than a gentle one', () => {
  const base = axesOf(plan);
  const punchy = buildVariantPlan(T, cut, plan, { ...base, pace: 'punchy' });
  const gentle = buildVariantPlan(T, cut, plan, { ...base, pace: 'gentle' });
  assert.ok(
    punchy.camera.length > gentle.camera.length,
    `${punchy.camera.length} vs ${gentle.camera.length}`,
  );
});

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

test('the edit command line reads flags and keeps the video path', async () => {
  const { parseEditArgs } = await import('../core/render/cli.mjs');
  const { flags, positional } = parseEditArgs([
    'clip.mp4',
    '--look',
    'bold-value',
    '--out',
    'out dir',
    '--variants',
    '3',
    '--hook',
    'Stop doing this',
  ]);
  assert.deepEqual(positional, ['clip.mp4']);
  assert.equal(flags.look, 'bold-value');
  assert.equal(flags.out, 'out dir');
  assert.equal(flags.variants, '3');
  assert.equal(flags.hook, 'Stop doing this');
  assert.equal(parseEditArgs(['a.mp4', '--variants']).flags.variants, true);
});

// ---------------------------------------------------------------------------
// Caption size (Fable QA 1, P0-1): theme sizes are em pixels, converted to the ASS Fontsize libass wants
// ---------------------------------------------------------------------------

test('libass Fontsize is the whole line box, so an em of text needs a larger Fontsize', () => {
  const m = loadFontFace(FONT_FILES.montserrat.file);
  // Montserrat: OS/2 win ascent 1109 + descent 453 over 1000 units, so 100 px of em is a Fontsize of about 156.
  assert.ok(Math.abs(m.ass_scale - 1.562) < 0.01, `scale ${m.ass_scale}`);
  assert.ok(Math.abs(m.ass_fontsize(68) - 106.2) < 0.5);
  assert.equal(m.line_height(50), m.ass_fontsize(50));
  const ass = buildAss(plan).text;
  const row = /^Style: Cap,Montserrat ExtraBold,([\d.]+),/m.exec(ass);
  assert.ok(row, 'style row');
  assert.ok(Math.abs(Number(row[1]) - 68 * m.ass_scale) < 0.2, `Fontsize ${row[1]}`);
});

test('body caption themes are 48 to 80 px of em, single words and shouting styles larger', () => {
  const body = ['karaoke-highlight', 'karaoke-pill', 'clean-minimal', 'editorial-serif', 'box-caption', 'mono-terminal'];
  for (const t of body) assert.ok(THEME_STYLES[t].size >= 48 && THEME_STYLES[t].size <= 75, `${t} ${THEME_STYLES[t].size}`);
  assert.ok(THEME_STYLES['bold-stroke'].size >= 75 && THEME_STYLES['bold-stroke'].size <= 90);
  assert.ok(THEME_STYLES['one-word-pop'].size >= 100);
});

test('a four word karaoke line spans 55 to 70 percent of the frame width', () => {
  const lay = layoutCue(THEME_STYLES['karaoke-highlight'], ['figured', 'out', 'how', 'to'], 1100);
  const share = lay.width / 1080;
  assert.ok(share >= 0.5 && share <= 0.72, `share ${share}`);
  assert.equal(lay.size, 68, 'it did not need shrinking');
  assert.ok(Math.abs(lay.fontsize - 68 * loadFontFace(FONT_FILES.montserrat.file).ass_scale) < 0.2);
});

test('the hook card slides up and shrinks to stay 40 px above a high head, and says so when it cannot', () => {
  const withHead = (y) => ({ ...plan, caption_anchor: /** @type {any} */ ({ x: 540, y: 1163, head_top_y: y }) });
  const low = buildAss(withHead(900)).layout.hook;
  assert.ok(low && low.clearance_px !== null && low.clearance_px >= 40, `low head ${low?.clearance_px}`);
  const mid = buildAss(withHead(700)).layout.hook;
  assert.ok(mid && mid.clearance_px !== null && mid.clearance_px >= 40, `mid head ${mid?.clearance_px}`);
  assert.ok(mid.top >= SAFE_ZONE.y_min, 'never above the safe zone');
  const high = buildAss(withHead(330)).layout.hook;
  assert.ok(high && high.clearance_px !== null && high.clearance_px < 40, 'a head this high cannot be cleared');
  const unknown = buildAss({ ...plan, caption_anchor: null }).layout.hook;
  assert.equal(unknown?.clearance_px, null);
});
