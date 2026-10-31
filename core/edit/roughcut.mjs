// Breath-safe rough cut: fillers, stutters, restarts and long silences come out, and every cut keeps a short
// breath tail and lead-in so no word is ever clipped. Pure functions, no file access.
//
// Two steps:
//   1. detectRemovals(): finds what could come out (RemovedSpan list, each with keep = false).
//   2. layoutCut(): turns the spans the person has NOT chosen to keep into the pieces that stay in the reel.
// The card toggles keep flags and calls layoutCut() again, so the cut is always rebuilt from the same rules.
import { normalizeWord, roundMs } from './util.mjs';

/**
 * Presets differ in how long a pause may be before it is shortened and in how much air stays around a cut.
 * "pad_out" is the breath tail kept after the last word before a cut. "pad_in" is the lead-in before the next word.
 */
export const ROUGH_CUT_PRESETS = Object.freeze({
  gentle: Object.freeze({ silence_threshold_ms: 900, pad_out_ms: 200, pad_in_ms: 110 }),
  standard: Object.freeze({ silence_threshold_ms: 650, pad_out_ms: 160, pad_in_ms: 90 }),
  punchy: Object.freeze({ silence_threshold_ms: 350, pad_out_ms: 90, pad_in_ms: 60 }),
});

export const ROUGH_CUT_PRESET_IDS = Object.freeze(['gentle', 'standard', 'punchy']);

export const DEFAULT_ROUGH_CUT = Object.freeze({
  ...ROUGH_CUT_PRESETS.standard,
  /** Single-word fillers. */
  fillers: Object.freeze(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'ahh', 'hmm', 'hm', 'mm', 'mmm', 'uhm', 'mhm']),
  /** Phrase fillers come out only when they sit between pauses, so "you know" inside a real sentence survives. */
  phrase_fillers: Object.freeze([
    Object.freeze(['you', 'know']),
    Object.freeze(['i', 'mean']),
    Object.freeze(['sort', 'of']),
    Object.freeze(['kind', 'of']),
  ]),
  remove_fillers: true,
  remove_stutters: true,
  remove_restarts: true,
  /** The smallest piece to keep. Smaller pieces are merged into a neighbour, never dropped. */
  min_piece_ms: 250,
  /** Silence shorter than this is not worth a cut. */
  min_cut_ms: 80,
  /** A repeated word closer than this counts as a stutter. */
  stutter_gap_ms: 400,
  /** A repeated phrase closer than this counts as a restart. */
  restart_gap_ms: 700,
  /** Pause needed on both sides of a phrase filler. */
  phrase_pause_ms: 220,
  /** Dead air at the very start or end is trimmed when at least this long. */
  edge_trim_min_ms: 200,
});

/**
 * @typedef {object} RoughCutOptions
 * @property {'gentle'|'standard'|'punchy'} [preset]
 * @property {number} [duration_ms]       Length of the source. Defaults to the last word end plus 600 ms.
 * @property {number} [silence_threshold_ms]
 * @property {number} [pad_out_ms]
 * @property {number} [pad_in_ms]
 * @property {boolean} [remove_fillers]
 * @property {boolean} [remove_stutters]
 * @property {boolean} [remove_restarts]
 * @property {number} [min_piece_ms]
 */

/**
 * @param {RoughCutOptions} [options]
 */
function resolveOptions(options = {}) {
  const presetId = options.preset ?? 'standard';
  const preset = ROUGH_CUT_PRESETS[presetId];
  if (!preset) throw new Error(`Unknown rough cut preset: ${String(presetId)}. Use gentle, standard or punchy.`);
  const o = { ...DEFAULT_ROUGH_CUT, ...preset };
  for (const key of /** @type {const} */ ([
    'silence_threshold_ms',
    'pad_out_ms',
    'pad_in_ms',
    'remove_fillers',
    'remove_stutters',
    'remove_restarts',
    'min_piece_ms',
  ])) {
    if (options[key] !== undefined) /** @type {any} */ (o)[key] = options[key];
  }
  return { preset: /** @type {'gentle'|'standard'|'punchy'} */ (presetId), o };
}

