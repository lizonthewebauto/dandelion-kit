// Variants: the same speech, built differently. Four things can change (the axes):
//   hook_text      a different hook line (from another hook formula)
//   opening        hook card on screen, or a cold open on the spoken line
//   caption_theme  how the words look
//   pace           how often the picture changes (gentle, standard, punchy)
// The speech is never reordered or retimed: every variant uses the same rough cut. Any two variants (and the
// original plan) differ on at least two axes, so they are real choices to test and not the same edit twice.
import { getLook } from '../edit/looks.mjs';
import { hashShotPlan, planShots } from '../edit/shotplan.mjs';
import { requireProject, updateProject, ProjectError } from '../../server/store/project.mjs';
import { anchorForPlan } from './facezone.mjs';
import { overallProgress } from './progress.mjs';
import { renderPlan } from './render.mjs';

export const VARIANT_AXES = Object.freeze(['hook_text', 'opening', 'caption_theme', 'pace']);

/** How much each pace stretches the time between visual changes. */
export const PACE_FACTOR = Object.freeze({ gentle: 1.4, standard: 1, punchy: 0.7 });

/** Caption themes in the order variants try them: the ones that look most different from each other come first. */
const THEME_ORDER = Object.freeze([
  'one-word-pop',
  'clean-minimal',
  'bold-stroke',
  'box-caption',
  'editorial-serif',
  'karaoke-pill',
  'mono-terminal',
  'karaoke-highlight',
]);

/**
 * @typedef {import('../types.mjs').Variant['axes']} Axes
 */

/**
 * Which axes differ between two sets of choices. When both open cold, the hook line is not shown, so it does not count.
 * @param {Axes} a
 * @param {Axes} b
 * @returns {string[]}
 */
export function axesDiffer(a, b) {
  /** @type {string[]} */
  const out = [];
  const showsHook = a.opening === 'hook-card' || b.opening === 'hook-card';
  if (showsHook && a.hook_text !== b.hook_text) out.push('hook_text');
  if (a.opening !== b.opening) out.push('opening');
  if (a.caption_theme !== b.caption_theme) out.push('caption_theme');
  if (a.pace !== b.pace) out.push('pace');
  return out;
}

/**
 * The axes of the plan as it stands.
 * @param {import('../types.mjs').ShotPlan} plan
 * @returns {Axes}
 */
export function axesOf(plan) {
  const first = plan.beats[0];
  const card = first?.treatment === 'hook-card';
  return {
    hook_text: card ? (first.screen_text ?? plan.hook.text) : plan.hook.text,
    opening: card ? 'hook-card' : 'cold-open',
    caption_theme: plan.caption_theme,
    pace: 'standard',
  };
}

/**
 * Pick `count` sets of choices that differ from the plan and from each other on at least two axes. Deterministic.
 * @param {import('../types.mjs').ShotPlan} plan
 * @param {number} count
 * @returns {Axes[]}
 */
