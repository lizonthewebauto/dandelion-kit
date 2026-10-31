// Pacing: how often something new happens on screen. Three jobs:
//   1. numbers (cut length bands, the pacing arc, the density limits),
//   2. analysis (find the visual changes, the long quiet stretches and the busiest 10 seconds),
//   3. two passes that fix a camera plan: a density governor and a cut-the-curve pass for long quiet gaps.
// Visual changes come from camera moves and from fixed events such as hook text. Cuts in speech are not counted
// here because the camera plan flips the framing at them. Pure functions.
import { splitMoveAt, mergeMoveInto, zoomAt, paceFor, ZOOM_EVENT_MIN_RISE } from './camera.mjs';
import { clamp, makeRng } from './util.mjs';

/** Seconds between visual changes, by app (min and max, in ms). */
export const CUT_LENGTH_BANDS = Object.freeze({
  tiktok: Object.freeze({ min_ms: 1500, max_ms: 3000 }),
  'instagram-reels': Object.freeze({ min_ms: 2500, max_ms: 4000 }),
  'youtube-shorts': Object.freeze({ min_ms: 3000, max_ms: 5000 }),
});

/** Visual changes in any rolling 10 seconds: at least 4, aim for 6, at most 8, never closer than 0.8 s. */
export const DENSITY_GOVERNOR = Object.freeze({
  window_ms: 10000,
  min: 4,
  target: 6,
  max: 8,
  min_gap_ms: 800,
  max_overlays: 2,
});

/** Open a small loop or change the picture every 5 to 10 seconds. */
export const REHOOK_INTERVAL_MS = Object.freeze({ min: 5000, max: 10000 });

/** Longest quiet stretch, with a tighter limit for the opening where people decide to stay. */
export const DEFAULT_PACING = Object.freeze({
  max_gap_ms: 3000,
  opening_gap_ms: 2000,
  opening_window_ms: 3000,
  zoom_event_min_rise: ZOOM_EVENT_MIN_RISE,
});

/**
 * Busier at the start, a little calmer in the middle, busier again toward the end.
 * @param {number} progress  0 to 1 through the reel.
 * @returns {number}
 */
export function pacingArcMultiplier(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Pacing arc progress must be between 0 and 1.');
  if (progress < 0.15) return 1.25;
  if (progress < 0.7) return 0.9;
  return 1.15;
}

/**
 * How long a beat may hold before something must change, at a point in the reel.
 * @param {{platform?: keyof typeof CUT_LENGTH_BANDS, progress?: number, base?: {min_ms:number,max_ms:number}}} [options]
 *   `base` (a look's own cadence) wins over the app band.
 * @returns {{min_ms:number, max_ms:number}}
 */
export function cadenceBudget(options = {}) {
  const band = options.base ?? CUT_LENGTH_BANDS[options.platform ?? 'instagram-reels'] ?? CUT_LENGTH_BANDS['instagram-reels'];
  const mult = pacingArcMultiplier(options.progress ?? 0.5);
  return { min_ms: Math.round(band.min_ms / mult), max_ms: Math.round(band.max_ms / mult) };
}

/**
 * Times (in ms) where something new appears on screen: the start, fixed events, and every camera move that
 * pushes in or steps back by at least `min_rise`.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number[]} [extra_events_ms]  Fixed events such as hook text or an on-screen label.
 * @param {number} [min_rise]
 * @returns {number[]}
 */
export function visualEvents(camera, extra_events_ms = [], min_rise = DEFAULT_PACING.zoom_event_min_rise) {
  const events = new Set([0, ...extra_events_ms.map((t) => Math.round(t))]);
  for (const i of cameraEventIndexes(camera, min_rise)) events.add(camera[i].out_start_ms);
  return [...events].sort((a, b) => a - b);
}

/**
 * Index of every camera move that begins with a visual change.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} [min_rise]
 * @returns {number[]}
 */
export function cameraEventIndexes(camera, min_rise = DEFAULT_PACING.zoom_event_min_rise) {
  /** @type {number[]} */
  const out = [];
  for (let i = 1; i < camera.length; i += 1) {
    const prev = camera[i - 1];
    const cur = camera[i];
    const step = Math.abs(cur.zoom_from - zoomAt(prev, prev.out_end_ms)) >= min_rise - 1e-9;
    const rise = cur.kind !== 'creep' && cur.zoom_to - cur.zoom_from >= min_rise - 1e-9;
    if (step || rise) out.push(i);
  }
  return out;
}