/** @param {import('../types.mjs').Transcript} transcript @param {number|undefined} given */
function sourceDuration(transcript, given) {
  if (typeof given === 'number' && Number.isFinite(given) && given > 0) return roundMs(given);
  const last = transcript.words[transcript.words.length - 1];
  return last ? last.end_ms + 600 : 0;
}

/**
 * Find everything the rough cut would remove. Nothing is cut yet: every span has keep = false (it comes out)
 * until the person says otherwise.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {RoughCutOptions} [options]
 * @returns {import('../types.mjs').RemovedSpan[]}
 */
export function detectRemovals(transcript, options = {}) {
  const { o } = resolveOptions(options);
  const duration = sourceDuration(transcript, options.duration_ms);
  const words = transcript.words;
  const norm = words.map((w) => normalizeWord(w.text));
  /** @type {(null|'filler'|'stutter'|'restart'|'phrase-filler')[]} */
  const drop = new Array(words.length).fill(null);

  if (o.remove_fillers) {
    const fillerSet = new Set(o.fillers);
    norm.forEach((w, i) => {
      if (fillerSet.has(w)) drop[i] = 'filler';
    });
    for (const phrase of o.phrase_fillers) {
      for (let i = 0; i + phrase.length <= words.length; i += 1) {
        if (!phrase.every((p, k) => norm[i + k] === p)) continue;
        const last = i + phrase.length - 1;
        const before = i === 0 ? Infinity : words[i].start_ms - words[i - 1].end_ms;
        const after = last === words.length - 1 ? Infinity : words[last + 1].start_ms - words[last].end_ms;
        if (before >= o.phrase_pause_ms && after >= o.phrase_pause_ms) {
          for (let k = i; k <= last; k += 1) if (drop[k] === null) drop[k] = 'phrase-filler';
        }
      }
    }
  }

  if (o.remove_restarts) {
    // "I want to I want to say": the same short phrase twice in a row. The first take comes out, the clean one stays.
    for (let n = 4; n >= 2; n -= 1) {
      for (let i = 0; i + 2 * n <= words.length; i += 1) {
        let free = true;
        let same = true;
        for (let k = 0; k < n; k += 1) {
          if (drop[i + k] !== null || drop[i + n + k] !== null) free = false;
          if (norm[i + k] === '' || norm[i + k] !== norm[i + n + k]) same = false;
        }
        if (!free || !same) continue;
        const gap = words[i + n].start_ms - words[i + n - 1].end_ms;
        if (gap < o.restart_gap_ms) for (let k = 0; k < n; k += 1) drop[i + k] = 'restart';
      }
    }
  }

  if (o.remove_stutters) {
    for (let i = 1; i < words.length; i += 1) {
      if (drop[i - 1] !== null || drop[i] === 'filler') continue;
      const gap = words[i].start_ms - words[i - 1].end_ms;
      // "the the", "I I": a repeat right after itself. The first take comes out.
      if (norm[i] !== '' && norm[i] === norm[i - 1] && gap < o.stutter_gap_ms) drop[i - 1] = 'stutter';
    }
  }

  /** @type {Omit<import('../types.mjs').RemovedSpan, 'id'>[]} */
  const spans = [];
  for (let i = 0; i < words.length; i += 1) {
    const kind = drop[i];
    if (kind === null) continue;
    let j = i;
    while (j + 1 < words.length && drop[j + 1] === kind) j += 1;
    spans.push({
      kind,
      src_start_ms: words[i].start_ms,
      src_end_ms: words[j].end_ms,
      text: words
        .slice(i, j + 1)
        .map((w) => w.text)
        .join(' '),
      keep: false,
    });
    i = j;
  }

  // Silences: any pause between two words longer than the threshold, plus dead air at the start and end.
  for (let i = 0; i + 1 < words.length; i += 1) {
    const gap = words[i + 1].start_ms - words[i].end_ms;
    if (gap <= o.silence_threshold_ms) continue;
    const start = words[i].end_ms + Math.min(o.pad_out_ms, gap / 2);
    const end = words[i + 1].start_ms - Math.min(o.pad_in_ms, gap / 2);
    if (end - start >= o.min_cut_ms) {
      spans.push({ kind: 'silence', src_start_ms: roundMs(start), src_end_ms: roundMs(end), text: '', keep: false });
    }
  }
  if (words.length > 0) {
    const headEnd = words[0].start_ms - o.pad_in_ms;
    if (headEnd >= o.edge_trim_min_ms) {
      spans.push({ kind: 'silence', src_start_ms: 0, src_end_ms: roundMs(headEnd), text: '', keep: false });
    }
    const tailStart = words[words.length - 1].end_ms + o.pad_out_ms;
    if (duration - tailStart >= o.edge_trim_min_ms) {
      spans.push({ kind: 'silence', src_start_ms: roundMs(tailStart), src_end_ms: duration, text: '', keep: false });
    }
  }

  spans.sort((a, b) => a.src_start_ms - b.src_start_ms || a.src_end_ms - b.src_end_ms);
  return spans.map((s, i) => ({ id: `r${i + 1}`, ...s }));
}

