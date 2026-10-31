// Transcript, cut and look to a ShotPlan: the one description of the reel that the render is built from.
// Pure and seeded: the same inputs and the same seed always give the same plan, byte for byte.
//
// v1 treatments the ffmpeg path can draw: face, punch-in, hold-wide, text-emphasis, hook-card, cta-end.
// Richer ideas (stat cards, split panels, screen demos, b-roll) are written into the plan as `wanted_treatment`
// and drawn as `rendered_as: "face"` (or the nearest v1 treatment) so a later animated path can pick them up.
import { TREATMENTS } from '../types.mjs';
import { buildBeats } from './beats.mjs';
import { planCamera, ceilingFor, paceFor } from './camera.mjs';
import { buildCaptionCues } from './cues.mjs';
import { selectEmphasis } from './emphasis.mjs';
import { chooseHook } from './hooks.mjs';
import { getLook, densityFor, DEFAULT_LOOK_ID } from './looks.mjs';
import { shapePacing } from './pacing.mjs';
import { wordsOnTimeline } from './roughcut.mjs';
import { planSfx } from './sfxplan.mjs';
import { hashOf, seedToUint } from './util.mjs';

/** The hook text sits on screen this long at the start of the reel. */
export const HOOK_CARD_MS = 2000;
/** Where the hook text goes in the 1080x1920 frame. */
export const HOOK_ZONE = Object.freeze({ y_min: 480, y_max: 820 });

/**
 * @typedef {object} PlanOptions
 * @property {string} [hook_text]       On-screen hook. Used as written; rejected with an error if it breaks a hard rule.
 * @property {number|string} [seed]     Default 1.
 * @property {string} [caption_theme]   Overrides the look's theme.
 * @property {string} [accent]          Overrides the look's accent color, "#RRGGBB".
 * @property {Record<string, Record<string, string|number>>} [slots]  Words for hook shapes, from the host model.
 */

/**
 * Hash of every field of a plan except the hash itself.
 * @param {Omit<import('../types.mjs').ShotPlan, 'hash'> & {hash?: string}} plan
 * @returns {string}
 */
export function hashShotPlan(plan) {
  const { hash: _ignored, ...rest } = plan;
  return hashOf(rest, 16);
}

/**
 * @param {import('../types.mjs').Look|string|undefined} look
 * @param {PlanOptions} options
 * @returns {import('../types.mjs').Look}
 */
function resolveLook(look, options) {
  const overrides = { caption_theme: options.caption_theme, accent: options.accent };
  if (typeof look === 'object' && look !== null) {
    const base = getLook(look.id, {});
    return {
      ...base,
      ...look,
      caption_theme: /** @type {any} */ (overrides.caption_theme ?? look.caption_theme),
      accent: (overrides.accent ?? look.accent).toUpperCase(),
    };
  }
  return getLook(look ?? DEFAULT_LOOK_ID, overrides);
}

/**
 * Give each caption group at most one emphasized word (the strongest).
 * @param {{position:number, score:number, role:string}[]} picks   Positions in the timeline word list.
 * @param {import('./roughcut.mjs').TimelineWord[][]} groups
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 */
function pruneEmphasis(picks, groups, words) {
  const positionOf = new Map(words.map((w, p) => [w.index, p]));
  const keep = new Set(picks.map((p) => p.position));
  for (const g of groups) {
    const inGroup = picks.filter((p) => g.some((w) => positionOf.get(w.index) === p.position));
    if (inGroup.length > 1) {
      inGroup.sort((a, b) => b.score - a.score || a.position - b.position);
      for (const extra of inGroup.slice(1)) keep.delete(extra.position);
    }
  }
  return picks.filter((p) => keep.has(p.position));
}

/**
 * Build the camera, density and sound parts of a plan from its beats. Shared by planShots and editShotPlan.
 * @param {import('../types.mjs').Beat[]} beats
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 * @param {import('../types.mjs').Look} look
 * @param {number} duration_ms
 * @param {number|string} seed
 */
function buildMotion(beats, words, look, duration_ms, seed) {
  const ceiling = ceilingFor(look.camera_aggression);
  const hasHook = beats.length > 0 && beats[0].treatment === 'hook-card';
  const last = beats[beats.length - 1];
  /** @type {number[]} */
  const extra = [];
  if (hasHook) extra.push(0, Math.min(HOOK_CARD_MS, duration_ms));
  if (last && last.treatment === 'cta-end' && last.out_start_ms > 0) extra.push(last.out_start_ms);
  const cadence = { min_ms: look.cut_every_ms_min, max_ms: look.cut_every_ms_max };
  const planned = planCamera(beats, { aggression: look.camera_aggression, seed, cadence_max_ms: cadence.max_ms, duration_ms });
  const shaped = shapePacing(planned, duration_ms, {
    ceiling,
    extra_events_ms: extra,
    density: densityFor(look),
    cadence,
    seed,
  });
  const sfx = planSfx({ beats, camera: shaped.camera, words, duration_ms, look, hook_card: hasHook });
  return { camera: shaped.camera, sfx, pacing: shaped.report, pace: paceFor(cadence.max_ms) };
}

/**
 * Compose the shot plan.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').CutPlan} cut
 * @param {import('../types.mjs').Look|string} look   A look, or a look id.
 * @param {PlanOptions} [options]
 * @returns {import('../types.mjs').ShotPlan}
 */