/**
 * Bounds for the count in one window. A reel shorter than the window scales them down.
 * @param {number} duration_ms
 * @param {{window_ms:number, min:number, max:number}} limits
 */
export function densityBounds(duration_ms, limits) {
  if (duration_ms >= limits.window_ms) return { lo: limits.min, hi: limits.max };
  const f = duration_ms / limits.window_ms;
  return { lo: Math.floor(limits.min * f), hi: Math.max(1, Math.ceil(limits.max * f)) };
}

/**
 * Count of events in every rolling window.
 * @param {number[]} events
 * @param {number} duration_ms
 * @param {number} [window_ms]
 * @param {number} [step_ms]
 * @returns {{start_ms:number, count:number}[]}
 */
export function windowCounts(events, duration_ms, window_ms = DENSITY_GOVERNOR.window_ms, step_ms = 250) {
  /** @type {number[]} */
  const starts = [];
  const last = Math.max(0, duration_ms - window_ms);
  for (let s = 0; s < last; s += step_ms) starts.push(s);
  starts.push(last);
  return starts.map((start_ms) => ({
    start_ms,
    count: events.filter((e) => e >= start_ms && e < start_ms + window_ms).length,
  }));
}

/**
 * Check that every rolling window stays inside the limits.
 * @param {number[]} events
 * @param {number} duration_ms
 * @param {Partial<typeof DENSITY_GOVERNOR>} [limits]
 */
export function checkDensity(events, duration_ms, limits = {}) {
  const l = { ...DENSITY_GOVERNOR, ...limits };
  const { lo, hi } = densityBounds(duration_ms, l);
  const windows = windowCounts(events, duration_ms, l.window_ms);
  const counts = windows.map((w) => w.count);
  const violations = windows.filter((w) => w.count < lo || w.count > hi);
  let min_gap_ok = true;
  for (let i = 1; i < events.length; i += 1) if (events[i] - events[i - 1] < l.min_gap_ms) min_gap_ok = false;
  return {
    ok: violations.length === 0,
    min_seen: Math.min(...counts),
    max_seen: Math.max(...counts),
    lo,
    hi,
    violations,
    min_gap_ok,
  };
}

/**
 * Plain numbers about the pacing of a plan.
 * @param {{camera: import('../types.mjs').CameraMove[], duration_ms: number, extra_events_ms?: number[]}} plan
 * @param {Partial<typeof DEFAULT_PACING>} [options]
 */
export function analyzePacing(plan, options = {}) {
  const o = { ...DEFAULT_PACING, ...options };
  const events = visualEvents(plan.camera, plan.extra_events_ms ?? [], o.zoom_event_min_rise).filter((t) => t <= plan.duration_ms);
  const edges = events[events.length - 1] === plan.duration_ms ? events : [...events, plan.duration_ms];
  /** @type {{from_ms:number,to_ms:number,length_ms:number}[]} */
  const gaps = [];
  let maxGap = 0;
  for (let i = 1; i < edges.length; i += 1) {
    const length = edges[i] - edges[i - 1];
    maxGap = Math.max(maxGap, length);
    const limit = edges[i - 1] < o.opening_window_ms ? o.opening_gap_ms : o.max_gap_ms;
    if (length > limit) gaps.push({ from_ms: edges[i - 1], to_ms: edges[i], length_ms: length });
  }
  const density = checkDensity(events, plan.duration_ms);
  return {
    duration_ms: plan.duration_ms,
    events,
    event_count: events.length,
    max_gap_ms: maxGap,
    gaps_over_limit: gaps,
    events_per_10s: plan.duration_ms > 0 ? Math.round((events.length / plan.duration_ms) * 10000 * 10) / 10 : 0,
    density,
  };
}

// ---------------------------------------------------------------------------
// The two passes
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PassContext
 * @property {number} ceiling                   Camera ceiling for punch-ins.
 * @property {number[]} [extra_events_ms]       Fixed events.
 * @property {Partial<typeof DENSITY_GOVERNOR>} [limits]
 * @property {{min_ms:number,max_ms:number}} [cadence]
 * @property {number|string} [seed]
 * @property {Partial<typeof DEFAULT_PACING>} [pacing]
 * @property {{min:number,target:number,max:number}} [density]   A look's own density (inside the governor limits).
 */