/**
 * Turn the removals the person has not kept into the pieces that stay.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').RemovedSpan[]} removed
 * @param {RoughCutOptions} [options]
 * @returns {import('../types.mjs').CutPlan}
 */
export function layoutCut(transcript, removed, options = {}) {
  const { preset, o } = resolveOptions(options);
  const duration = sourceDuration(transcript, options.duration_ms);
  const words = transcript.words;
  const active = removed.filter((r) => !r.keep);

  // Words that come out.
  const dropWord = new Array(words.length).fill(false);
  for (const span of active) {
    if (span.kind === 'silence') continue;
    words.forEach((w, i) => {
      if (w.start_ms >= span.src_start_ms && w.end_ms <= span.src_end_ms) dropWord[i] = true;
    });
  }

  /** @type {[number, number][]} */
  const cuts = [];
  for (let i = 0; i < words.length; i += 1) {
    if (!dropWord[i]) continue;
    let j = i;
    while (j + 1 < words.length && dropWord[j + 1]) j += 1;
    const prev = words[i - 1];
    const next = words[j + 1];
    const start = prev ? prev.end_ms + Math.min(o.pad_out_ms, Math.max(0, words[i].start_ms - prev.end_ms)) : 0;
    const end = next ? next.start_ms - Math.min(o.pad_in_ms, Math.max(0, next.start_ms - words[j].end_ms)) : duration;
    if (end > start) cuts.push([start, end]);
    i = j;
  }
  for (const span of active) {
    if (span.kind === 'silence' && span.src_end_ms > span.src_start_ms) cuts.push([span.src_start_ms, span.src_end_ms]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
    else merged.push([c[0], c[1]]);
  }

  // Pieces are what is left between the cuts.
  /** @type {{start:number,end:number}[]} */
  let raw = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) raw.push({ start: cursor, end: Math.min(s, duration) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < duration) raw.push({ start: cursor, end: duration });
  raw = raw.filter((p) => p.end > p.start);

  /** @param {{start:number,end:number}} p */
  const wordsIn = (p) => {
    /** @type {number[]} */
    const idx = [];
    words.forEach((w, i) => {
      const mid = (w.start_ms + w.end_ms) / 2;
      if (mid >= p.start && mid < p.end) idx.push(i);
    });
    return idx;
  };

  // A piece shorter than min_piece_ms joins its neighbour (keeping the pause between them). Speech is never dropped.
  /** @type {{start:number,end:number,idx:number[]}[]} */
  const pieces = [];
  for (const p of raw) {
    const idx = wordsIn(p);
    const len = p.end - p.start;
    const prev = pieces[pieces.length - 1];
    if (idx.length === 0 && len < o.min_piece_ms) continue; // a sliver with no speech
    if (len < o.min_piece_ms && prev) {
      prev.end = p.end;
      prev.idx.push(...idx);
    } else {
      pieces.push({ start: p.start, end: p.end, idx });
    }
  }
  if (pieces.length > 1 && pieces[0].end - pieces[0].start < o.min_piece_ms) {
    const [first, second, ...rest] = pieces;
    pieces.splice(0, pieces.length, { start: first.start, end: second.end, idx: [...first.idx, ...second.idx] }, ...rest);
  }

  let outCursor = 0;
  /** @type {import('../types.mjs').Piece[]} */
  const out = [];
  for (const p of pieces) {
    if (p.idx.length === 0) continue;
    const len = roundMs(p.end) - roundMs(p.start);
    out.push({
      id: `p${out.length + 1}`,
      src_start_ms: roundMs(p.start),
      src_end_ms: roundMs(p.end),
      out_start_ms: outCursor,
      out_end_ms: outCursor + len,
      first_word: p.idx[0],
      last_word: p.idx[p.idx.length - 1],
    });
    outCursor += len;
  }

  return {
    preset,
    pieces: out,
    removed: removed.map((r) => ({ ...r })),
    before_ms: duration,
    after_ms: outCursor,
  };
}

/**
 * Detect and lay out in one go. Nothing is rendered; this is only the plan.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {RoughCutOptions} [options]
 * @returns {import('../types.mjs').CutPlan}
 */
export function roughCut(transcript, options = {}) {
  return layoutCut(transcript, detectRemovals(transcript, options), options);
}

/**
 * Apply the person's choices from the card: ids listed in keep_ids stay in the reel, ids in drop_ids come out.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').CutPlan} plan
 * @param {{keep_ids?: string[], drop_ids?: string[]}} choices
 * @param {RoughCutOptions} [options]
 */
export function applyChoices(transcript, plan, choices, options = {}) {
  const keep = new Set(choices.keep_ids ?? []);
  const drop = new Set(choices.drop_ids ?? []);
  const removed = plan.removed.map((r) => ({ ...r, keep: keep.has(r.id) ? true : drop.has(r.id) ? false : r.keep }));
  return layoutCut(transcript, removed, { preset: plan.preset, duration_ms: plan.before_ms, ...options });
}

/**
 * A word on the finished timeline.
 * @typedef {object} TimelineWord
 * @property {number} index        Index into Transcript.words.
 * @property {string} text
 * @property {number} start_ms     Time in the cut timeline.
 * @property {number} end_ms
 */

/**
 * Where every word that stays in the reel lands on the cut timeline.
 * @param {import('../types.mjs').Transcript} transcript
 * @param {import('../types.mjs').Piece[]} pieces
 * @returns {TimelineWord[]}
 */
export function wordsOnTimeline(transcript, pieces) {
  /** @type {TimelineWord[]} */
  const out = [];
  for (const piece of pieces) {
    for (let i = piece.first_word; i <= piece.last_word; i += 1) {
      const w = transcript.words[i];
      if (!w) continue;
      const mid = (w.start_ms + w.end_ms) / 2;
      if (mid < piece.src_start_ms || mid >= piece.src_end_ms) continue;
      const s = Math.max(w.start_ms, piece.src_start_ms) - piece.src_start_ms;
      const e = Math.min(w.end_ms, piece.src_end_ms) - piece.src_start_ms;
      const start = piece.out_start_ms + s;
      out.push({ index: i, text: w.text, start_ms: start, end_ms: Math.max(start + 1, piece.out_start_ms + e) });
    }
  }
  return out;
}

/**
 * Map a time in the work copy to the cut timeline. Returns null when that moment was cut out.
 * @param {import('../types.mjs').Piece[]} pieces
 * @param {number} src_ms
 * @returns {number|null}
 */
export function srcToOut(pieces, src_ms) {
  for (const p of pieces) {
    if (src_ms >= p.src_start_ms && src_ms <= p.src_end_ms) return p.out_start_ms + (src_ms - p.src_start_ms);
  }
  return null;
}

/**
 * Plain numbers for the cut card.
 * @param {import('../types.mjs').CutPlan} plan
 */
export function cutStats(plan) {
  const active = plan.removed.filter((r) => !r.keep);
  return {
    before_ms: plan.before_ms,
    after_ms: plan.after_ms,
    saved_ms: Math.max(0, plan.before_ms - plan.after_ms),
    removed_count: active.length,
    filler_count: active.filter((r) => r.kind === 'filler' || r.kind === 'phrase-filler').length,
    stutter_count: active.filter((r) => r.kind === 'stutter' || r.kind === 'restart').length,
    silence_count: active.filter((r) => r.kind === 'silence').length,
  };
}
