// Camera plan: when the picture pushes in, eases out or holds wide. Plain zoom factors, seeded so the same
// inputs give the same moves. The render path turns each move into a crop and scale.
//
// How a move reads on screen:
//   wide        stays at zoom 1
//   punch-in    jumps from zoom_from to zoom_to in the first PUNCH_RISE_MS, then holds
//   micro-punch the same, with a small rise (1.03)
//   creep       a slow push, linear from zoom_from to zoom_to across the whole move
import { clamp, makeRng, roundMs, roundZoom } from './util.mjs';

/** Time a punch-in or micro-punch takes to reach its zoom. */
export const PUNCH_RISE_MS = 300;
export const MICRO_PUNCH_ZOOM = 1.03;
/** Slow push per second of a creep move, and the shortest beat that earns one. */
export const CREEP_PER_SECOND = 0.011;
export const CREEP_MIN_MS = 3200;
/** No move may zoom past this (the picture starts to look soft). */
export const ZOOM_HARD_MAX = 1.25;
/** A punch-in is never smaller than this (below it the move is not seen as a change). */
export const PUNCH_MIN_ZOOM = 1.05;
export const MAX_CONSECUTIVE_REPEATS = 2;
/** A zoom change of at least this much counts as a visual change. */
export const ZOOM_EVENT_MIN_RISE = 0.04;

/** How far each level of energy may push in. */
export const CAMERA_AGGRESSION = Object.freeze({
  calm: Object.freeze({ ceiling: 1.08 }),
  standard: Object.freeze({ ceiling: 1.12 }),
  bold: Object.freeze({ ceiling: 1.2 }),
  chaos: Object.freeze({ ceiling: ZOOM_HARD_MAX }),
});

/** What to try instead when a kind would repeat too many times. */
const ALTERNATES = Object.freeze({
  'punch-in': ['micro-punch', 'wide', 'creep'],
  'micro-punch': ['punch-in', 'wide', 'creep'],
  creep: ['micro-punch', 'wide', 'punch-in'],
  wide: ['micro-punch', 'punch-in', 'creep'],
});

/** @param {'calm'|'standard'|'bold'|'chaos'} aggression */
export function ceilingFor(aggression) {
  const level = CAMERA_AGGRESSION[aggression];
  if (!level) throw new Error(`Unknown camera aggression: ${String(aggression)}. Use calm, standard, bold or chaos.`);
  return level.ceiling;
}

/**
 * Zoom at the end of a move.
 * @param {import('../types.mjs').CameraMove} move
 */
export const endZoom = (move) => move.zoom_to;

/**
 * Zoom of a move at a given time (the render path uses the same shape).
 * @param {import('../types.mjs').CameraMove} move
 * @param {number} t_ms
 */
export function zoomAt(move, t_ms) {
  if (move.kind === 'wide') return move.zoom_from;
  if (move.kind === 'creep') {
    const span = Math.max(1, move.out_end_ms - move.out_start_ms);
    const f = clamp((t_ms - move.out_start_ms) / span, 0, 1);
    return roundZoom(move.zoom_from + (move.zoom_to - move.zoom_from) * f);
  }
  const f = clamp((t_ms - move.out_start_ms) / PUNCH_RISE_MS, 0, 1);
  return roundZoom(move.zoom_from + (move.zoom_to - move.zoom_from) * f);
}

/**
 * Build one move of a kind.
 * @param {'wide'|'punch-in'|'micro-punch'|'creep'} kind
 * @param {number} start
 * @param {number} end
 * @param {{amplitude: number, ceiling: number, creepCap?: number}} ctx
 * @returns {import('../types.mjs').CameraMove}
 */
