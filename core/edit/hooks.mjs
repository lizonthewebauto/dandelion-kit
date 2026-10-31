// Hooks: the first two seconds. Eighteen hook shapes as fill-in templates, a deterministic 100 point scorer,
// and a helper that suggests hooks from what was actually said. Nothing here calls a model or reads a file.
//
// Hard rules (a hook that breaks one is rejected and scores 0):
//   - nine words or fewer
//   - no em dash, en dash or spaced hyphen
//   - no hype openers or hype phrases
// Soft rules are the score. A hook passes at 70 or more.
import { isStopword, makeRng, normalizeWord } from './util.mjs';

export const HOOK_LIMITS = Object.freeze({
  max_words: 9,
  pass_score: 70,
  /** The spoken opening line, at most this many words. */
  spoken_max_words: 10,
  /** On-screen hook text uses 3 to 7 words that differ from the spoken line. */
  screen_words_min: 3,
  screen_words_max: 7,
  /** Points lost when the on-screen hook just repeats the spoken opening. */
  restate_penalty: 25,
  restate_overlap: 0.6,
});

/** Most points each part of the score can earn. They add up to 100. */
export const HOOK_WEIGHTS = Object.freeze({
  curiosity: 18,
  specificity: 18,
  promise: 18,
  interrupt: 14,
  brevity: 12,
  stakes: 10,
  reading: 10,
});

/** Openers that waste the first second. */
export const BANNED_OPENERS = Object.freeze([
  "in today's video",
  'welcome back',
  'hey guys',
  'hi guys',
  'hey everyone',
  "what's up",
  'what is up',
  'so today',
  "today i'm going to",
  'let me show you',
  'are you ready',
  'before we start',
]);

/** Hype that readers have learned to ignore. */
export const BANNED_HYPE = Object.freeze([
  'game changer',
  'game-changer',
  'mind blowing',
  'mind-blowing',
  'blow your mind',
  "you won't believe",
  'you wont believe',
  'life changing',
  'life-changing',
  'jaw dropping',
  'jaw-dropping',
  'revolutionary',
  'skyrocket',
  'supercharge',
  'unleash',
  'next level',
  'insane',
]);

const DASH_RE = /[\u2013\u2014]|--|\s-\s/u;

/**
 * The eighteen shapes. `template` is for people; `fill` has {slot} markers the code fills in.
 * @typedef {object} HookFormula
 * @property {string} id
 * @property {string} name
 * @property {string} template
 * @property {string} fill
 * @property {string[]} slots
 * @property {string} when_to_use
 * @property {string} example
 * @property {string[]} signals      Lowercase regex sources that tag a hook as already using this shape.
 */

