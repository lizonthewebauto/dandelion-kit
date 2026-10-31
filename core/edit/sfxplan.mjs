// Sound effect plan: a few small sounds at the moments that earn them, never more than the look's budget,
// never twice within 1.5 seconds, and none on emotional beats. Only names the first-party synth makes.
import { SFX_NAMES } from '../types.mjs';
import { LOOK_SFX_PALETTE } from './looks.mjs';
import { cameraEventIndexes } from './pacing.mjs';

export const SFX_RULES = Object.freeze({
  /** Level under the speech. */
  gain_db: -12,
  /** No two effects closer than this. */
  dedupe_ms: 1500,
});

/** What each job in the edit prefers to sound like, best match first. The look's palette decides what is allowed. */
const ROLES = Object.freeze({
  transition: ['whoosh', 'page', 'snap', 'tap'],
  entrance: ['pop', 'tap', 'snap'],
  item: ['ding', 'tap', 'pop'],
  impact: ['bass-hit', 'snap', 'pop'],
  reveal: ['riser', 'whoosh'],
  done: ['complete', 'ding'],
});

/**
 * @param {keyof typeof ROLES} role
 * @param {readonly string[]} palette
 * @returns {typeof SFX_NAMES[number]|null}
 */
function pick(role, palette) {
  const name = ROLES[role].find((n) => palette.includes(n));
  return /** @type {any} */ (name ?? null);
}

/**
 * Plan the sound effects.
 * @param {object} input
 * @param {import('../types.mjs').Beat[]} input.beats
 * @param {import('../types.mjs').CameraMove[]} input.camera
 * @param {import('./roughcut.mjs').TimelineWord[]} input.words
 * @param {number} input.duration_ms
 * @param {import('../types.mjs').Look} input.look
 * @param {boolean} [input.hook_card]    True when the opening has hook text.
 * @returns {import('../types.mjs').SfxCue[]}
 */
export function planSfx({ beats, camera, words, duration_ms, look, hook_card = false }) {
  const palette = LOOK_SFX_PALETTE[look.id] ?? [];
  const perMinute = look.sfx_per_minute;
  const budget = duration_ms < 8000 ? 0 : Math.max(1, Math.round((perMinute * duration_ms) / 60000));
  if (budget === 0 || palette.length === 0) return [];

  /** @type {{t:number, name: typeof SFX_NAMES[number], priority:number}[]} */
  const candidates = [];
  /** @param {number} t @param {typeof SFX_NAMES[number]|null} name @param {number} priority */
  const add = (t, name, priority) => {
    if (name && SFX_NAMES.includes(name) && t >= 0 && t <= duration_ms) candidates.push({ t: Math.round(t), name, priority });
  };
  const wordStart = new Map(words.map((w) => [w.index, w.start_ms]));

  if (hook_card) add(120, pick('entrance', palette), 60);
  for (const idx of cameraEventIndexes(camera)) {
    add(camera[idx].out_start_ms, pick('transition', palette), 50);
  }
  for (const beat of beats) {
    const t = beat.out_start_ms;
    const emphasisAt = beat.emphasis_words.length > 0 ? wordStart.get(beat.emphasis_words[0]) : undefined;
    if (beat.kind === 'number-stat' || beat.kind === 'claim') add(emphasisAt ?? t, pick('impact', palette), 70);
    else if (beat.kind === 'list-step') add(t + 100, pick('item', palette), 65);
    else if (beat.treatment === 'text-emphasis') add(emphasisAt ?? t, pick('entrance', palette), 55);
    else if (beat.kind === 'cta') add(t + 200, pick('done', palette), 40);
    else if (beat.kind === 'contrast') add(t, pick('transition', palette), 45);
  }

  const quiet = beats.filter((b) => b.kind === 'emotional');
  const allowed = candidates.filter((c) => !quiet.some((b) => c.t >= b.out_start_ms && c.t < b.out_end_ms));
  allowed.sort((a, b) => b.priority - a.priority || a.t - b.t);
  /** @type {typeof allowed} */
  const chosen = [];
  for (const c of allowed) {
    if (chosen.length >= budget) break;
    if (chosen.some((x) => Math.abs(x.t - c.t) < SFX_RULES.dedupe_ms)) continue;
    chosen.push(c);
  }
  return chosen
    .sort((a, b) => a.t - b.t)
    .map((c) => ({ out_ms: c.t, name: c.name, gain_db: SFX_RULES.gain_db }));
}
