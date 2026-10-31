import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hooks from '../core/edit/hooks.mjs';
import { LOOKS, LOOK_SFX_PALETTE, listLooks, getLook, densityFor } from '../core/edit/looks.mjs';
import { planSfx, SFX_RULES } from '../core/edit/sfxplan.mjs';
import { CAMERA_AGGRESSION } from '../core/edit/camera.mjs';
import { CAPTION_THEMES, LOOK_IDS, SFX_NAMES } from '../core/types.mjs';
import { makeMove } from '../core/edit/camera.mjs';
import { synthBeats } from './helpers-edit.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ---- hooks ----

test('hooks.score rejects a 12 word hook', () => {
  const twelve = 'Here is the one thing about editing that nobody ever tells you';
  assert.equal(twelve.split(' ').length, 12);
  const r = hooks.score(twelve);
  assert.equal(r.rejected, true);
  assert.equal(r.pass, false);
  assert.equal(r.score, 0);
  assert.match(r.reasons.join(' '), /12 words/);
});

test('hooks.score rejects a hook with an em dash', () => {
  const r = hooks.score(`Stop editing by hand ${EM} do this instead`);
  assert.equal(r.rejected, true);
  assert.equal(r.pass, false);
  assert.match(r.reasons.join(' '), /dash/);
});

test('hooks.score rejects an en dash, a double hyphen and a spaced hyphen', () => {
  for (const text of [`Edit faster ${EN} cut pauses`, 'Edit faster -- cut pauses', 'Edit faster - cut pauses']) {
    assert.equal(hooks.score(text).rejected, true, text);
  }
  assert.equal(hooks.score('Edit faster with a well-known trick').rejected, false, 'a hyphen inside a word is fine');
});

test('nine words is the limit', () => {
  assert.equal(hooks.score('Nobody tells you this one trick about cutting video').rejected, false);
  assert.equal(hooks.score('Nobody tells you this one trick about cutting video fast').rejected, true);
});

test('hype openers and hype phrases are rejected', () => {
  assert.equal(hooks.score("In today's video I cut pauses").rejected, true);
  assert.equal(hooks.score('This game changer cuts pauses').rejected, true);
  assert.equal(hooks.score('Welcome back to captions').rejected, true);
});

test('there are eighteen hook formulas with unique ids and no evidence or creator data', () => {
  assert.equal(hooks.HOOK_FORMULAS.length, 18);
  assert.equal(new Set(hooks.HOOK_FORMULAS.map((f) => f.id)).size, 18);
  for (const f of hooks.HOOK_FORMULAS) {
    assert.ok(!('evidence' in f) && !('evidenceWeight' in f));
    assert.ok(f.slots.length > 0 && f.template && f.example && f.fill);
    assert.ok(!JSON.stringify(f).includes('@'), 'no handles');
  }
});

test('every formula example is a real passing hook: nine words or fewer, no dash, score 70 or more', () => {
  for (const f of hooks.HOOK_FORMULAS) {
    const r = hooks.scoreHook(f.example);
    assert.equal(r.rejected, false, f.id);
    assert.ok(r.word_count <= 9, f.id);
    assert.ok(r.score >= 70, `${f.id} scored ${r.score}: ${f.example}`);
    assert.equal(r.pass, true);
  }
});

test('plain, vague hooks do not pass', () => {
  for (const t of ['Tips for better videos', 'How to edit videos', 'My morning routine', 'Learn about video editing today']) {
    const r = hooks.scoreHook(t);
    assert.equal(r.pass, false, `${t} scored ${r.score}`);
    assert.ok(r.score < 60);
  }
});

test('the score has seven parts that add up and never pass their weights', () => {
  const r = hooks.scoreHook('3 free tools that replace your editor');
  const sum = Object.values(r.parts).reduce((s, v) => s + v, 0);
  assert.equal(r.score, sum);
  for (const [k, v] of Object.entries(r.parts)) assert.ok(v <= hooks.HOOK_WEIGHTS[k] && v >= 0, k);
  assert.equal(Object.values(hooks.HOOK_WEIGHTS).reduce((s, v) => s + v, 0), 100);
  assert.deepEqual(hooks.HOOK_WEIGHTS, { curiosity: 18, specificity: 18, promise: 18, interrupt: 14, brevity: 12, stakes: 10, reading: 10 });
});

