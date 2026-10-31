// Transcript helpers: clean raw engine output into Words, build Segments, validate a Transcript.
import { TRANSCRIBE_ENGINES } from '../types.mjs';

/**
 * Raw word from an engine: times in ms, end may be missing.
 * @typedef {object} RawWord
 * @property {string} text
 * @property {number | null | undefined} start_ms
 * @property {number | null | undefined} end_ms
 * @property {number} [conf]
 */

/** A whole-token note such as [BLANK_AUDIO], (music) or *laughs*. */
const NOTE_PATTERN = /^(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*)$/;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
const SENTENCE_END = /[.!?…]["')\]]*$/u;

/** Rough speaking time for a word with no end time, by letters. @param {string} text */
function estimateMs(text) {
  return Math.min(600, Math.max(120, text.length * 60));
}

/**
 * Clean raw words: trim, drop notes, fold stray punctuation into the word before it,
 * fill missing times, and make times non-decreasing with no overlap.
 * @param {RawWord[]} raw
 * @param {{duration_ms?: number}} [options]
 * @returns {import('../types.mjs').Word[]}
 */
export function normalizeWords(raw, options = {}) {
  /** @type {import('../types.mjs').Word[]} */
  const words = [];
  /** @type {{start: number|null, end: number|null}[]} */
  const times = [];
  for (const item of raw) {
    const text = String(item.text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (NOTE_PATTERN.test(text) || /^[♪♫\s]+$/u.test(text)) continue; // not speech
    if (!HAS_WORD_CHAR.test(text)) {
      // Punctuation alone belongs to the word before it.
      if (words.length) {
        words[words.length - 1].text += text;
        if (typeof item.end_ms === 'number')
          times[times.length - 1].end = Math.max(times[times.length - 1].end ?? 0, item.end_ms);
      }
      continue;
    }
    /** @type {import('../types.mjs').Word} */
    const word = { text, start_ms: 0, end_ms: 0 };
    if (typeof item.conf === 'number' && Number.isFinite(item.conf))
      word.conf = Math.max(0, Math.min(1, item.conf));
    words.push(word);
    times.push({
      start:
        typeof item.start_ms === 'number' && Number.isFinite(item.start_ms)
          ? Math.round(item.start_ms)
          : null,
      end: typeof item.end_ms === 'number' && Number.isFinite(item.end_ms) ? Math.round(item.end_ms) : null,
    });
  }

  const limit = options.duration_ms && options.duration_ms > 0 ? options.duration_ms : Infinity;
  for (let i = 0; i < words.length; i++) {
    const prev = i > 0 ? words[i - 1] : null;
    let start = times[i].start ?? prev?.end_ms ?? 0;
    if (prev && start < prev.start_ms) start = prev.start_ms;
    start = Math.max(0, Math.min(start, limit === Infinity ? start : Math.max(0, limit - 1)));
    // No overlap: trim the word before to where this one starts.
    if (prev && start < prev.end_ms) prev.end_ms = Math.max(prev.start_ms, start);
    let end = times[i].end;
    if (end === null || end <= start) {
      const nextStart = times[i + 1]?.start;
      end = start + estimateMs(words[i].text);
      if (typeof nextStart === 'number' && nextStart > start) end = Math.min(end, nextStart);
    }
    if (end > limit) end = Math.max(start, limit);
    words[i].start_ms = start;
    words[i].end_ms = Math.max(start, end);
  }
  return words;
}

/**
 * Split words into sentence-like segments: at sentence ends, long pauses, or when too long.
 * @param {import('../types.mjs').Word[]} words
 * @param {{pause_ms?: number, max_words?: number, max_ms?: number}} [options]
 * @returns {import('../types.mjs').Segment[]}
 */
export function buildSegments(words, options = {}) {
  const pause = options.pause_ms ?? 800;
  const maxWords = options.max_words ?? 30;
  const maxMs = options.max_ms ?? 12000;
  /** @type {import('../types.mjs').Segment[]} */
  const segments = [];
  let first = 0;
  const flush = (last) => {
    if (last < first) return;
    segments.push({
      start_ms: words[first].start_ms,
      end_ms: words[last].end_ms,
      text: words
        .slice(first, last + 1)
        .map((w) => w.text)
        .join(' '),
      first_word: first,
      last_word: last,
    });
    first = last + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const endsSentence = SENTENCE_END.test(words[i].text);
    const longPause = next ? next.start_ms - words[i].end_ms >= pause : false;
    const tooLong = i - first + 1 >= maxWords || words[i].end_ms - words[first].start_ms >= maxMs;
    if (!next || endsSentence || longPause || tooLong) flush(i);
  }
  return segments;
}

/**
 * Put words into a full Transcript.
 * @param {import('../types.mjs').Word[]} words
 * @param {{language?: string, engine: import('../types.mjs').Transcript['engine'], quality?: 'precise'|'coarse'}} options
 * @returns {import('../types.mjs').Transcript}
 */
export function makeTranscript(words, options) {
  return {
    words,
    segments: buildSegments(words),
    language: options.language ?? 'en',
    quality: options.quality ?? 'precise',
    engine: options.engine,
  };
}

/**
 * Check a transcript. Returns plain sentences for each problem; empty means it is sound.
 * @param {import('../types.mjs').Transcript} transcript
 * @returns {string[]}
 */
export function validateTranscript(transcript) {
  /** @type {string[]} */
  const problems = [];
  const { words, segments } = transcript;
  if (!Array.isArray(words)) return ['The transcript has no word list.'];
  let prevStart = -1;
  let prevEnd = -1;
  words.forEach((word, i) => {
    if (!word.text) problems.push(`Word ${i} is empty.`);
    if (!(word.end_ms >= word.start_ms)) problems.push(`Word ${i} ("${word.text}") ends before it starts.`);
    if (word.start_ms < prevStart)
      problems.push(`Word ${i} ("${word.text}") starts before the word before it.`);
    if (word.start_ms < prevEnd) problems.push(`Word ${i} ("${word.text}") overlaps the word before it.`);
    prevStart = word.start_ms;
    prevEnd = word.end_ms;
  });
  segments.forEach((segment, i) => {
    if (
      segment.first_word < 0 ||
      segment.last_word >= words.length ||
      segment.last_word < segment.first_word
    ) {
      problems.push(`Segment ${i} points at words that do not exist.`);
    }
  });
  if (!TRANSCRIBE_ENGINES.includes(transcript.engine))
    problems.push(`Unknown engine "${transcript.engine}".`);
  return problems;
}

/** All the words as one string. @param {import('../types.mjs').Transcript} transcript */
export function transcriptText(transcript) {
  return transcript.words.map((w) => w.text).join(' ');
}
