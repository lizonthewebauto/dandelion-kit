// Shared helpers for the edit brain tests. Not a test file.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The hand-written fixture transcript: 68 words, 30.7 s, with fillers, a stutter, a restart and a long pause. */
export function loadFixture() {
  const raw = JSON.parse(readFileSync(join(HERE, 'fixtures', 'transcript-talking-head.json'), 'utf8'));
  return /** @type {{duration_ms: number, transcript: import('../core/types.mjs').Transcript}} */ (raw);
}

/**
 * A made-up reel of equal beats, to test pacing without any speech.
 * @param {number} duration_ms
 * @param {number} step_ms
 * @param {(i:number)=>Partial<import('../core/types.mjs').Beat>} [over]
 * @returns {import('../core/types.mjs').Beat[]}
 */
export function synthBeats(duration_ms, step_ms, over = () => ({})) {
  /** @type {import('../core/types.mjs').Beat[]} */
  const beats = [];
  for (let i = 0, t = 0; t < duration_ms; i += 1, t += step_ms) {
    beats.push({
      id: `b${i + 1}`,
      kind: 'default',
      out_start_ms: t,
      out_end_ms: Math.min(duration_ms, t + step_ms),
      first_word: i * 5,
      last_word: i * 5 + 4,
      text: 'some spoken words here today',
      treatment: 'face',
      emphasis_words: [],
      ...over(i),
    });
  }
  return beats;
}

/** Fail-friendly golden compare. Set UPDATE_GOLDEN=1 to rewrite the file. */
export function goldenPath(name) {
  return join(HERE, 'fixtures', name);
}

/**
 * Narrow a value that must exist, for the type checker and for a clear failure.
 * @template T
 * @param {T|undefined|null} v
 * @param {string} [what]
 * @returns {T}
 */
export function must(v, what = 'value') {
  if (v === undefined || v === null) throw new Error(`expected ${what} to exist`);
  return v;
}
