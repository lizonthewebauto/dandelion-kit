// Beats: the cut reel split into sentences and ideas, each with a kind (stat, list, contrast, question and so on)
// and the way it is shown (its treatment). Pure functions over the words on the cut timeline.
import { pacingArcMultiplier } from './pacing.mjs';
import { roundMs } from './util.mjs';

/**
 * How to spot each kind of beat from its words. The first match wins, so the order is the order of
 * how specific each pattern is. Anything that matches nothing is "default".
 * @type {readonly {kind: import('../types.mjs').Beat['kind'], pattern: RegExp, guidance: string}[]}
 */
export const BEAT_RULES = Object.freeze([
  {
    kind: 'number-stat',
    pattern: /\d+(?:\.\d+)?\s*(?:%|percent|x\b|times|dollars?|bucks?|followers?|views?|hours?|minutes?|seconds?|days?|weeks?|years?)|\$\d|(?:^|\s)(?:hundred|thousand|million)s?\b/iu,
    guidance: 'Show the number big when it is spoken and hold it for 1.5 to 3 seconds.',
  },
  {
    kind: 'list-step',
    pattern: /\b(?:first|second|third|fourth|fifth|step \d|number (?:one|two|three|four|five)|three (?:ways|things|steps|reasons)|lastly|finally)\b/iu,
    guidance: 'Build the list in time with the speech, each item landing right after it is spoken.',
  },
  {
    kind: 'contrast',
    pattern: /\b(?:versus|vs\.?|instead of|rather than|compared to|before and after|used to|but now|the difference|better than|worse than)\b/iu,
    guidance: 'Two panels side by side, with the second one landing on the "versus".',
  },
  {
    kind: 'cta',
    pattern: /\b(?:follow|comment|share|save this|link in (?:my )?bio|dm me|subscribe|send you|drop a)\b/iu,
    guidance: 'Face plus a small prompt, under 3 seconds, inside the safe area.',
  },
  {
    kind: 'instruction',
    pattern: /\b(?:click|tap|open|go to|type|paste|copy|select|search for|scroll|drag|install|download|settings|menu)\b/iu,
    guidance: 'Screen demo with the zoom landing on the click.',
  },
  {
    kind: 'question',
    pattern: /\?|\b(?:guess what|you know what|what if|why does|how do|ever wonder|want to know)\b/iu,
    guidance: 'Small push-in on the face and a beat of quiet before the answer.',
  },
  {
    kind: 'story',
    pattern: /\b(?:last (?:week|month|year)|yesterday|when i|one day|so i|then i|i was|i had|true story|storytime)\b/iu,
    guidance: 'Cover most of it with b-roll or proof, return to the face for the turn.',
  },
  {
    kind: 'emotional',
    pattern: /\b(?:honestly|truthfully|i'?ll be real|vulnerable|scared|proud|grateful|hardest|changed my life|nobody talks about)\b/iu,
    guidance: 'Face only. Strip the extras, slow push, no sound effects.',
  },
  {
    kind: 'claim',
    pattern: /\b(?:will|makes|gets you|proven|works|guarantee|the truth is|actually|here'?s why|the reason)\b/iu,
    guidance: 'Cut to proof within 1.5 seconds of the key word.',
  },
]);

/**
 * Pick the kind of beat for some words.
 * @param {string} text
 * @returns {import('../types.mjs').Beat['kind']}
 */
export function classifyBeat(text) {
  const clause = String(text ?? '');
  for (const rule of BEAT_RULES) if (rule.pattern.test(clause)) return rule.kind;
  return 'default';
}

/**
 * How each kind is shown in v1, and the richer treatment a later animated path could draw instead.
 * Treatments the ffmpeg path cannot draw yet are listed as `wanted` and drawn as `rendered_as`.
 * @type {Readonly<Record<import('../types.mjs').Beat['kind'], {treatment: import('../types.mjs').Beat['treatment'], wanted?: string, rendered_as?: string}>>}
 */
export const TREATMENT_BY_KIND = Object.freeze({
  'number-stat': { treatment: 'text-emphasis', wanted: 'stat-card', rendered_as: 'text-emphasis' },
  'list-step': { treatment: 'face', wanted: 'numbered-build', rendered_as: 'face' },
  contrast: { treatment: 'face', wanted: 'split-panels', rendered_as: 'face' },
  instruction: { treatment: 'face', wanted: 'screen-demo', rendered_as: 'face' },
  question: { treatment: 'punch-in' },
  story: { treatment: 'face', wanted: 'b-roll', rendered_as: 'face' },
  emotional: { treatment: 'face' },
  cta: { treatment: 'face' },
  claim: { treatment: 'text-emphasis', wanted: 'proof-cut', rendered_as: 'text-emphasis' },
  default: { treatment: 'face' },
});

const SENTENCE_END = /[.?!]["')\]]?$/u;
const CLAUSE_END = /[,;:]["')\]]?$/u;
const MAX_SENTENCE_WORDS = 22;

/**
 * Split words into sentences: at end punctuation, at a pause, or after 22 words.
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 * @param {number} pause_ms
 * @returns {import('./roughcut.mjs').TimelineWord[][]}
 */
export function splitSentences(words, pause_ms = 450) {
  /** @type {import('./roughcut.mjs').TimelineWord[][]} */
  const out = [];
  /** @type {import('./roughcut.mjs').TimelineWord[]} */
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next) return;
    if (SENTENCE_END.test(w.text.trim()) || next.start_ms - w.end_ms >= pause_ms || cur.length >= MAX_SENTENCE_WORDS) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

const spanOf = (/** @type {import('./roughcut.mjs').TimelineWord[]} */ g) => (g.length ? g[g.length - 1].end_ms - g[0].start_ms : 0);

/**
 * Break a run of words that is too long for one beat at its best natural break near the middle.
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 * @param {number} maxMs
 * @returns {import('./roughcut.mjs').TimelineWord[][]}
 */
export function splitLong(words, maxMs) {
  if (words.length < 6 || spanOf(words) <= maxMs) return [words];
  const mid = words.length / 2;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 3; i <= words.length - 3; i += 1) {
    const gap = words[i].start_ms - words[i - 1].end_ms;
    const comma = CLAUSE_END.test(words[i - 1].text.trim()) ? 300 : 0;
    const score = gap + comma - (Math.abs(i - mid) / words.length) * 400;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return [words];
  return [...splitLong(words.slice(0, best), maxMs), ...splitLong(words.slice(best), maxMs)];
}

const textOf = (/** @type {import('./roughcut.mjs').TimelineWord[]} */ g) => g.map((w) => w.text).join(' ');

/**
 * Group the cut reel into beats whose length follows the look's cadence and the pacing arc.
 * Beats cover the whole timeline with no gaps: each one runs to the middle of the pause before the next.
 * @param {import('./roughcut.mjs').TimelineWord[]} words        Words on the cut timeline, in order.
 * @param {{cadence: {min_ms:number, max_ms:number}, duration_ms: number, pause_ms?: number}} options
 * @returns {import('../types.mjs').Beat[]}
 */
export function buildBeats(words, options) {
  if (words.length === 0) return [];
  const { cadence, duration_ms } = options;
  const sentences = splitSentences(words, options.pause_ms ?? 450).flatMap((s) => splitLong(s, Math.round(cadence.max_ms * 1.3)));

  /** @type {{words: import('./roughcut.mjs').TimelineWord[], kind: import('../types.mjs').Beat['kind']}[]} */
  const groups = [];
  for (const s of sentences) {
    const kind = classifyBeat(textOf(s));
    const last = groups[groups.length - 1];
    if (last) {
      const progress = Math.min(1, last.words[0].start_ms / Math.max(1, duration_ms));
      const mult = pacingArcMultiplier(progress);
      const minMs = cadence.min_ms / mult;
      const maxMs = cadence.max_ms / mult;
      const compatible = last.kind === 'default' || kind === 'default' || last.kind === kind;
      const merged = spanOf([...last.words, ...s]);
      if (compatible && merged <= maxMs * 1.3 && (spanOf(last.words) < minMs || merged <= maxMs)) {
        last.words.push(...s);
        if (last.kind === 'default') last.kind = kind;
        continue;
      }
    }
    groups.push({ words: [...s], kind });
  }

  return groups.map((g, i) => {
    const first = g.words[0];
    const lastW = g.words[g.words.length - 1];
    const nextFirst = groups[i + 1]?.words[0];
    const prevLast = groups[i - 1]?.words[groups[i - 1].words.length - 1];
    const start = i === 0 ? 0 : roundMs((prevLast.end_ms + first.start_ms) / 2);
    const end = nextFirst ? roundMs((lastW.end_ms + nextFirst.start_ms) / 2) : duration_ms;
    const t = TREATMENT_BY_KIND[g.kind];
    /** @type {import('../types.mjs').Beat} */
    const beat = {
      id: `b${i + 1}`,
      kind: g.kind,
      out_start_ms: start,
      out_end_ms: Math.max(end, start + 1),
      first_word: first.index,
      last_word: lastW.index,
      text: textOf(g.words),
      treatment: t.treatment,
      emphasis_words: [],
    };
    if (t.wanted) {
      beat.wanted_treatment = t.wanted;
      beat.rendered_as = t.rendered_as ?? 'face';
    }
    return beat;
  });
}