test('a hook that only repeats the spoken opening loses 25 points', () => {
  const hook = 'Most people trim videos wrong';
  const plain = hooks.scoreHook(hook).score;
  const repeated = hooks.scoreHook(hook, { spoken_opening: 'Most people trim videos wrong and waste time' });
  assert.equal(repeated.score, plain - 25);
});

test('hard words cost reading points', () => {
  const easy = hooks.scoreHook('Stop doing this to your clips').parts.reading;
  const hard = hooks.scoreHook('Personalized comprehensive optimization workflows').parts.reading;
  assert.ok(hard < easy);
});

test('fillFormula fills a shape and returns null when a word is missing', () => {
  assert.equal(hooks.fillFormula('most-people-wrong', { action: 'trim their clips' }), 'Most people trim their clips wrong');
  assert.equal(hooks.fillFormula('most-people-wrong', {}), null);
  assert.equal(hooks.fillFormula('nope', {}), null);
});

test('detectFormula tags the shape a hook already uses', () => {
  assert.equal(hooks.detectFormula('Nobody tells you this about captions'), 'forbidden-knowledge');
  assert.equal(hooks.detectFormula('If you edit on your phone, stop'), 'direct-callout');
  assert.equal(hooks.detectFormula('Captions that work'), 'custom');
});

test('the three channel rule checks the spoken line, the screen text and the picture', () => {
  assert.equal(hooks.checkThreeChannels({ spoken: 'I cut forty seconds of pauses today', screen: 'Pauses cost you views', picture_moves: true }).ok, true);
  const bad = hooks.checkThreeChannels({ spoken: 'one two three four five six seven eight nine ten eleven', screen: 'Hi', picture_moves: false });
  assert.equal(bad.ok, false);
  assert.equal(bad.issues.length, 3);
  assert.equal(hooks.checkThreeChannels({ spoken: 'Pauses cost you views', screen: 'Pauses cost you views', picture_moves: true }).ok, false);
});

const SPOKEN = 'Um so if you edit videos you probably waste three hours every week on captions. The biggest mistake is doing it all by hand. Captions are the slowest part. Captions take forever.';

test('suggested hooks are deterministic, sorted best first, and all valid', () => {
  const a = hooks.suggestHooks(SPOKEN, { seed: 1 });
  const b = hooks.suggestHooks(SPOKEN, { seed: 1 });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 2);
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i].score <= a[i - 1].score);
  for (const c of a) {
    assert.ok(c.text.split(' ').length <= 9);
    assert.equal(hooks.scoreHook(c.text).rejected, false);
  }
  assert.ok(a.some((c) => /captions/i.test(c.text)), 'the topic comes from what was said');
});

test('slots from the host model make candidates too', () => {
  const c = hooks.suggestHooks(SPOKEN, { slots: { 'direct-callout': { habit: 'edit on your phone' } } });
  assert.ok(c.some((x) => x.formula === 'direct-callout' && x.text === 'If you edit on your phone, stop'));
});

test('chooseHook uses a good hook_text as written and refuses a bad one with a reason', () => {
  const ok = hooks.chooseHook(SPOKEN, { hook_text: 'Nobody tells you this about captions' });
  assert.equal(ok.text, 'Nobody tells you this about captions');
  assert.equal(ok.formula, 'forbidden-knowledge');
  assert.ok(ok.score >= 70);
  assert.throws(
    () => hooks.chooseHook(SPOKEN, { hook_text: `Stop doing captions by hand ${EM} it costs hours` }),
    /** @param {any} err */ (err) => err.code === 'hook_rejected' && /dash/.test(err.message) && err.reasons.length > 0,
  );
});

test('chooseHook picks the best passing suggestion when no text is given', () => {
  const h = hooks.chooseHook(SPOKEN, {});
  assert.ok(h.score >= 70);
  assert.ok(h.candidates.length >= 1);
  assert.equal(h.candidates[0].text, h.text);
});

// ---- looks ----

