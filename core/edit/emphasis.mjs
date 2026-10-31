// Keyword emphasis: which spoken words get picked out in the captions, and in what color.
// Order of importance: numbers and money, then negations, superlatives, power verbs, named things, emotion words,
// and last long words. Little words are never picked. Pure functions.

/** Words that are never emphasized. */
const SKIP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'he', 'her', 'his', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your', 'im', 'dont', 'do',
  'does', 'did', 'just', 'really', 'very', 'gonna', 'going', 'get', 'got',
]);

const NEGATIONS = new Set(['never', 'stop', 'dont', 'not', 'no', 'avoid', 'quit', 'without', 'cant', 'wont', 'banned', 'illegal']);
const SUPERLATIVES = new Set([
  'best', 'worst', 'only', 'every', 'all', 'free', 'guaranteed', 'always', 'nothing', 'everything', 'biggest', 'fastest',
  'easiest', 'most',
]);
const POWER_VERBS = new Set([
  'doubled', 'tripled', 'failed', 'exploded', 'fired', 'hacked', 'broke', 'killed', 'destroyed', 'stole', 'crashed',
  'blew', 'flagged', 'blocked', 'deleted', 'exposed',
]);
const EMOTION_WORDS = new Set([
  'secret', 'mistake', 'truth', 'scam', 'hack', 'trick', 'warning', 'insane', 'crazy', 'wild', 'nobody', 'hidden',
  'lie', 'lying', 'wrong', 'problem',
]);
const KNOWN_ENTITIES = new Set([
  'chatgpt', 'claude', 'instagram', 'tiktok', 'youtube', 'google', 'openai', 'anthropic', 'canva', 'notion', 'ai',
  'meta', 'reels', 'shorts', 'linkedin', 'pinterest', 'threads', 'facebook', 'codex',
]);
const MONEY_WORDS = new Set(['money', 'revenue', 'profit', 'paid', 'sale', 'sales', 'cash', 'income', 'dollars', 'bucks']);
const WARNING_WORDS = new Set(['scam', 'warning', 'mistake', 'wrong', 'lie', 'lying', 'problem']);

// "one" is left out on purpose: it is too common in everyday speech to be worth a highlight.
const NUMBER_PATTERN = /^(?:\$?\d[\d,.]*%?|\d+(?:st|nd|rd|th)|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)$/u;

/** Score floor for a word to be worth picking. */
export const EMPHASIS_MIN_SCORE = 40;

/** Colors for emphasized words. */
export const SEMANTIC_COLORS = Object.freeze({
  highlight: '#FFD93D',
  money: '#00E64D',
  warning: '#FF1744',
  tech: '#00E5FF',
});

/**
 * Lowercase letters, numbers, dollar and percent signs only.
 * @param {string} word
 */
export function emphasisKey(word) {
  return String(word ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9$%]/gu, '');
}

/**
 * How worthy a word is of emphasis. 0 means never. Higher is stronger.
 * @param {string} word
 * @returns {number}
 */
export function emphasisScore(word) {
  const clean = emphasisKey(word);
  if (!clean || SKIP.has(clean)) return 0;
  if (NUMBER_PATTERN.test(clean)) return 100;
  if (NEGATIONS.has(clean)) return 88;
  if (SUPERLATIVES.has(clean)) return 76;
  if (POWER_VERBS.has(clean)) return 66;
  if (KNOWN_ENTITIES.has(clean)) return 56;
  if (EMOTION_WORDS.has(clean)) return 48;
  if (clean.length >= 7) return 18;
  return 6;
}

/**
 * The meaning of an emphasized word, which decides its color.
 * @param {string} word
 * @returns {'money'|'warning'|'highlight'}
 */
export function emphasisRole(word) {
  const clean = emphasisKey(word);
  if (clean.includes('$') || MONEY_WORDS.has(clean)) return 'money';
  if (NEGATIONS.has(clean) || WARNING_WORDS.has(clean)) return 'warning';
  return 'highlight';
}

/**
 * The color for a role. "semantic" gives yellow, green for money and red for warnings.
 * "accent" paints every emphasized word in the one accent color.
 * @param {'money'|'warning'|'highlight'|'tech'} role
 * @param {{mode?: 'semantic'|'accent', accent?: string}} [options]
 * @returns {string}
 */
export function emphasisColor(role, options = {}) {
  if (options.mode === 'accent' && options.accent) return options.accent;
  return SEMANTIC_COLORS[role] ?? SEMANTIC_COLORS.highlight;
}

/**
 * Pick the words to emphasize across a whole reel. About one word per nine spoken words, the strongest first,
 * no word twice, never two next to each other.
 * @param {{text:string}[]} words   Spoken words in order.
 * @param {{per_words?: number, max?: number, min_score?: number}} [options]
 * @returns {{position:number, score:number, role:'money'|'warning'|'highlight'}[]}  Positions in `words`, in order.
 */
export function selectEmphasis(words, options = {}) {
  const perWords = options.per_words ?? 9;
  const max = options.max ?? 24;
  const minScore = options.min_score ?? EMPHASIS_MIN_SCORE;
  if (words.length === 0) return [];
  const budget = Math.min(max, Math.max(1, Math.round(words.length / perWords)));
  const scored = words
    .map((w, position) => ({ position, key: emphasisKey(w.text), score: emphasisScore(w.text) }))
    .filter((e) => e.score >= minScore && e.key.length > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position);
  /** @type {typeof scored} */
  const chosen = [];
  const seen = new Set();
  const taken = new Set();
  for (const e of scored) {
    if (chosen.length >= budget) break;
    if (seen.has(e.key)) continue;
    if (taken.has(e.position - 1) || taken.has(e.position + 1)) continue;
    chosen.push(e);
    seen.add(e.key);
    taken.add(e.position);
  }
  return chosen
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ position: e.position, score: e.score, role: emphasisRole(words[e.position].text) }));
}