export function planVariantAxes(plan, count) {
  const base = axesOf(plan);
  const hooks = [...new Set([base.hook_text, ...plan.hook.candidates.map((c) => c.text)])].filter(Boolean);
  const themes = [...THEME_ORDER.filter((t) => t !== base.caption_theme), base.caption_theme];
  const paces = /** @type {const} */ (['punchy', 'gentle', 'standard']);
  /** @type {Axes[]} */
  const all = [];
  for (const opening of /** @type {const} */ (['cold-open', 'hook-card'])) {
    for (const pace of paces) {
      for (const caption_theme of themes) {
        // A cold open shows no hook line, so only one hook choice is worth trying.
        for (const hook_text of opening === 'cold-open' ? [base.hook_text] : hooks)
          all.push({ hook_text, opening, caption_theme, pace });
      }
    }
  }
  /** @type {Axes[]} */
  const chosen = [];
  const taken = [base];
  for (let n = 0; n < count; n++) {
    /** @type {Axes | null} */
    let best = null;
    let bestScore = -1;
    for (const cand of all) {
      const dists = taken.map((t) => axesDiffer(cand, t).length);
      if (Math.min(...dists) < 2) continue;
      const score = Math.min(...dists) * 100 + dists.reduce((x, y) => x + y, 0);
      if (score > bestScore) {
        best = cand;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    taken.push(best);
  }
  return chosen;
}

/**
 * Build one variant's shot plan from the base plan.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').CutPlan} cut
 * @param {import('../types.mjs').ShotPlan} base
 * @param {Axes} axes
 * @returns {import('../types.mjs').ShotPlan}
 */
export function buildVariantPlan(transcript, cut, base, axes) {
  const look = getLook(base.look_id, { accent: base.accent });
  const k = PACE_FACTOR[axes.pace];
  const paced = {
    ...look,
    cut_every_ms_min: Math.round(look.cut_every_ms_min * k),
    cut_every_ms_max: Math.round(look.cut_every_ms_max * k),
    density_per_10s: look.density_per_10s
      ? {
          min: look.density_per_10s.min,
          target: Math.max(look.density_per_10s.min, Math.round(look.density_per_10s.target / k)),
          max: look.density_per_10s.max,
        }
      : undefined,
  };
  const plan = planShots(transcript, cut, paced, {
    hook_text: axes.hook_text,
    seed: base.seed,
    caption_theme: axes.caption_theme,
    accent: base.accent,
  });
  if (axes.opening === 'cold-open' && plan.beats[0]?.treatment === 'hook-card') {
    // Open on the spoken line: no text card, and no entrance sound for it.
    const first = plan.beats[0];
    first.treatment = 'punch-in';
    delete first.screen_text;
    plan.sfx = plan.sfx.filter((c) => c.out_ms > 250);
  }
  plan.caption_anchor = base.caption_anchor ?? null;
  plan.hash = hashShotPlan(plan);
  return plan;
}

/**
 * Make `count` variants as final renders and record them on the project.
 * Each result carries `plan_diff`: what changed from the original plan.
 * @param {object} input
 * @param {string} input.projectId
 * @param {number} [input.count]       2 to 4. Default 2.
 * @param {(stage: string, fraction: number, message?: string) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<(import('../types.mjs').RenderResult & {plan_diff: {changed: string[], from: Axes, to: Axes}})[]>}
 */
export async function makeVariants({ projectId, count = 2, onProgress, signal }) {
  const n = Math.max(2, Math.min(4, Math.round(count)));
  const project = await requireProject(projectId);
  if (!project.shot_plan || !project.cut || !project.transcript)
    throw new ProjectError('Variants need a rough cut and a shot plan first.');
  // Progress goes out as one number for the whole run (0 to 1), so a bar only goes up.
  /** @param {number} i @param {string} stage @param {number} f @param {string} [msg] */
  const report = (i, stage, f, msg) =>
    onProgress?.(stage, (i + (overallProgress(stage, f) ?? 0)) / n, msg);
  let base = project.shot_plan;
  if (!base.caption_anchor) {
    const anchor = await anchorForPlan(projectId, base, (stage, f, msg) => report(0, stage, f, msg));
    base = { ...base, caption_anchor: /** @type {any} */ (anchor) };
    base.hash = hashShotPlan(base);
  }
  const from = axesOf(base);
  const sets = planVariantAxes(base, n);
  if (sets.length < n)
    throw new ProjectError('I could not find enough different choices for that many variants. Try fewer.');

  /** @type {(import('../types.mjs').RenderResult & {plan_diff: {changed: string[], from: Axes, to: Axes}})[]} */
  const results = [];
  /** @type {import('../types.mjs').Variant[]} */
  const variants = [];
  for (let i = 0; i < sets.length; i++) {
    const id = `v${i + 1}`;
    const plan = buildVariantPlan(project.transcript, project.cut, base, sets[i]);
    const result = await renderPlan({
      projectId,
      plan,
      quality: 'final',
      variant_id: id,
      onProgress: (stage, f, msg) => report(i, stage, f, `Variant ${i + 1} of ${sets.length}: ${msg ?? stage}`),
      signal,
    });
    const withDiff = {
      ...result,
      variant_id: id,
      plan_diff: { changed: axesDiffer(from, sets[i]), from, to: sets[i] },
    };
    results.push(withDiff);
    variants.push({ id, axes: sets[i], render: result });
    await updateProject(projectId, (p) => {
      p.variants = [...variants];
    });
  }
  return results;
}