/** @type {readonly HookFormula[]} */
export const HOOK_FORMULAS = Object.freeze([
  { id: 'capability-claim', name: 'Plain capability claim', template: '[Tool] can [surprising job]', fill: '{tool} can {job}', slots: ['tool', 'job'], when_to_use: 'The video shows a named tool doing one surprising, specific job.', example: 'Claude can turn one video into ten posts', signals: ['\\b(chatgpt|claude|gemini|notion|canva|instagram|tiktok|codex) (can|just|now)\\b', '\\bcan (find|make|build|write|erase|fix|read|turn)\\b'] },
  { id: 'numbered-promise', name: 'Numbered promise', template: '[N] [things] that [outcome]', fill: '{count} {things} that {outcome}', slots: ['count', 'things', 'outcome'], when_to_use: 'The video teaches a countable set: tools, prompts, steps.', example: '3 free tools that replace your editor', signals: ['^(two|three|four|five|six|seven|eight|nine|ten|\\d+)\\b'] },
  { id: 'forbidden-knowledge', name: 'Forbidden knowledge', template: 'Nobody tells you [thing] about [topic]', fill: 'Nobody tells you this about {topic}', slots: ['topic'], when_to_use: 'The video shows something real that is under-covered.', example: 'Nobody tells you this about captions', signals: ['\\bnobody (tells|talks|knows)\\b', '\\bno one (tells|talks|knows)\\b', '\\bnobody\\b'] },
  { id: 'loss-framing', name: 'Loss framing', template: 'You lose [amount] every [period] to [cause]', fill: 'You lose {amount} every {period} to {cause}', slots: ['amount', 'period', 'cause'], when_to_use: 'The video fixes a steady leak of time, money or quality.', example: 'You lose two hours a week on captions', signals: ['\\byou(\\s+a|\')?re losing\\b', '\\byou lose\\b', '\\bcosting you\\b', '\\byou are wasting\\b', '\\byou waste\\b', '\\bdraining\\b'] },
  { id: 'direct-callout', name: 'Direct callout', template: 'If you [habit], stop', fill: 'If you {habit}, stop', slots: ['habit'], when_to_use: 'The video fixes a habit the viewer did this week.', example: 'If you edit on your phone, stop', signals: ['^if you\\b', '\\bif you .*(stop|read this|watch this)\\b', '^for anyone\\b', '^pov\\b'] },
  { id: 'most-people-wrong', name: 'Most people get this wrong', template: 'Most people [do the thing] wrong', fill: 'Most people {action} wrong', slots: ['action'], when_to_use: 'The video shows a right way that looks obvious once seen.', example: 'Most people trim their videos wrong', signals: ['\\bmost people\\b', '\\bdoing .* wrong\\b', '\\busing .* wrong\\b', '\\bset(s|ting)? .* wrong\\b'] },
  { id: 'myth-bust', name: 'Myth bust', template: '[Common belief] is wrong', fill: '{belief} is wrong', slots: ['belief'], when_to_use: 'The video contradicts advice the audience has heard everywhere.', example: 'Posting daily is not the fix', signals: ['\\bis wrong\\b', '\\bmyth\\b', '\\bis dead\\b', '\\bstop believing\\b', '\\bnot the (fix|answer|problem)\\b'] },
  { id: 'first-person-receipt', name: 'I did the thing', template: 'I [drastic action] and [result]', fill: 'I {action} and {result}', slots: ['action', 'result'], when_to_use: 'The speaker really did it and the video shows the result.', example: 'I fired my editor and saved two hours', signals: ['^i (fired|built|replaced|quit|deleted|stopped|used|logged)\\b', '^so i \\w+'] },
  { id: 'before-after', name: 'Before and after', template: '[Before]. [After] now.', fill: '{before} before. {after} now.', slots: ['before', 'after'], when_to_use: 'The video shows a change you can see in two frames.', example: 'Messy clips before. Clean reels now.', signals: ['\\bbefore\\b.*\\b(now|after)\\b', '\\bused to\\b.*\\bnow\\b', '\\bthen\\b.*\\bnow\\b', '\\bis the new\\b'] },
  { id: 'time-boxed-promise', name: 'Time boxed promise', template: 'In [N] seconds you will [skill]', fill: 'In {count} {unit} you will {skill}', slots: ['count', 'unit', 'skill'], when_to_use: 'The edit really delivers the whole thing inside that window.', example: 'In 30 seconds your reel gets cleaner', signals: ['^in \\d+ (second|minute|day|week)', '\\bin (one|two|three|five|ten|thirty|sixty|\\d+) (seconds?|minutes?|hours?|days?)\\b'] },
  { id: 'receipts-first', name: 'Receipts first', template: '[Real number] [what it measured]', fill: '{number} {noun}. {source}.', slots: ['number', 'noun', 'source'], when_to_use: 'A real number or screenshot is on screen in the first frame.', example: 'This cut removed 41 seconds of filler', signals: ['\\b\\d{2,}\\b', '\\$\\d', '\\d+%'] },
  { id: 'what-happens-when', name: 'What happens when', template: 'What happens when you [outrageous job]?', fill: 'What happens when you {job}?', slots: ['job'], when_to_use: 'The job sounds too big for the tool and the video shows it working.', example: 'What happens when you cut every pause?', signals: ['^what happens when\\b', '^why (does|do|is|are)\\b', '^what (does|do|is|are)\\b', '\\?$'] },
  { id: 'direct-command', name: 'Direct command', template: '[Verb] [thing] before [consequence]', fill: '{verb} {thing} before {consequence}', slots: ['verb', 'thing', 'consequence'], when_to_use: 'There is one move the viewer can make right now.', example: 'Delete your first sentence before posting', signals: ["^(stop|type|delete|check|never|read|watch|steal|copy|save|add|paste|turn|open|try|fix|quit|do not|don't)\\b"] },
  { id: 'tested-for-you', name: 'I tested it for you', template: 'I tested [thing] for [period]', fill: 'I tested {thing} for {period}', slots: ['thing', 'period'], when_to_use: 'The test really happened and clips from it are in the edit.', example: 'I tested 12 caption styles in a week', signals: ['^i tested\\b', '\\bso you do(\\s+not|n\'t)? have to\\b', '^i tried\\b'] },
  { id: 'status-fomo', name: 'Who is getting ahead', template: '[Group] [does this]. Everyone else [does that].', fill: '{leaders} {does}. Everyone else {other}.', slots: ['leaders', 'does', 'other'], when_to_use: 'The shift is real and recent, and the video shows it.', example: 'Top creators cut this. Everyone else keeps it.', signals: ['\\beveryone else\\b', '\\bpower users\\b', '\\bgetting ahead\\b', '\\bthe rest of us\\b'] },
  { id: 'one-lever', name: 'One lever', template: 'One [small thing] [big outcome]', fill: 'One {lever} {outcome}', slots: ['lever', 'outcome'], when_to_use: 'A single small input causes a big visible change.', example: 'One small tweak makes your clips faster', signals: ['^one \\w+', '\\bone (word|line|code|prompt|click|setting|file)\\b'] },
  { id: 'mistake-autopsy', name: 'Mistake autopsy', template: 'The mistake everyone makes with [topic]', fill: 'The mistake everyone makes with {topic}', slots: ['topic'], when_to_use: 'The viewer probably made this mistake in the last week.', example: 'The mistake everyone makes with captions', signals: ['\\bmistake\\b', '\\bgetting .* wrong\\b', '\\bbiggest mistake\\b'] },
  { id: 'cheap-beats-expensive', name: 'Free beats paid', template: 'This free [tool] beats the [paid] one', fill: 'This free {tool} beats the {paid} one', slots: ['tool', 'paid'], when_to_use: 'Both things are named and both are on screen.', example: 'This free app beats the paid one', signals: ['\\bfree\\b.*\\b(beats|better than)\\b', '\\bbeats the\\b', '\\bwithout paying\\b'] },
]);