export function planShots(transcript, cut, look, options = {}) {
  const lk = resolveLook(look, options);
  const seed = seedToUint(options.seed ?? 1);
  const words = wordsOnTimeline(transcript, cut.pieces);
  const duration_ms = cut.after_ms;
  if (words.length === 0 || duration_ms <= 0) throw new Error('There is no speech to plan. Check the transcript and the cut.');

  // Emphasis first, so captions and beats agree on which words are picked out.
  const picks = selectEmphasis(words);
  const { cues, groups } = buildCaptionCues(words, lk.caption_theme);
  const finalPicks = pruneEmphasis(picks, groups, words);
  const emphasisIndexes = finalPicks.map((p) => words[p.position].index);

  const beats = buildBeats(words, { cadence: { min_ms: lk.cut_every_ms_min, max_ms: lk.cut_every_ms_max }, duration_ms });
  for (const beat of beats) {
    beat.emphasis_words = emphasisIndexes.filter((i) => i >= beat.first_word && i <= beat.last_word);
  }

  const spokenText = words.map((w) => w.text).join(' ');
  const hook = chooseHook(spokenText, { hook_text: options.hook_text, seed, slots: options.slots });
  if (hook.text && beats.length > 0) {
    beats[0].treatment = 'hook-card';
    beats[0].screen_text = hook.text;
  }
  const lastBeat = beats[beats.length - 1];
  if (lastBeat && lastBeat.kind === 'cta' && beats.length > 1) lastBeat.treatment = 'cta-end';

  const motion = buildMotion(beats, words, lk, duration_ms, seed);

  // Where a beat has no special treatment, name what the camera actually does.
  for (const beat of beats) {
    if (beat.treatment !== 'face' || beat.wanted_treatment) continue;
    const mid = (beat.out_start_ms + beat.out_end_ms) / 2;
    const move = motion.camera.find((m) => mid >= m.out_start_ms && mid < m.out_end_ms);
    if (move?.kind === 'punch-in') beat.treatment = 'punch-in';
    else if (move?.kind === 'wide' && beat.kind === 'default') beat.treatment = 'hold-wide';
  }

  /** @type {import('../types.mjs').ShotPlan} */
  const plan = {
    look_id: lk.id,
    caption_theme: lk.caption_theme,
    accent: lk.accent,
    seed,
    duration_ms,
    beats,
    captions: cues,
    camera: motion.camera,
    sfx: motion.sfx,
    hook: { text: hook.text, formula: hook.formula, score: hook.score, source: hook.source, candidates: hook.candidates },
    caption_anchor: null,
    hash: '',
  };
  plan.hash = hashShotPlan(plan);
  return plan;
}

/**
 * @typedef {object} PlanEdits
 * @property {{id: string, treatment?: string, screen_text?: string}[]} [beats]
 * @property {string} [hook_text]
 */

/**
 * Apply the person's edits from the shot plan card, then rebuild the camera and sound from the new beats.
 * The speech, captions and emphasis are not touched.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').CutPlan} cut
 * @param {import('../types.mjs').ShotPlan} plan
 * @param {PlanEdits} edits
 * @returns {import('../types.mjs').ShotPlan}
 */
export function editShotPlan(transcript, cut, plan, edits) {
  const lk = getLook(plan.look_id, { caption_theme: plan.caption_theme, accent: plan.accent });
  const words = wordsOnTimeline(transcript, cut.pieces);
  const beats = plan.beats.map((b) => ({ ...b, emphasis_words: [...b.emphasis_words] }));
  for (const e of edits.beats ?? []) {
    const idx = beats.findIndex((b) => b.id === e.id);
    if (idx < 0) throw new Error(`There is no beat "${e.id}" in this plan.`);
    if (e.treatment !== undefined) {
      if (!TREATMENTS.includes(/** @type {any} */ (e.treatment))) throw new Error(`Unknown treatment "${e.treatment}". Use one of: ${TREATMENTS.join(', ')}.`);
      if (e.treatment === 'hook-card' && idx !== 0) throw new Error('Only the first beat can be the hook card.');
      if (e.treatment === 'cta-end' && idx !== beats.length - 1) throw new Error('Only the last beat can be the closing prompt.');
      beats[idx].treatment = /** @type {any} */ (e.treatment);
      if (beats[idx].wanted_treatment) beats[idx].rendered_as = e.treatment;
    }
    if (e.screen_text !== undefined) {
      const text = String(e.screen_text).trim();
      if (text === '') delete beats[idx].screen_text;
      else beats[idx].screen_text = text;
    }
  }
  let hook = plan.hook;
  if (edits.hook_text !== undefined) {
    const spokenText = words.map((w) => w.text).join(' ');
    const chosen = chooseHook(spokenText, { hook_text: edits.hook_text, seed: plan.seed });
    hook = { text: chosen.text, formula: chosen.formula, score: chosen.score, source: chosen.source, candidates: chosen.candidates };
    if (beats.length > 0) {
      beats[0].treatment = 'hook-card';
      beats[0].screen_text = hook.text;
    }
  }
  const motion = buildMotion(beats, words, lk, plan.duration_ms, plan.seed);
  /** @type {import('../types.mjs').ShotPlan} */
  const next = { ...plan, beats, hook, camera: motion.camera, sfx: motion.sfx, hash: '' };
  next.hash = hashShotPlan(next);
  return next;
}
