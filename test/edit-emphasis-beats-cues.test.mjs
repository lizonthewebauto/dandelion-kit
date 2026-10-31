import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emphasisScore, emphasisRole, emphasisColor, selectEmphasis, SEMANTIC_COLORS } from '../core/edit/emphasis.mjs';
import { classifyBeat, BEAT_RULES, buildBeats, splitSentences, splitLong, TREATMENT_BY_KIND } from '../core/edit/beats.mjs';
import { CAPTION_LAYOUT, CUE_RULES, buildCaptionCues, groupWords } from '../core/edit/cues.mjs';
import { roughCut, wordsOnTimeline } from '../core/edit/roughcut.mjs';
import { BEAT_KINDS, CAPTION_THEMES, TREATMENTS } from '../core/types.mjs';
import { loadFixture, must } from './helpers-edit.mjs';

const fx = loadFixture();
const cut = roughCut(fx.transcript, { duration_ms: fx.duration_ms });
const tw = wordsOnTimeline(fx.transcript, cut.pieces);

// ---- emphasis ----

test('emphasis priority: numbers beat negations beat superlatives beat power verbs beat names beat emotion beat long words', () => {
  const order = [emphasisScore('$500'), emphasisScore('never'), emphasisScore('best'), emphasisScore('doubled'), emphasisScore('ChatGPT'), emphasisScore('secret'), emphasisScore('beautiful')];
  assert.deepEqual(order, [100, 88, 76, 66, 56, 48, 18]);
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i] < order[i - 1]);
});

test('little words are never emphasized and "one" is left alone', () => {
  for (const w of ['the', 'and', 'you', 'is', 'to', 'one']) assert.ok(emphasisScore(w) <= 6, w);
  assert.equal(emphasisScore('the'), 0);
});

test('emphasis roles and colors', () => {
  assert.equal(emphasisRole('$500'), 'money');
  assert.equal(emphasisRole('revenue'), 'money');
  assert.equal(emphasisRole('never'), 'warning');
  assert.equal(emphasisRole('amazing'), 'highlight');
  assert.equal(emphasisColor('highlight'), '#FFD93D');
  assert.equal(emphasisColor('money'), SEMANTIC_COLORS.money);
  assert.equal(emphasisColor('warning'), '#FF1744');
  assert.equal(emphasisColor('money', { mode: 'accent', accent: '#112233' }), '#112233');
});

test('emphasis budget is about one per nine words, never adjacent, never repeated', () => {
  const words = tw.map((w) => ({ text: w.text }));
  const picks = selectEmphasis(words);
  assert.ok(picks.length >= 1 && picks.length <= Math.round(words.length / 9) + 1);
  for (let i = 1; i < picks.length; i += 1) assert.ok(picks[i].position - picks[i - 1].position > 1);
  const keys = picks.map((p) => words[p.position].text.toLowerCase().replace(/[^a-z0-9]/g, ''));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(selectEmphasis([]), []);
});

// ---- beats ----

test('classifyBeat finds each kind and falls back to default', () => {
  const cases = {
    'number-stat': 'it grew 40 percent in a month',
    'list-step': 'first drop in your clip',
    contrast: 'this is better than that',
    cta: 'follow me for more',
    instruction: 'open the settings menu',
    question: 'why does this work?',
    story: 'yesterday i was stuck on this',
    emotional: 'honestly that was the hardest year',
    claim: 'the truth is it works',
    default: 'we walked down the road',
  };
  for (const [kind, text] of Object.entries(cases)) assert.equal(classifyBeat(text), kind, text);
});

test('every beat kind in the contract has a treatment, and treatments are all drawable', () => {
  for (const kind of BEAT_KINDS) {
    const t = TREATMENT_BY_KIND[kind];
    assert.ok(t, kind);
    assert.ok(TREATMENTS.includes(t.treatment), `${kind} -> ${t.treatment}`);
  }
  for (const rule of BEAT_RULES) assert.ok(BEAT_KINDS.includes(rule.kind));
});

test('sentences split at end punctuation and at pauses', () => {
  const sentences = splitSentences(tw);
  assert.ok(sentences.length >= 6);
  for (const s of sentences) assert.ok(s.length <= 22);
});

test('a run of words that is too long splits at a natural break', () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ index: i, text: i === 9 ? 'comma,' : `w${i}`, start_ms: i * 400, end_ms: i * 400 + 300 }));
  const parts = splitLong(words, 4000);
  assert.ok(parts.length >= 2);
  assert.equal(parts.flat().length, 20);
  assert.ok(parts.every((p) => p.length >= 3));
});