/**
 * Would one more event at t keep every window that contains it at or under the maximum?
 * @param {number[]} events
 * @param {number} t
 * @param {number} duration_ms
 * @param {{window_ms:number}} l
 * @param {number} hi
 */
function fitsUnderMax(events, t, duration_ms, l, hi) {
  const from = Math.max(0, t - l.window_ms + 1);
  const to = Math.min(t, Math.max(0, duration_ms - l.window_ms));
  for (let s = from; s <= to; s += 250) {
    const count = events.filter((e) => e >= s && e < s + l.window_ms).length;
    if (count + 1 > hi) return false;
  }
  return true;
}

/**
 * Try to add one visual change near t. Returns the new camera plan or null.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} t
 * @param {number} duration_ms
 * @param {PassContext} ctx
 * @param {() => number} rng
 * @param {number} pace
 * @param {number} hi
 */
function tryInsert(camera, t, duration_ms, ctx, rng, pace, hi) {
  const l = { ...DENSITY_GOVERNOR, ...ctx.limits };
  for (const nudge of [0, -300, 300, -600, 600, -900, 900]) {
    const at = Math.round(t + nudge);
    const events = visualEvents(camera, ctx.extra_events_ms ?? []);
    if (events.some((e) => Math.abs(e - at) < l.min_gap_ms)) continue;
    if (!fitsUnderMax(events, at, duration_ms, l, hi)) continue;
    const next = splitMoveAt(camera, at, { rng, ceiling: ctx.ceiling, pace });
    if (next) return { camera: next, at };
  }
  return null;
}

/**
 * Cut-the-curve pass: find stretches with no visual change that are longer than the limit and add a punch-in
 * (or a pull back) inside them until nothing is left too long.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} duration_ms
 * @param {PassContext} ctx
 * @returns {{camera: import('../types.mjs').CameraMove[], added_ms: number[], unresolved: {from_ms:number,to_ms:number,length_ms:number}[]}}
 */
export function applyPacingPass(camera, duration_ms, ctx) {
  const o = { ...DEFAULT_PACING, ...ctx.pacing };
  const l = { ...DENSITY_GOVERNOR, ...ctx.limits };
  const { hi } = densityBounds(duration_ms, l);
  const rng = makeRng(`pacing:${ctx.seed ?? 1}`);
  const pace = paceFor(ctx.cadence?.max_ms ?? 3000);
  let cam = camera;
  /** @type {number[]} */
  const added = [];
  for (let round = 0; round < 6; round += 1) {
    const report = analyzePacing({ camera: cam, duration_ms, extra_events_ms: ctx.extra_events_ms }, o);
    if (report.gaps_over_limit.length === 0) break;
    let progress = false;
    for (const gap of report.gaps_over_limit) {
      const limit = gap.from_ms < o.opening_window_ms ? o.opening_gap_ms : o.max_gap_ms;
      const inserts = Math.max(1, Math.ceil(gap.length_ms / limit) - 1);
      for (let k = 1; k <= inserts; k += 1) {
        const ideal = gap.from_ms + (gap.length_ms * k) / (inserts + 1);
        const r = tryInsert(cam, ideal, duration_ms, ctx, rng, pace, hi);
        if (r) {
          cam = r.camera;
          added.push(r.at);
          progress = true;
        }
      }
    }
    if (!progress) break;
  }
  const after = analyzePacing({ camera: cam, duration_ms, extra_events_ms: ctx.extra_events_ms }, o);
  return { camera: cam, added_ms: added.sort((a, b) => a - b), unresolved: after.gaps_over_limit };
}

/**
 * Density governor: keep the number of visual changes in every rolling 10 seconds between the minimum and the
 * maximum, never closer than the minimum gap, and aim for the look's own target (shaped by the pacing arc).
 * Changes are made on the camera plan only. Fixed events and the start are never touched.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} duration_ms
 * @param {PassContext} ctx
 * @returns {{camera: import('../types.mjs').CameraMove[], removed_ms: number[], added_ms: number[], stuck_ms: number[]}}
 */
