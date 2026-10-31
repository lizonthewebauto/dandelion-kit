// Caption cues: the spoken words grouped into what is on screen at one time, per caption theme.
// Times are on the cut timeline. The renderer draws the cues; this file only decides the words and the timing.
import { isStopword } from './util.mjs';

/**
 * How each theme groups words.
 *   karaoke  a short group is shown and one word at a time lights up (one cue per word, same group each time)
 *   one      one word at a time
 *   phrase   a short phrase is shown and stays until the next one
 * @type {Readonly<Record<string, {mode: 'karaoke'|'one'|'phrase', min_words: number, max_words: number, line_chars: number, lines: number}>>}
 */
export const CAPTION_LAYOUT = Object.freeze({
  'karaoke-highlight': { mode: 'karaoke', min_words: 2, max_words: 4, line_chars: 19, lines: 1 },
  'karaoke-pill': { mode: 'karaoke', min_words: 2, max_words: 4, line_chars: 19, lines: 1 },
  'one-word-pop': { mode: 'one', min_words: 1, max_words: 1, line_chars: 16, lines: 1 },
  'bold-stroke': { mode: 'karaoke', min_words: 1, max_words: 3, line_chars: 16, lines: 1 },
  'clean-minimal': { mode: 'phrase', min_words: 3, max_words: 7, line_chars: 28, lines: 2 },
  'editorial-serif': { mode: 'phrase', min_words: 3, max_words: 6, line_chars: 28, lines: 2 },
  'box-caption': { mode: 'phrase', min_words: 3, max_words: 7, line_chars: 28, lines: 2 },
  'mono-terminal': { mode: 'phrase', min_words: 3, max_words: 6, line_chars: 24, lines: 2 },
});

export const CUE_RULES = Object.freeze({
  /** A cue appears this long before its first word is spoken (when the last cue has ended). */
  lead_ms: 150,
  /** A cue stays this long after its last word. */
  hold_ms: 120,
  /** A pause this long between two words starts a new cue. */
  break_gap_ms: 350,
  /** Reading speed cap in characters per second. */
  max_chars_per_second: 17,
  /** One word cues are on screen at least this long, and at most this long unless the word itself is longer. */
  one_word_min_ms: 200,
  one_word_max_ms: 500,
  /** Caption text never runs past this many characters on a line, or this many lines. */
  max_line_chars: 32,
  max_lines: 2,
});

const SENTENCE_END = /[.?!]["')\]]?$/u;
const CLAUSE_END = /[,;:]["')\]]?$/u;

/** @param {import('./roughcut.mjs').TimelineWord[]} g */
const joined = (g) => g.map((w) => w.text).join(' ');

/**
 * Group the words for one theme. Returns arrays of words.
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 * @param {string} theme
 * @returns {import('./roughcut.mjs').TimelineWord[][]}
 */
export function groupWords(words, theme) {
  const layout = CAPTION_LAYOUT[theme];
  if (!layout) throw new Error(`Unknown caption theme "${theme}".`);
  const maxChars = layout.line_chars * layout.lines;
  /** @type {import('./roughcut.mjs').TimelineWord[][]} */
  let groups = [];
  /** @type {import('./roughcut.mjs').TimelineWord[]} */
  let cur = [];
  words.forEach((w, i) => {
    if (cur.length > 0) {
      const last = cur[cur.length - 1];
      const tooMany = cur.length >= layout.max_words;
      const tooLong = joined([...cur, w]).length > maxChars;
      const pause = w.start_ms - last.end_ms >= CUE_RULES.break_gap_ms;
      if (tooMany || tooLong || pause) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
    const closes = SENTENCE_END.test(w.text.trim()) || (layout.mode !== 'one' && CLAUSE_END.test(w.text.trim()) && cur.length >= layout.min_words);
    if (closes || i === words.length - 1) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);

  if (layout.mode === 'one') {
    // Little words that flash by too fast join the word next to them.
    /** @type {import('./roughcut.mjs').TimelineWord[][]} */
    const out = [];
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const w = g[0];
      const quick = g.length === 1 && w.end_ms - w.start_ms < CUE_RULES.one_word_min_ms && isStopword(w.text) && w.text.length <= 4;
      const next = groups[i + 1];
      if (quick && next && !SENTENCE_END.test(w.text.trim())) {
        groups[i + 1] = [w, ...next];
        continue;
      }
      out.push(g);
    }
    groups = out;
    return groups;
  }

  // A tiny leftover group joins its neighbour when it fits.
  /** @type {import('./roughcut.mjs').TimelineWord[][]} */
  const merged = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    const small = g.length < layout.min_words;
    if (prev && small && prev.length + g.length <= layout.max_words && joined([...prev, ...g]).length <= maxChars && !SENTENCE_END.test(prev[prev.length - 1].text.trim())) {
      prev.push(...g);
    } else {
      merged.push([...g]);
    }
  }
  return merged;
}

/**
 * Build the caption cues for a theme.
 * @param {import('./roughcut.mjs').TimelineWord[]} words
 * @param {string} theme
 * @returns {{cues: import('../types.mjs').CaptionCue[], groups: import('./roughcut.mjs').TimelineWord[][]}}
 */
export function buildCaptionCues(words, theme) {
  const layout = CAPTION_LAYOUT[theme];
  const groups = groupWords(words, theme);
  /** @type {import('../types.mjs').CaptionCue[]} */
  const cues = [];
  let prevEnd = 0;
  groups.forEach((g, gi) => {
    const first = g[0];
    const last = g[g.length - 1];
    const next = groups[gi + 1];
    const idealStart = first.start_ms - CUE_RULES.lead_ms;
    const start = Math.max(prevEnd, idealStart, 0);
    const nextIdeal = next ? next[0].start_ms - CUE_RULES.lead_ms : Infinity;
    let end = Math.min(last.end_ms + CUE_RULES.hold_ms, Math.max(last.end_ms, nextIdeal));
    const text = joined(g);
    const needed = Math.ceil((text.length / CUE_RULES.max_chars_per_second) * 1000);
    if (end - start < needed) end = Math.min(start + needed, Math.max(last.end_ms, nextIdeal));
    if (layout.mode === 'one') {
      const word = Math.max(0, last.end_ms - first.start_ms);
      const cap = Math.max(start + CUE_RULES.one_word_max_ms, last.end_ms);
      end = Math.max(Math.min(end, cap), Math.min(start + CUE_RULES.one_word_min_ms, Math.max(last.end_ms, nextIdeal)));
      if (word === 0) end = Math.max(end, start + 1);
    }
    end = Math.max(end, start + 1);
    const indexes = g.map((w) => w.index);
    if (layout.mode === 'karaoke') {
      g.forEach((w, k) => {
        const s = k === 0 ? start : w.start_ms;
        const e = k === g.length - 1 ? end : g[k + 1].start_ms;
        if (e > s) cues.push({ start_ms: Math.round(s), end_ms: Math.round(e), word_indexes: indexes, text, active_word: k });
      });
    } else {
      cues.push({ start_ms: Math.round(start), end_ms: Math.round(end), word_indexes: indexes, text });
    }
    prevEnd = end;
  });
  return { cues, groups };
}