test('beats cover the whole reel with no gaps and follow the look cadence', () => {
  const duration = cut.after_ms;
  const beats = buildBeats(tw, { cadence: { min_ms: 1800, max_ms: 3200 }, duration_ms: duration });
  assert.equal(beats[0].out_start_ms, 0);
  assert.equal(beats[beats.length - 1].out_end_ms, duration);
  for (let i = 1; i < beats.length; i += 1) assert.equal(beats[i].out_start_ms, beats[i - 1].out_end_ms);
  for (const b of beats) {
    assert.ok(BEAT_KINDS.includes(b.kind));
    assert.ok(b.out_end_ms - b.out_start_ms <= 3200 * 1.3 / 0.9 + 1500, `beat ${b.id} is ${b.out_end_ms - b.out_start_ms} ms`);
    assert.ok(b.first_word <= b.last_word);
  }
  assert.deepEqual(beats.map((b) => b.id), beats.map((_, i) => `b${i + 1}`));
});

test('richer ideas are recorded as wanted treatments and drawn as something v1 can do', () => {
  const beats = buildBeats(tw, { cadence: { min_ms: 1800, max_ms: 3200 }, duration_ms: cut.after_ms });
  const withWanted = beats.filter((b) => b.wanted_treatment);
  assert.ok(withWanted.length >= 1);
  for (const b of withWanted) assert.ok(TREATMENTS.includes(/** @type {any} */ (b.rendered_as)));
});

// ---- cues ----

test('every caption theme has a layout, and the lists agree', () => {
  assert.deepEqual(Object.keys(CAPTION_LAYOUT).sort(), [...CAPTION_THEMES].sort());
  assert.equal(CAPTION_LAYOUT['karaoke-highlight'].max_words, 4);
  assert.equal(CAPTION_LAYOUT['karaoke-highlight'].line_chars, 19);
  assert.equal(CAPTION_LAYOUT['clean-minimal'].max_words, 7);
  assert.equal(CAPTION_LAYOUT['clean-minimal'].line_chars, 28);
  assert.equal(CUE_RULES.lead_ms, 150);
});

test('karaoke cues light one word at a time inside a group of two to four words', () => {
  const { cues, groups } = buildCaptionCues(tw, 'karaoke-highlight');
  assert.ok(groups.every((g) => g.length >= 1 && g.length <= 4));
  assert.ok(cues.every((c) => c.active_word !== undefined && c.active_word < c.word_indexes.length));
  const total = groups.reduce((s, g) => s + g.length, 0);
  assert.equal(cues.length, total);
  assert.ok(groups.filter((g) => g.length >= 2).length > groups.length / 2);
});

test('one word captions show one word, or a quick little word with its neighbour', () => {
  const groups = groupWords(tw, 'one-word-pop');
  assert.ok(groups.every((g) => g.length <= 2));
  assert.ok(groups.filter((g) => g.length === 1).length > groups.length * 0.6);
});

test('phrase captions stay inside their word and character limits', () => {
  for (const theme of ['clean-minimal', 'editorial-serif', 'box-caption', 'mono-terminal']) {
    const layout = CAPTION_LAYOUT[theme];
    for (const g of groupWords(tw, theme)) {
      assert.ok(g.length <= layout.max_words, `${theme}: ${g.length} words`);
      assert.ok(g.map((w) => w.text).join(' ').length <= layout.line_chars * layout.lines, `${theme} too long`);
    }
  }
});

test('cues are inside the reel, in order, and never overlap in a phrase theme', () => {
  const { cues } = buildCaptionCues(tw, 'clean-minimal');
  let prevEnd = 0;
  for (const c of cues) {
    assert.ok(c.start_ms >= prevEnd, 'no overlap');
    assert.ok(c.end_ms > c.start_ms);
    prevEnd = c.end_ms;
  }
  assert.ok(prevEnd <= cut.after_ms + 200);
});

test('a cue never ends before its last word has been spoken', () => {
  const { cues } = buildCaptionCues(tw, 'clean-minimal');
  const byIndex = new Map(tw.map((w) => [w.index, w]));
  for (const c of cues) {
    const last = must(byIndex.get(c.word_indexes[c.word_indexes.length - 1]));
    assert.ok(c.end_ms >= last.end_ms - 1, `"${c.text}" ends ${c.end_ms} before ${last.end_ms}`);
  }
});