const FORMULA_BY_ID = new Map(HOOK_FORMULAS.map((f) => [f.id, f]));
const COMPILED = HOOK_FORMULAS.map((f) => ({ id: f.id, patterns: f.signals.map((s) => new RegExp(s, 'iu')) }));

/** @param {string} id */
export const getFormula = (id) => FORMULA_BY_ID.get(id);

/**
 * Fill a hook shape with words. Returns null when a slot is missing.
 * @param {string} id
 * @param {Record<string, string|number>} slots
 * @returns {string|null}
 */
export function fillFormula(id, slots) {
  const f = FORMULA_BY_ID.get(id);
  if (!f) return null;
  for (const s of f.slots) if (slots[s] === undefined || String(slots[s]).trim() === '') return null;
  const text = f.fill.replace(/\{(\w+)\}/g, (_, key) => String(slots[key]).trim()).replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Which shape a hook already uses, or "custom".
 * @param {string} text
 * @returns {string}
 */
export function detectFormula(text) {
  const t = String(text ?? '').trim();
  for (const f of COMPILED) if (f.patterns.some((p) => p.test(t))) return f.id;
  return 'custom';
}

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

const NUMBER_WORDS = new Set(['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve', 'twenty', 'thirty', 'fifty', 'hundred', 'thousand', 'million']);
const KNOWN_TOOLS = new Set(['chatgpt', 'claude', 'gemini', 'notion', 'canva', 'instagram', 'tiktok', 'youtube', 'google', 'openai', 'ai', 'reels', 'shorts', 'linkedin', 'pinterest', 'threads', 'facebook', 'codex', 'capcut', 'excel', 'zoom']);
const EASY_LONG = new Set(['everyone', 'everything', 'yesterday', 'somebody', 'something', 'sometimes', 'tomorrow', 'everybody', 'different']);
const OUTCOME_VERBS = /\b(stop|fix|save|find|build|write|erase|get|gets|turn|cut|cuts|double|learn|replace|replaces|beat|beats|win|land|fire|fired|hire|delete|avoid|skip|steal|copy|try|tried|test|tested|remove|removed|trim|grow|clean|cleaner|faster|better|rewrite|automate|stops|makes|make)\b/iu;
const TEASE_NOBODY = /\b(nobody|no one|hidden|forbidden|real reason|truth|secret|behind the scenes)\b/iu;
const TEASE_WRONG = /\b(wrong|mistake|myth|lie|lying|lies|not the fix|is dead|stop believing|never)\b/iu;
const TEASE_ONE = /\b(one (thing|word|line|file|setting|click|prompt|tweak|fix)|this one|here's why|here is why|this)\b/iu;
const TEASE_QUESTION = /\?\s*$|^(why|what|how|who|when|did you)\b/iu;
const TEASE_CONTRAST = /\b(instead|versus|vs|before|now|but|everyone else|the rest)\b/iu;
const STAKES_RE = /\b(lose|losing|lost|cost|costing|waste|wasting|wasted|money|cash|hours?|minutes?|days?|weeks?|free|fired|broke|risk|banned|deleted|mistake|wrong|lie|lying|stop|never|worst|scam|fail|failing|ruin|stuck|filler|pause|pauses|save|saves|grow|double|faster|cleaner|better|replace|replaces|beats|beat|win|extra|turn|remove|removed|cuts)\b/giu;
const COMPARE_RE = /\b(before|now|else|than|beats|instead|versus|vs)\b/iu;
const SPELLED_START = /^(one|two|three|four|five|six|seven|eight|nine|ten)\b/iu;
const INTERRUPT_FORMULAS = new Set(['direct-command', 'direct-callout', 'myth-bust', 'most-people-wrong', 'forbidden-knowledge', 'loss-framing', 'status-fomo', 'first-person-receipt', 'what-happens-when']);
const STAKES_FORMULAS = new Set(['loss-framing', 'status-fomo', 'cheap-beats-expensive', 'receipts-first', 'tested-for-you', 'mistake-autopsy']);
const IMPERATIVE_START = /^(stop|don't|dont|do not|never|delete|quit|avoid|wait|warning|check|type|read|watch|steal|copy|save|add|paste|turn|open|try|fix|skip|cut|trim|keep|write|post|send|start|use|if you)\b/iu;

/** @param {string} text */
const wordsOf = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

/** @param {string} word */
function syllables(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  const groups = (clean.replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length;
  return Math.max(1, groups);
}

/** @param {string} text */
function contentWords(text) {
  return wordsOf(text)
    .map((w) => normalizeWord(w))
    .filter((w) => w && !isStopword(w));
}

/** @param {string} text */
function hasNamedThing(text) {
  const words = wordsOf(text);
  return words.some((raw, i) => {
    const clean = raw.replace(/[^A-Za-z]/g, '');
    if (!clean) return false;
    if (KNOWN_TOOLS.has(clean.toLowerCase())) return true;
    if (/^[A-Z]{3,}$/.test(clean)) return true;
    const prev = i > 0 ? words[i - 1] : '';
    return i > 0 && !/[.!?]$/.test(prev) && /^[A-Z][a-z]+$/.test(clean);
  });
}

/**
 * @typedef {object} HookScore
 * @property {string} text
 * @property {number} score          0 to 100. Rejected hooks score 0.
 * @property {boolean} pass          True when not rejected and the score is at least 70.
 * @property {boolean} rejected      True when a hard rule is broken.
 * @property {string[]} reasons      Plain sentences: why it was rejected, or what lost points.
 * @property {string} formula        The shape it uses, or "custom".
 * @property {number} word_count
 * @property {Record<keyof typeof HOOK_WEIGHTS, number>} parts
 */

/**
 * Score one on-screen hook.
 * @param {string} text
 * @param {{spoken_opening?: string, formula_bonus?: boolean}} [options]
 *   `spoken_opening` is the first spoken line, to catch a hook that only repeats it. `formula_bonus: false` withholds
 *   every point a hook earns just for fitting one of the eighteen shapes. The suggester uses it when a template was
 *   filled with a single generic word, which should not earn credit for the template alone.
 * @returns {HookScore}
 */
export function scoreHook(text, options = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const words = wordsOf(raw);
  const lower = raw.toLowerCase().replace(/\u2019/g, "'");
  /** @type {string[]} */
  const reasons = [];
  /** @type {HookScore['parts']} */
  const parts = { curiosity: 0, specificity: 0, promise: 0, interrupt: 0, brevity: 0, stakes: 0, reading: 0 };
  const formula = detectFormula(raw);

  if (words.length === 0) reasons.push('The hook is empty.');
  if (words.length > HOOK_LIMITS.max_words) reasons.push(`The hook has ${words.length} words. The limit is ${HOOK_LIMITS.max_words}.`);
  if (DASH_RE.test(raw)) reasons.push('The hook has a dash. Use a period or a comma.');
  for (const phrase of BANNED_OPENERS) if (lower.startsWith(phrase)) reasons.push(`The hook opens with "${phrase}", which wastes the first second.`);
  for (const phrase of BANNED_HYPE) if (new RegExp(`\\b${phrase.replace(/[-\s]/g, '[-\\s]')}\\b`, 'iu').test(lower)) reasons.push(`The hook uses "${phrase}", which readers skip.`);
  if (reasons.length > 0) {
    return { text: raw, score: 0, pass: false, rejected: true, reasons, formula, word_count: words.length, parts };
  }

  const n = words.length;
  const content = contentWords(raw);
  const startsWithDigit = /^[\d$]/.test(raw);
  const hasDigit = /\d/.test(raw);
  const spelled = words.some((w) => NUMBER_WORDS.has(normalizeWord(w)));
  const named = hasNamedThing(raw);
  const formulaMatched = formula !== 'custom' && options.formula_bonus !== false;

  // Brevity: short reads at a glance. Under three words says too little.
  parts.brevity = n <= 2 ? 4 : n === 3 ? 9 : n <= 6 ? 12 : n === 7 ? 10 : n === 8 ? 8 : 6;

  // Specificity: numbers and named things beat vague words.
  parts.specificity = Math.min(
    HOOK_WEIGHTS.specificity,
    (hasDigit ? 8 : spelled ? 5 : 0) +
      (named ? 6 : 0) +
      (content.length >= 4 ? 6 : content.length >= 3 ? 5 : content.length >= 2 ? 3 : 0) +
      (/\b(every|each|first|last|only|free)\b/iu.test(lower) ? 2 : 0) +
      (formulaMatched && content.length >= 3 ? 3 : 0),
  );

  // Curiosity: something is held back, or a belief is poked.
  let curiosity = 0;
  if (TEASE_QUESTION.test(raw)) curiosity += 6;
  if (TEASE_NOBODY.test(lower)) curiosity += 8;
  if (TEASE_WRONG.test(lower)) curiosity += 7;
  if (TEASE_ONE.test(lower)) curiosity += 5;
  if (TEASE_CONTRAST.test(lower)) curiosity += 5;
  if (formulaMatched) curiosity += 8;
  parts.curiosity = Math.min(HOOK_WEIGHTS.curiosity, curiosity);

  // Promise: the viewer can tell what they get.
  let promise = 0;
  if (OUTCOME_VERBS.test(lower)) promise += 8;
  if ((hasDigit || spelled) && content.length >= 2) promise += 5;
  if (/\b(in \d+|in (one|two|three|five|ten|thirty|sixty)|without|so you|how to|you will|your)\b/iu.test(lower)) promise += 6;
  if (/\b(tells? you|this about|here'?s|here is|the (reason|truth|real))\b/iu.test(lower)) promise += 8;
  if (named && content.length >= 3) promise += 2;
  if (formulaMatched) promise += 5;
  parts.promise = Math.min(HOOK_WEIGHTS.promise, promise);

  // Pattern interrupt: a command, a callout, a negation or a number up front.
  let interrupt = 0;
  if (IMPERATIVE_START.test(raw)) interrupt += 6;
  if (/\byou(r)?\b|\bif you\b|\beveryone\b|\bmost people\b|\bnobody\b/iu.test(lower)) interrupt += 4;
  if (/\b(not|never|no|nobody|wrong|without|stop|don't|dont)\b/iu.test(lower)) interrupt += 4;
  if (startsWithDigit || SPELLED_START.test(raw)) interrupt += 3;
  if (COMPARE_RE.test(lower)) interrupt += 4;
  if (words.length > 0 && KNOWN_TOOLS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) interrupt += 3;
  if (/\b[A-Z]{3,}\b/.test(raw)) interrupt += 2;
  if (/\b(delete|fired|quit|erase|kill|ban|cut|removed)\w*\b/iu.test(lower)) interrupt += 3;
  if (formulaMatched && INTERRUPT_FORMULAS.has(formula)) interrupt += 5;
  if (formulaMatched) interrupt += 2;
  parts.interrupt = Math.min(HOOK_WEIGHTS.interrupt, interrupt);

  // Stakes: something is lost or gained.
  const stakesHits = new Set((lower.match(STAKES_RE) ?? []).map((s) => s.toLowerCase()));
  let stakes = Math.min(3, stakesHits.size) * 4;
  if (/\$\d|\d+%/.test(raw)) stakes += 4;
  if (/\b(every|always|daily|a day|a week|per|faster|cleaner|better)\b/iu.test(lower)) stakes += 3;
  if (formulaMatched && STAKES_FORMULAS.has(formula)) stakes += 3;
  parts.stakes = Math.min(HOOK_WEIGHTS.stakes, stakes);

  // Reading level: short, common words.
  const hard = words
    .map((w) => w.toLowerCase().replace(/[^a-z-]/g, ''))
    .filter((w) => w && !KNOWN_TOOLS.has(w) && !EASY_LONG.has(w) && !NUMBER_WORDS.has(w))
    .filter((w) => (syllables(w) >= 3 && w.length >= 8) || w.length >= 12);
  const avgSyllables = words.reduce((s, w) => s + syllables(w), 0) / Math.max(1, n);
  parts.reading = Math.max(0, Math.min(HOOK_WEIGHTS.reading, 10 - hard.length * 4 - (avgSyllables > 1.7 ? 2 : 0)));
  if (hard.length > 0) reasons.push(`Hard words: ${hard.join(', ')}. Pick plainer ones.`);

  let score = Object.values(parts).reduce((s, v) => s + v, 0);

  // A hook that only repeats the spoken opening adds nothing.
  if (options.spoken_opening) {
    const spoken = new Set(contentWords(wordsOf(options.spoken_opening).slice(0, 12).join(' ')));
    const mine = content;
    const overlap = mine.length > 0 ? mine.filter((w) => spoken.has(w)).length / mine.length : 0;
    if (overlap >= HOOK_LIMITS.restate_overlap) {
      score -= HOOK_LIMITS.restate_penalty;
      reasons.push('The hook repeats the spoken opening. Say something different on screen.');
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (parts.curiosity < 6) reasons.push('Hold something back so people want the answer.');
  if (parts.specificity < 8) reasons.push('Add a number or name the tool.');
  if (parts.promise < 7) reasons.push('Say what the viewer gets.');
  return { text: raw, score, pass: score >= HOOK_LIMITS.pass_score, rejected: false, reasons, formula, word_count: n, parts };
}

/** Same as scoreHook. Kept as the short name used across the kit. */
export const score = scoreHook;

/**
 * The three things that happen in the first 1.5 seconds: the spoken line, the on-screen text, the picture.
 * @param {{spoken: string, screen: string, picture_moves: boolean}} channels
 * @returns {{ok: boolean, issues: string[]}}
 */
export function checkThreeChannels(channels) {
  const issues = [];
  const spoken = wordsOf(channels.spoken);
  const screen = wordsOf(channels.screen);
  if (spoken.length > HOOK_LIMITS.spoken_max_words) issues.push(`The spoken line has ${spoken.length} words. Keep it to ${HOOK_LIMITS.spoken_max_words}.`);
  if (screen.length < HOOK_LIMITS.screen_words_min || screen.length > HOOK_LIMITS.screen_words_max) {
    issues.push(`The on-screen text has ${screen.length} words. Use ${HOOK_LIMITS.screen_words_min} to ${HOOK_LIMITS.screen_words_max}.`);
  }
  const spokenSet = new Set(contentWords(channels.spoken));
  const mine = contentWords(channels.screen);
  if (mine.length > 0 && mine.filter((w) => spokenSet.has(w)).length / mine.length > 0.5) issues.push('The on-screen text repeats the spoken line. Use different words.');
  if (!channels.picture_moves) issues.push('The first frame is a still face. Open on motion.');
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Suggestions from what was said
// ---------------------------------------------------------------------------

const GENERIC_TOPIC_WORDS = new Set([
  'thing', 'things', 'video', 'videos', 'today', 'people', 'know', 'think', 'going', 'want', 'need', 'makes', 'really',
  'actually', 'something', 'because', 'before', 'after', 'would', 'could', 'should', 'there', 'their', 'right', 'first',
  'second', 'third', 'every', 'here', 'where', 'while', 'still', 'again', 'always', 'never', 'another', 'little',
  'hello', 'okay', 'yeah', 'much', 'many', 'even', 'only', 'back', 'take', 'time', 'times', 'give', 'show', 'look',
  'down', 'over', 'with', 'what', 'when', 'your', 'from', 'have', 'been', 'were', 'them', 'then', 'than', 'that', 'this',
  'just', 'like', 'most', 'also', 'into', 'about', 'which', 'said', 'does', 'done', 'doing', 'seconds', 'minutes', 'hours', 'mistake', 'mistakes', 'biggest', 'faster', 'better', 'best', 'worst', 'edit', 'cut', 'pick', 'drop', 'takes', 'wants', 'makes', 'follow', 'tips',
  'between', 'difference', 'differences', 'huge', 'through', 'without', 'within', 'across', 'around', 'others', 'other', 'whole', 'those', 'these', 'having', 'getting', 'being', 'thats', 'theres', 'maybe', 'quite', 'pretty', 'super', 'kind', 'sort', 'such',
]);

/** Words that never carry a hook on their own ("info", "flag"), though they can sit inside a longer phrase. */
const NOT_ALONE = new Set(['info', 'flag', 'stuff', 'label', 'labels', 'content', 'image', 'images', 'tool', 'tools', 'free', 'work', 'works', 'ways', 'part', 'parts', 'kind', 'lots', 'bunch', 'whole', 'data', 'post', 'posts', 'story', 'idea', 'ideas', 'point', 'case', 'result', 'results']);

/** How a named tool is written on screen. */
const TOOL_DISPLAY = new Map([
  ['ai', 'AI'], ['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['gemini', 'Gemini'], ['notion', 'Notion'], ['canva', 'Canva'],
  ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['google', 'Google'], ['openai', 'OpenAI'],
  ['reels', 'Reels'], ['shorts', 'Shorts'], ['linkedin', 'LinkedIn'], ['pinterest', 'Pinterest'], ['threads', 'Threads'],
  ['facebook', 'Facebook'], ['codex', 'Codex'], ['capcut', 'CapCut'], ['excel', 'Excel'], ['zoom', 'Zoom'],
]);

/** A topic earns the template bonus when it names a tool or is a phrase of two or more words. @param {string} topic */
export const isStrongTopic = (topic) => /\s/.test(topic.trim()) || KNOWN_TOOLS.has(topic.trim().toLowerCase());

const COMMAND_START = /^(stop|don't|dont|never|delete|check|type|read|watch|copy|save|add|paste|turn|open|try|fix|skip|cut|trim|keep|write|post|send|start|use|avoid|remove)\b/iu;

/**
 * Pull the raw material for hooks out of the spoken text.
 * @param {string} text
 */
export function extractMaterial(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const rawWords = wordsOf(clean);

  // Topics, best first: repeated phrases, then named tools, then single words that carry meaning on their own.
  const phrases = repeatedPhrases(clean);
  const tools = [];
  const seenTool = new Set();
  for (const w of rawWords) {
    const key = w.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (KNOWN_TOOLS.has(key) && !seenTool.has(key)) {
      seenTool.add(key);
      tools.push(TOOL_DISPLAY.get(key) ?? key);
    }
  }
  const counts = new Map();
  const order = new Map();
  rawWords.forEach((raw, i) => {
    const w = normalizeWord(raw);
    if (w.length < 5 || !/^[a-z]+$/.test(w) || NUMBER_WORDS.has(w) || /ly$/.test(w) || isStopword(w) || GENERIC_TOPIC_WORDS.has(w) || NOT_ALONE.has(w)) return;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (!order.has(w)) order.set(w, i);
  });
  // Nouns make better topics than verbs: plural words first, then longer words, then the earlier one.
  const nounish = (/** @type {string} */ w) => (/(s|ing)$/.test(w) && !/ss$/.test(w) ? 1 : 0);
  const singles = [...counts.keys()].filter((w) => (counts.get(w) ?? 0) >= 2).sort(
    (a, b) => counts.get(b) - counts.get(a) || nounish(b) - nounish(a) || b.length - a.length || order.get(a) - order.get(b),
  );
  const lowerTools = new Set(tools.map((t) => t.toLowerCase()));
  const topics = [...new Set([...phrases, ...tools.filter((t) => t !== 'AI' || phrases.length === 0), ...singles.filter((w) => !lowerTools.has(w) && !phrases.some((p) => p.toLowerCase().split(' ').includes(w)))])];

  const numbers = [];
  const numRe = /\b(\d{1,4})\s+(seconds?|minutes?|hours?|days?|weeks?|years?|tools?|ways?|steps?|tips?|mistakes?|things?|words?|clips?|posts?|reasons?)\b/giu;
  for (const m of clean.matchAll(numRe)) numbers.push({ value: Number(m[1]), unit: m[2].toLowerCase() });
  const sentences = clean.split(/(?<=[.?!])\s+/u);
  const command = sentences.map((s) => wordsOf(s.replace(/[.?!]+$/u, ''))).find((w) => w.length >= 3 && w.length <= HOOK_LIMITS.max_words && COMMAND_START.test(w.join(' ')));
  return { topics, phrases, numbers, command: command ? command.join(' ') : null, tools };
}

/**
 * Phrases of two or three content words that are said at least twice, best first, in the speaker's own casing.
 * A phrase inside a longer repeated phrase is dropped ("AI info" gives way to "AI info flag"). Each phrase has at
 * least one word that means something on its own: a named tool, or a plain word of five letters or more.
 * @param {string} clean
 * @returns {string[]}
 */
function repeatedPhrases(clean) {
  /** @type {Map<string, {count: number, shown: string, len: number, tool: boolean}>} */
  const found = new Map();
  for (const clause of clean.split(/[.?!,;:]+\s*/u)) {
    const toks = wordsOf(clause).map((raw) => {
      const norm = normalizeWord(raw);
      const letters = raw.replace(/[^A-Za-z]/g, '');
      const ok = /^[a-z]+$/.test(norm) && norm.length >= 2 && !isStopword(norm) && !GENERIC_TOPIC_WORDS.has(norm) && !NUMBER_WORDS.has(norm) && !/ly$/.test(norm);
      const tool = KNOWN_TOOLS.has(letters.toLowerCase());
      const shown = tool ? (TOOL_DISPLAY.get(letters.toLowerCase()) ?? letters) : letters;
      return { norm, ok, tool, shown, strong: tool || (norm.length >= 5 && !NOT_ALONE.has(norm)) };
    });
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const slice = toks.slice(i, i + n);
        if (!slice.every((t) => t.ok) || !slice.some((t) => t.strong)) continue;
        const key = slice.map((t) => t.norm).join(' ');
        const hit = found.get(key);
        if (hit) hit.count += 1;
        else found.set(key, { count: 1, shown: slice.map((t) => t.shown).join(' '), len: n, tool: slice.some((t) => t.tool) });
      }
    }
  }
  const repeated = [...found.entries()].filter(([, v]) => v.count >= 2);
  const keys = repeated.map(([k]) => k);
  const kept = repeated.filter(([k]) => !keys.some((other) => other !== k && other.length > k.length && (other.startsWith(k + ' ') || other.endsWith(' ' + k))));
  const value = (/** @type {{count: number, len: number, tool: boolean}} */ v) => v.count + 1.5 * (v.len - 1) + (v.tool ? 2 : 0);
  return kept
    .sort((a, b) => value(b[1]) - value(a[1]) || b[1].len - a[1].len)
    .map(([, v]) => v.shown);
}

/**
 * @typedef {object} HookCandidate
 * @property {string} text
 * @property {string} formula
 * @property {number} score
 */

/**
 * Suggest hooks that fit what was said. The host model can add its own with `slots` or by passing hook_text
 * to the shot plan; every candidate is scored the same way.
 * @param {string} spokenText   The cut reel's words as one string.
 * @param {{slots?: Record<string, Record<string, string|number>>, seed?: number|string, limit?: number}} [options]
 *   `slots` maps a formula id to the words that fill it.
 * @returns {HookCandidate[]}  Best first. Rejected hooks are left out.
 */
export function suggestHooks(spokenText, options = {}) {
  const m = extractMaterial(spokenText);
  const opening = wordsOf(spokenText).slice(0, 12).join(' ');
  /** The topic as it reads in a sentence: "the AI info flag", "Instagram", "captions". @param {string} t */
  const np = (t) => (KNOWN_TOOLS.has(t.toLowerCase()) || /s$/i.test(t) ? t : `the ${t}`);
  const topics = [...new Set(m.topics)].slice(0, 3);
  const topic = topics[0];
  /** @type {{formula:string,text:string|null,strong:boolean,copies?:boolean}[]} */
  const raw = [];
  // Words the agent supplied for a shape are its own choice, so the shape keeps its credit.
  for (const [id, slots] of Object.entries(options.slots ?? {})) raw.push({ formula: id, text: fillFormula(id, slots), strong: true });
  topics.forEach((t, i) => {
    const strong = isStrongTopic(t);
    raw.push({ formula: 'most-people-wrong', text: `Most people get ${np(t)} wrong`, strong });
    raw.push({ formula: 'forbidden-knowledge', text: fillFormula('forbidden-knowledge', { topic: np(t) }), strong });
    if (i === 0) raw.push({ formula: 'mistake-autopsy', text: fillFormula('mistake-autopsy', { topic: np(t) }), strong });
  });
  for (const num of m.numbers) {
    if (/^(second|minute|hour|day|week|year)/.test(num.unit)) {
      if (topic) raw.push({ formula: 'time-boxed-promise', text: `Get ${np(topic)} right in ${num.value} ${num.unit}`, strong: isStrongTopic(topic) });
    } else {
      raw.push({ formula: 'receipts-first', text: `${num.value} ${num.unit}. That is all it took.`, strong: true });
      if (topic) raw.push({ formula: 'numbered-promise', text: `${num.value} ${num.unit} to get ${np(topic)} right`, strong: isStrongTopic(topic) });
    }
  }
  if (m.command) raw.push({ formula: 'direct-command', text: m.command, strong: true, copies: true });
  const tool = m.tools.find((t) => topic && !topic.toLowerCase().split(' ').includes(t.toLowerCase()));
  if (tool && topic) raw.push({ formula: 'what-happens-when', text: `What happens when ${tool} handles ${np(topic)}?`, strong: isStrongTopic(topic) });

  /** @type {Map<string, HookCandidate & {order: number}>} */
  const seen = new Map();
  raw.forEach((r, order) => {
    if (!r.text) return;
    // A filled template cannot restate the opening line; only a hook lifted from the speech can.
    const s = scoreHook(r.text, { spoken_opening: r.copies ? opening : undefined, formula_bonus: r.strong });
    if (s.rejected) return;
    const key = s.text.toLowerCase();
    const prev = seen.get(key);
    if (!prev || s.score > prev.score) seen.set(key, { text: s.text, formula: r.formula, score: s.score, order });
  });
  const rng = makeRng(`hooks:${options.seed ?? 1}`);
  const ranked = [...seen.values()].map((c) => ({ c, tie: rng() }));
  ranked.sort((a, b) => b.c.score - a.c.score || a.c.order - b.c.order || a.tie - b.tie);
  return ranked.slice(0, options.limit ?? 8).map((r) => ({ text: r.c.text, formula: r.c.formula, score: r.c.score }));
}

/**
 * Choose the hook for a reel. A given hook_text is checked and used as written (source "given"); if it breaks a hard
 * rule the error says why, so the caller can ask for a different one. With no hook_text the best suggestion is used
 * (source "auto"). Suggestions are built from words in the video and are a backstop: the agent writing the hook
 * itself, from what the video says, almost always does better.
 * @param {string} spokenText
 * @param {{hook_text?: string, seed?: number|string, slots?: Record<string, Record<string, string|number>>}} [options]
 * @returns {import('../types.mjs').Hook}
 */
export function chooseHook(spokenText, options = {}) {
  const opening = wordsOf(spokenText).slice(0, 12).join(' ');
  const candidates = suggestHooks(spokenText, { slots: options.slots, seed: options.seed });
  if (options.hook_text !== undefined && options.hook_text !== null && String(options.hook_text).trim() !== '') {
    const s = scoreHook(options.hook_text, { spoken_opening: opening });
    if (s.rejected) {
      const err = /** @type {Error & {code?: string, reasons?: string[]}} */ (new Error(`That hook cannot be used. ${s.reasons.join(' ')}`));
      err.code = 'hook_rejected';
      err.reasons = s.reasons;
      throw err;
    }
    const merged = [{ text: s.text, formula: s.formula, score: s.score }, ...candidates.filter((c) => c.text.toLowerCase() !== s.text.toLowerCase())];
    return { text: s.text, formula: s.formula, score: s.score, source: 'given', candidates: merged };
  }
  const passing = candidates.find((c) => c.score >= HOOK_LIMITS.pass_score);
  if (passing) return { ...passing, source: 'auto', candidates };
  // Nothing passes: use the best suggestion anyway, or the opening words trimmed to the limit, so the plan still has a hook to edit.
  const lead = wordsOf(opening).slice(0, HOOK_LIMITS.max_words).join(' ').replace(/[,;:.!?]+$/u, '');
  const best = candidates[0];
  if (best) return { ...best, source: 'auto', candidates };
  if (!lead) return { text: '', formula: 'none', score: 0, source: 'auto', candidates: [] };
  const s = scoreHook(lead);
  return { text: s.rejected ? '' : lead, formula: s.formula, score: s.score, source: 'auto', candidates: s.rejected ? [] : [{ text: lead, formula: s.formula, score: s.score }] };
}