test('there are five looks in the picker order, each complete', () => {
  assert.deepEqual(listLooks().map((l) => l.id), [...LOOK_IDS]);
  assert.equal(LOOK_IDS[0], 'karaoke-clean');
  for (const look of listLooks()) {
    assert.ok(CAPTION_THEMES.includes(look.caption_theme), look.id);
    assert.ok(look.camera_aggression in CAMERA_AGGRESSION, look.id);
    assert.ok(look.cut_every_ms_min < look.cut_every_ms_max, look.id);
    assert.ok(look.sfx_per_minute >= 0);
    assert.match(look.accent, /^#[0-9A-F]{6}$/);
    assert.ok(look.summary.length > 20 && !look.summary.includes(EM) && !look.summary.includes(EN));
    const d = densityFor(look);
    assert.ok(d.min >= 4 && d.max <= 8 && d.min <= d.target && d.target <= d.max, look.id);
  }
});

test('looks differ on cadence, camera and sound, not just on color', () => {
  const keys = ['caption_theme', 'camera_aggression', 'cut_every_ms_min', 'sfx_per_minute'];
  const ls = listLooks();
  for (let i = 0; i < ls.length; i += 1) {
    for (let j = i + 1; j < ls.length; j += 1) {
      const differing = keys.filter((k) => ls[i][k] !== ls[j][k]).length;
      assert.ok(differing >= 2, `${ls[i].id} vs ${ls[j].id} differ on only ${differing}`);
    }
  }
});

test('density_per_10s falls back to 4, 6, 8 when a look has none', () => {
  assert.deepEqual(densityFor({ ...LOOKS['karaoke-clean'], density_per_10s: undefined }), { min: 4, target: 6, max: 8 });
});

test('getLook applies a caption theme and accent, and refuses nonsense', () => {
  const l = getLook('bold-value', { caption_theme: 'karaoke-pill', accent: '#00aaff' });
  assert.equal(l.caption_theme, 'karaoke-pill');
  assert.equal(l.accent, '#00AAFF');
  assert.equal(LOOKS['bold-value'].caption_theme, 'bold-stroke', 'the shared look is not changed');
  assert.throws(() => getLook('nope'), /Unknown look/);
  assert.throws(() => getLook('bold-value', { caption_theme: 'neon' }), /Unknown caption theme/);
  assert.throws(() => getLook('bold-value', { accent: 'red' }), /#RRGGBB/);
});

test('every look has a sound palette made only of sounds the synth makes', () => {
  for (const id of LOOK_IDS) {
    assert.ok(LOOK_SFX_PALETTE[id].length >= 2);
    for (const name of LOOK_SFX_PALETTE[id]) assert.ok(SFX_NAMES.includes(name), `${id}: ${name}`);
  }
});

// ---- sound plan ----

function sfxInput(look, extra = {}) {
  const beats = synthBeats(60000, 3000, (i) => ({
    kind: i % 4 === 1 ? 'number-stat' : i % 5 === 2 ? 'list-step' : 'default',
    treatment: i === 0 ? 'hook-card' : i % 3 === 0 ? 'text-emphasis' : 'face',
    emphasis_words: i % 2 ? [i * 5 + 1] : [],
    ...(extra.over ? extra.over(i) : {}),
  }));
  const camera = [];
  for (let t = 0; t < 60000; t += 4000) camera.push(makeMove(camera.length % 2 ? 'wide' : 'punch-in', t, t + 4000, { amplitude: 1.1, ceiling: 1.2 }));
  const words = beats.flatMap((b) => [{ index: b.first_word + 1, text: 'x', start_ms: b.out_start_ms + 400, end_ms: b.out_start_ms + 700 }]);
  return { beats, camera, words, duration_ms: 60000, look, hook_card: true };
}

test('sound effects follow the look budget, the 1.5 second spacing and the look palette', () => {
  for (const look of listLooks()) {
    const cues = planSfx(sfxInput(look));
    const palette = LOOK_SFX_PALETTE[look.id];
    assert.ok(cues.length <= Math.round(look.sfx_per_minute) && cues.length >= 1, `${look.id}: ${cues.length}`);
    for (const c of cues) {
      assert.ok(palette.includes(c.name), `${look.id} used ${c.name}`);
      assert.equal(c.gain_db, SFX_RULES.gain_db);
    }
    for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].out_ms - cues[i - 1].out_ms >= 1500);
  }
});

test('no sound effect lands on an emotional beat', () => {
  const input = sfxInput(LOOKS['bold-value'], { over: (i) => (i >= 2 && i <= 10 ? { kind: 'emotional', treatment: 'face', emphasis_words: [] } : {}) });
  const cues = planSfx(input);
  for (const c of cues) assert.ok(!(c.out_ms >= 6000 && c.out_ms < 33000), `sound at ${c.out_ms}`);
});

test('very short reels get no sound effects', () => {
  assert.deepEqual(planSfx({ ...sfxInput(LOOKS['karaoke-clean']), duration_ms: 5000 }), []);
});