export function makeMove(kind, start, end, ctx) {
  const span = end - start;
  if (kind === 'punch-in') {
    return { out_start_ms: start, out_end_ms: end, kind, zoom_from: 1, zoom_to: roundZoom(clamp(ctx.amplitude, PUNCH_MIN_ZOOM, ctx.ceiling)) };
  }
  if (kind === 'micro-punch') {
    return { out_start_ms: start, out_end_ms: end, kind, zoom_from: 1, zoom_to: MICRO_PUNCH_ZOOM };
  }
  if (kind === 'creep') {
    const cap = Math.min(ctx.creepCap ?? ctx.ceiling, ctx.ceiling);
    const to = roundZoom(clamp(1 + (CREEP_PER_SECOND * span) / 1000, 1, cap));
    return { out_start_ms: start, out_end_ms: end, kind, zoom_from: 1, zoom_to: to };
  }
  return { out_start_ms: start, out_end_ms: end, kind: 'wide', zoom_from: 1, zoom_to: 1 };
}

/**
 * How big a punch-in is for this reel. A slower look (longer cuts) pushes in a little less.
 * @param {number} pace
 * @param {() => number} rng
 * @param {number} ceiling
 */
export function punchAmplitude(pace, rng, ceiling) {
  const jitter = (rng() - 0.5) * 0.02;
  return roundZoom(clamp(1 + (ceiling - 1) * 0.55 * pace + jitter, PUNCH_MIN_ZOOM, ceiling));
}

/**
 * How fast the look cuts, as a multiplier. Longer cuts give a smaller number.
 * @param {number} cadence_max_ms
 */
export const paceFor = (cadence_max_ms) => clamp(2400 / Math.max(1, cadence_max_ms), 0.6, 1.6);

/**
 * What a beat wants from the camera, before the repeat rule is applied.
 * @param {import('../types.mjs').Beat} beat
 * @param {number} index
 * @param {number} count
 * @param {() => number} rng
 * @returns {'wide'|'punch-in'|'micro-punch'|'creep'}
 */
function preferredKind(beat, index, count, rng) {
  const span = beat.out_end_ms - beat.out_start_ms;
  if (beat.kind === 'emotional') return span >= CREEP_MIN_MS ? 'creep' : 'micro-punch';
  if (beat.treatment === 'cta-end' || (index === count - 1 && count > 2)) return 'wide';
  if (index === 0 || beat.treatment === 'hook-card') return 'punch-in';
  if (beat.treatment === 'hold-wide') return 'wide';
  if (
    beat.treatment === 'text-emphasis' ||
    beat.treatment === 'punch-in' ||
    beat.emphasis_words.length > 0 ||
    beat.kind === 'question' ||
    beat.kind === 'number-stat' ||
    beat.kind === 'claim'
  ) {
    return 'punch-in';
  }
  if (span >= CREEP_MIN_MS) return 'creep';
  return rng() < 0.5 ? 'micro-punch' : 'wide';
}

/**
 * Plan a camera move for every beat. The moves cover the whole timeline with no gaps.
 * @param {import('../types.mjs').Beat[]} beats
 * @param {{aggression?: 'calm'|'standard'|'bold'|'chaos', seed?: number|string, cadence_max_ms?: number, duration_ms?: number}} [options]
 * @returns {import('../types.mjs').CameraMove[]}
 */
export function planCamera(beats, options = {}) {
  if (beats.length === 0) return [];
  const aggression = options.aggression ?? 'standard';
  const ceiling = ceilingFor(aggression);
  const rng = makeRng(`camera:${options.seed ?? 1}`);
  const pace = paceFor(options.cadence_max_ms ?? 3000);
  /** @type {import('../types.mjs').CameraMove[]} */
  const moves = [];
  beats.forEach((beat, i) => {
    const start = i === 0 ? 0 : moves[i - 1].out_end_ms;
    const end = i === beats.length - 1 ? Math.max(options.duration_ms ?? 0, beat.out_end_ms) : beat.out_end_ms;
    let kind = preferredKind(beat, i, beats.length, rng);
    const recent = moves.slice(-MAX_CONSECUTIVE_REPEATS);
    if (recent.length === MAX_CONSECUTIVE_REPEATS && recent.every((m) => m.kind === kind)) {
      const alts = ALTERNATES[kind];
      kind = /** @type {typeof kind} */ (alts[Math.floor(rng() * alts.length)]);
    }
    const emotional = beat.kind === 'emotional';
    moves.push(
      makeMove(kind, start, end, {
        amplitude: punchAmplitude(pace, rng, ceiling),
        ceiling,
        creepCap: emotional ? 1.04 : undefined,
      }),
    );
  });
  return moves;
}

