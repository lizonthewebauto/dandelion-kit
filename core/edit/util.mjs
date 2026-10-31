// Small pure helpers shared by the edit brain: seeded random numbers, stable hashing, word cleaning.
// No file or network access in this folder. Same inputs always give the same outputs.
import { createHash } from 'node:crypto';

/** @param {number} n @param {number} lo @param {number} hi */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Round to whole milliseconds. @param {number} n */
export const roundMs = (n) => Math.round(n);

/** Round a zoom factor to four decimals. @param {number} n */
export const roundZoom = (n) => Math.round(n * 10000) / 10000;

/**
 * Turn any seed (number or string) into an unsigned 32 bit number.
 * @param {number|string|undefined|null} seed
 * @returns {number}
 */
export function seedToUint(seed) {
  const numeric = Number(seed);
  if (seed !== '' && seed !== null && seed !== undefined && Number.isFinite(numeric)) {
    return Math.abs(Math.trunc(numeric)) >>> 0;
  }
  let hash = 2166136261;
  for (const ch of String(seed ?? 'dandelion-kit')) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A small seeded random number generator. Returns numbers in [0, 1).
 * @param {number|string} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  let state = seedToUint(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * JSON with sorted keys, so equal values always give equal text.
 * @param {any} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Short content hash of any JSON-like value.
 * @param {any} value
 * @param {number} [length]
 * @returns {string}
 */
export function hashOf(value, length = 16) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, length);
}

/**
 * Lowercase letters, numbers and apostrophes only. Used to compare spoken words.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWord(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .trim();
}

/** Words too common to carry meaning. */
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'he', 'her', 'his', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your', 'im', 'dont', 'do',
  'does', 'did', 'just', 'really', 'very', 'gonna', 'going', 'get', 'got', 'about', 'can', 'what', 'when', 'how',
  'than', 'too', 'also', 'been', 'being', 'would', 'could', 'should', 'these', 'those', 'some', 'any', 'out', 'up',
  'one', 'like', 'more', 'most', 'make', 'way',
]);

/** @param {string} word */
export const isStopword = (word) => STOPWORDS.has(normalizeWord(word).replace(/'/g, ''));
