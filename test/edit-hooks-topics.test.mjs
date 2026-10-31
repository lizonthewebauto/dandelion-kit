// Hook topics and the auto hook label (Fable QA 1, P0-2 and P1-3), on the real 113 s clip's word list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hooks from '../core/edit/hooks.mjs';
import { planShots, editShotPlan } from '../core/edit/shotplan.mjs';
import { roughCut } from '../core/edit/roughcut.mjs';
import { renderText } from '../server/text.mjs';
import { shotPlanData } from '../server/lib/data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, 'fixtures', 'transcript-113s.json'), 'utf8'));
const T = fx.transcript;
const SPOKEN = T.words.map((/** @type {{text: string}} */ w) => w.text).join(' ');

test('topics come from repeated phrases and named tools, never one generic word alone', () => {
  const m = hooks.extractMaterial(SPOKEN);
  assert.equal(m.topics[0], 'AI info flag');
  assert.ok(m.topics.includes('Instagram'), 'a named tool keeps its casing');
  for (const lone of ['info', 'flag', 'stuff', 'thing']) assert.ok(!m.topics.includes(lone), `${lone} is not a topic alone`);
  const m2 = hooks.extractMaterial('So there is a flag. Info matters. Stuff happens. Another flag, more info, more stuff.');
  assert.deepEqual(m2.topics, []);
});

test('the top suggestion for the 113 s clip names a phrase from the video, never just "info"', () => {
  const top = hooks.suggestHooks(SPOKEN)[0];
  assert.match(top.text, /Instagram|AI info flag|AI label/);
  assert.ok(hooks.suggestHooks(SPOKEN).some((c) => /AI info flag/.test(c.text)), 'the full phrase is among the choices');
  assert.ok(!/\binfo wrong\b/i.test(top.text) || /AI info/.test(top.text));
  assert.ok(hooks.suggestHooks(SPOKEN).every((c) => !/get info wrong$/i.test(c.text)));
});

test('a template filled with one generic word gets no credit for the template', () => {
  const generic = hooks.scoreHook('Most people get info wrong', { formula_bonus: false });
  const full = hooks.scoreHook('Most people get info wrong');
  assert.ok(generic.score <= full.score - 15, `${generic.score} vs ${full.score}`);
  assert.ok(generic.score < hooks.HOOK_LIMITS.pass_score);
  assert.equal(hooks.isStrongTopic('info'), false);
  assert.equal(hooks.isStrongTopic('Instagram'), true);
  assert.equal(hooks.isStrongTopic('AI info flag'), true);
});

test('planning the 113 s transcript without hook_text marks the hook auto and says so in the text', () => {
  const cut = roughCut(T, { duration_ms: fx.duration_ms });
  const plan = planShots(T, cut, 'karaoke-clean', { seed: 1 });
  assert.equal(plan.hook.source, 'auto');
  const data = shotPlanData(/** @type {any} */ ({ id: 'p_t', shot_plan: plan, cut, transcript: T }));
  assert.equal(data.hook.source, 'auto');
  const text = renderText('plan_shots', data);
  assert.match(text, /Made from the words in the video\. Write your own with hook_text; the kit's suggestions are fallbacks\./);
  assert.doesNotMatch(text, /Hook \([^)]*good/);
});

test('a given hook_text is source given and is not called auto', () => {
  const cut = roughCut(T, { duration_ms: fx.duration_ms });
  const plan = planShots(T, cut, 'karaoke-clean', { seed: 1, hook_text: 'Beat the Instagram AI label for free' });
  assert.equal(plan.hook.source, 'given');
  assert.equal(plan.hook.text, 'Beat the Instagram AI label for free');
  const edited = editShotPlan(T, cut, planShots(T, cut, 'karaoke-clean', { seed: 1 }), {
    hook_text: 'Three ways around the Instagram AI label',
  });
  assert.equal(edited.hook.source, 'given');
});