/**
 * Split the move that contains t_ms in two. The second half is the other kind of framing: a pull back when the
 * first half ended pushed in, a punch-in when it ended wide. This always adds a visual change at t_ms (the move
 * after it may lose its own, because it now follows a different framing).
 * Returns null when t_ms is too close to an edge of the move.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} t_ms
 * @param {{rng: () => number, ceiling: number, pace?: number, edge_ms?: number}} ctx
 * @returns {import('../types.mjs').CameraMove[]|null}
 */
export function splitMoveAt(camera, t_ms, ctx) {
  const edge = ctx.edge_ms ?? 400;
  const at = roundMs(t_ms);
  const i = camera.findIndex((m) => at > m.out_start_ms + edge && at < m.out_end_ms - edge);
  if (i < 0) return null;
  const m = camera[i];
  const first = { ...m, out_end_ms: at };
  if (m.kind === 'creep') {
    const f = (at - m.out_start_ms) / (m.out_end_ms - m.out_start_ms);
    first.zoom_to = roundZoom(m.zoom_from + (m.zoom_to - m.zoom_from) * f);
  }
  const pushedIn = zoomAt(first, at) - 1 >= ZOOM_EVENT_MIN_RISE - 0.0001;
  const second = pushedIn
    ? makeMove('wide', at, m.out_end_ms, { amplitude: 1, ceiling: ctx.ceiling })
    : makeMove('punch-in', at, m.out_end_ms, { amplitude: punchAmplitude(ctx.pace ?? 1, ctx.rng, ctx.ceiling), ceiling: ctx.ceiling });
  return [...camera.slice(0, i), first, second, ...camera.slice(i + 1)];
}

/**
 * Remove the visual change at the start of move number `index` by letting the move before it run on.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} index
 * @param {number} ceiling
 * @returns {import('../types.mjs').CameraMove[]}
 */
export function mergeMoveInto(camera, index, ceiling) {
  if (index < 1 || index >= camera.length) return camera;
  const prev = camera[index - 1];
  const cur = camera[index];
  let merged = { ...prev, out_end_ms: cur.out_end_ms };
  if (prev.kind === 'creep') merged = makeMove('creep', prev.out_start_ms, cur.out_end_ms, { amplitude: 1, ceiling });
  return [...camera.slice(0, index - 1), merged, ...camera.slice(index + 1)];
}

/**
 * Check a camera plan against the rules. Returns plain sentences for every problem found.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {{ceiling?: number, duration_ms?: number, check_repeats?: boolean}} [options]
 * @returns {string[]}
 */
export function validateCamera(camera, options = {}) {
  const problems = [];
  const ceiling = options.ceiling ?? ZOOM_HARD_MAX;
  let repeats = 1;
  camera.forEach((m, i) => {
    if (m.out_end_ms <= m.out_start_ms) problems.push(`Move ${i + 1} has no length.`);
    if (i > 0 && m.out_start_ms !== camera[i - 1].out_end_ms) problems.push(`Move ${i + 1} does not start where the last one ends.`);
    for (const z of [m.zoom_from, m.zoom_to]) {
      if (z < 1 || z > Math.min(ceiling, ZOOM_HARD_MAX) + 1e-9) problems.push(`Move ${i + 1} zooms to ${z}, outside 1 to ${ceiling}.`);
    }
    if (i > 0 && options.check_repeats !== false) {
      repeats = m.kind === camera[i - 1].kind ? repeats + 1 : 1;
      if (repeats > MAX_CONSECUTIVE_REPEATS) problems.push(`Move ${i + 1} repeats ${m.kind} more than ${MAX_CONSECUTIVE_REPEATS} times in a row.`);
    }
  });
  if (options.duration_ms !== undefined && camera.length > 0 && camera[camera.length - 1].out_end_ms !== options.duration_ms) {
    problems.push('The moves do not end at the end of the reel.');
  }
  return problems;
}
