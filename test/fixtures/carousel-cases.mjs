// Test data for the carousel renderer: text that fills every budget exactly, so layouts are tested at their limits.
import { LAYOUTS } from '../../core/carousel/registry.mjs';

const WORDS = [
  'people', 'share', 'plain', 'words', 'small', 'habits', 'steady', 'posts', 'every', 'single',
  'idea', 'reader', 'useful', 'clear', 'short', 'simple', 'week', 'saves', 'quickly', 'brings',
  'trust', 'growth', 'weekly', 'ritual', 'kind', 'honest', 'stories', 'learn', 'notice', 'screen',
];

/** Text of exactly n characters made of ordinary words (the last word may be cut short). */
export function exactly(n, seed = 0) {
  let out = '';
  let i = seed;
  while (out.length < n) {
    out += (out ? ' ' : '') + WORDS[i % WORDS.length];
    i += 7;
  }
  out = out.slice(0, n);
  return out.endsWith(' ') ? out.slice(0, -1) + 'x' : out;
}

/** Fields that fill every limit of a layout. photo-hero needs an image path. */
export function worstFields(layoutId, imagePath = '') {
  const l = LAYOUTS[layoutId];
  let seed = 3;
  /** @param {any} node */
  const make = (node) => {
    seed += 1;
    if (node.kind === 'text') return exactly(node.max, seed);
    if (node.kind === 'path') return imagePath;
    if (node.kind === 'list') return Array.from({ length: node.max }, () => make(node.of));
    return Object.fromEntries(Object.entries(node.shape).map(([k, v]) => [k, make(v)]));
  };
  return Object.fromEntries(Object.entries(l.fields).map(([k, v]) => [k, make(v)]));
}