export function governDensity(camera, duration_ms, ctx) {
  const l = { ...DENSITY_GOVERNOR, ...ctx.limits };
  const { lo, hi } = densityBounds(duration_ms, l);
  const dens = ctx.density ?? { min: l.min, target: l.target, max: l.max };
  const extra = ctx.extra_events_ms ?? [];
  const rng = makeRng(`density:${ctx.seed ?? 1}`);
  const pace = paceFor(ctx.cadence?.max_ms ?? 3000);
  let cam = camera;
  /** @type {number[]} */
  const removed = [];
  /** @type {number[]} */
  const added = [];
  /** @type {Set<number>} */
  const stuck = new Set();

  /** Merge away the camera event at move `idx`. */
  const mergeAt = (/** @type {number} */ idx) => {
    removed.push(cam[idx].out_start_ms);
    cam = mergeMoveInto(cam, idx, ctx.ceiling);
  };

  for (let guard = 0; guard < 400; guard += 1) {
    const events = visualEvents(cam, extra);
    const camIdx = cameraEventIndexes(cam);

    // A. Two changes closer than the minimum gap: the camera one goes.
    let acted = false;
    for (const idx of camIdx) {
      const t = cam[idx].out_start_ms;
      const before = events.filter((e) => e < t).pop();
      if (before !== undefined && t - before < l.min_gap_ms) {
        mergeAt(idx);
        acted = true;
        break;
      }
    }
    if (acted) continue;

    // B. Any window over the maximum: drop the camera change that sits closest to its neighbour.
    const windows = windowCounts(events, duration_ms, l.window_ms);
    const over = windows.find((w) => w.count > hi && !stuck.has(w.start_ms));
    if (over) {
      const inside = camIdx.filter((i) => cam[i].out_start_ms >= over.start_ms && cam[i].out_start_ms < over.start_ms + l.window_ms);
      if (inside.length === 0) {
        stuck.add(over.start_ms);
        continue;
      }
      const gapTo = (/** @type {number} */ i) => {
        const t = cam[i].out_start_ms;
        const before = events.filter((e) => e < t).pop() ?? 0;
        return t - before;
      };
      inside.sort((a, b) => gapTo(a) - gapTo(b) || a - b);
      mergeAt(inside[0]);
      continue;
    }

    // C. Any window under the target (the minimum at the least): add a change in its widest gap.
    const lowWin = windows.find((w) => {
      if (stuck.has(-w.start_ms - 1)) return false;
      const mult = pacingArcMultiplier(clamp((w.start_ms + l.window_ms / 2) / Math.max(1, duration_ms), 0, 1));
      const want = clamp(Math.round(dens.target * mult), Math.max(lo, dens.min), Math.min(hi, dens.max));
      return w.count < Math.max(lo, duration_ms >= l.window_ms ? want : lo);
    });
    if (lowWin) {
      const end = Math.min(lowWin.start_ms + l.window_ms, duration_ms);
      const pts = [lowWin.start_ms, ...events.filter((e) => e > lowWin.start_ms && e < end), end];
      let best = { len: -1, mid: 0 };
      for (let i = 1; i < pts.length; i += 1) {
        const len = pts[i] - pts[i - 1];
        if (len > best.len) best = { len, mid: pts[i - 1] + len / 2 };
      }
      const r = tryInsert(cam, best.mid, duration_ms, ctx, rng, pace, hi);
      if (r) {
        cam = r.camera;
        added.push(r.at);
        continue;
      }
      stuck.add(-lowWin.start_ms - 1);
      continue;
    }
    break;
  }
  return { camera: cam, removed_ms: removed.sort((a, b) => a - b), added_ms: added.sort((a, b) => a - b), stuck_ms: [...stuck].sort((a, b) => a - b) };
}

/**
 * Run the governor and the cut-the-curve pass until the plan is steady.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @param {number} duration_ms
 * @param {PassContext} ctx
 */
export function shapePacing(camera, duration_ms, ctx) {
  let cam = camera;
  /** @type {number[]} */
  const added = [];
  /** @type {number[]} */
  const removed = [];
  for (let round = 0; round < 4; round += 1) {
    const g = governDensity(cam, duration_ms, ctx);
    const p = applyPacingPass(g.camera, duration_ms, ctx);
    cam = p.camera;
    added.push(...g.added_ms, ...p.added_ms);
    removed.push(...g.removed_ms);
    if (g.added_ms.length + g.removed_ms.length + p.added_ms.length === 0) break;
  }
  const report = analyzePacing({ camera: cam, duration_ms, extra_events_ms: ctx.extra_events_ms }, ctx.pacing);
  return { camera: cam, added_ms: added.sort((a, b) => a - b), removed_ms: removed.sort((a, b) => a - b), report };
}
