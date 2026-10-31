import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Share one model download across test runs (and with normal use of the kit).
process.env.DANDELION_KIT_MODELS ??= join(homedir(), '.dandelion-kit', 'models');

const { normalizeWords, buildSegments, validateTranscript, makeTranscript, transcriptText } =
  await import('../core/transcribe/types.mjs');
const {
  parseWhisperCliJson,
  parseFfmpegWhisperJson,
  parseTransformersChunks,
  piecesToRawWords,
  escapeFilterValue,
  engineStatus,
  transcribe,
  loadAudio16k,
  TRANSFORMERS_MODELS,
} = await import('../core/transcribe/whisper.mjs');
const { TRANSCRIBE_ENGINES } = await import('../core/types.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');

function assertMonotonic(words) {
  let prevStart = -1;
  let prevEnd = -1;
  for (const w of words) {
    assert.ok(w.end_ms >= w.start_ms, `${w.text} ends before it starts`);
    assert.ok(w.start_ms >= prevStart, `${w.text} starts before the word before it`);
    assert.ok(w.start_ms >= prevEnd, `${w.text} overlaps the word before it`);
    prevStart = w.start_ms;
    prevEnd = w.end_ms;
  }
}

test('normalizeWords trims, drops notes, folds punctuation, and orders times', () => {
  const words = normalizeWords([
    { text: ' Hello', start_ms: 0, end_ms: 400 },
    { text: '[BLANK_AUDIO]', start_ms: 400, end_ms: 800 },
    { text: ' (music)', start_ms: 800, end_ms: 900 },
    { text: '...', start_ms: 400, end_ms: 450 },
    { text: ' world.', start_ms: 380, end_ms: 900 }, // starts inside "Hello"
    { text: ' again', start_ms: 1000, end_ms: null },
    { text: '   ', start_ms: 1100, end_ms: 1200 },
  ]);
  assert.deepEqual(
    words.map((w) => w.text),
    ['Hello...', 'world.', 'again'],
  );
  assertMonotonic(words);
  assert.equal(words[0].end_ms, 380, 'the word before is trimmed to where the next one starts');
  assert.equal(words[1].start_ms, 380);
  assert.ok(words[2].end_ms > words[2].start_ms, 'a missing end is filled in');
});

test('normalizeWords fills missing starts, clamps to the audio length, and keeps conf', () => {
  const words = normalizeWords(
    [
      { text: 'one', start_ms: null, end_ms: null, conf: 1.4 },
      { text: 'two', start_ms: 5000, end_ms: 9000, conf: 0.5 },
    ],
    { duration_ms: 6000 },
  );
  assert.equal(words[0].start_ms, 0);
  assert.equal(words[0].conf, 1);
  assert.equal(words[1].conf, 0.5);
  assert.ok(words[1].end_ms <= 6000);
  assertMonotonic(words);
});

test('buildSegments splits at sentence ends and long pauses', () => {
  const words = normalizeWords([
    { text: 'Hi', start_ms: 0, end_ms: 200 },
    { text: 'there.', start_ms: 250, end_ms: 600 },
    { text: 'Second', start_ms: 700, end_ms: 1000 },
    { text: 'one', start_ms: 1050, end_ms: 1300 },
    { text: 'after', start_ms: 3000, end_ms: 3300 }, // pause of 1.7 s
    { text: 'pause', start_ms: 3350, end_ms: 3700 },
  ]);
  const segments = buildSegments(words);
  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((s) => s.text),
    ['Hi there.', 'Second one', 'after pause'],
  );
  assert.deepEqual(
    segments.map((s) => [s.first_word, s.last_word]),
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
  );
  assert.equal(segments[2].start_ms, 3000);
  assert.equal(segments[2].end_ms, 3700);
});

test('buildSegments breaks a long run with no punctuation', () => {
  const raw = Array.from({ length: 70 }, (_, i) => ({
    text: `w${i}`,
    start_ms: i * 300,
    end_ms: i * 300 + 250,
  }));
  const segments = buildSegments(normalizeWords(raw));
  assert.ok(segments.length >= 2);
  // Every word belongs to exactly one segment.
  assert.equal(
    segments.reduce((n, s) => n + (s.last_word - s.first_word + 1), 0),
    70,
  );
});

test('validateTranscript passes a good transcript and names problems in a bad one', () => {
  const good = makeTranscript(
    normalizeWords([
      { text: 'a', start_ms: 0, end_ms: 100 },
      { text: 'b.', start_ms: 100, end_ms: 200 },
    ]),
    { engine: 'transformers' },
  );
  assert.deepEqual(validateTranscript(good), []);
  assert.equal(transcriptText(good), 'a b.');
  const bad = { ...good, words: [{ text: 'a', start_ms: 500, end_ms: 100 }], engine: 'magic' };
  const problems = validateTranscript(/** @type {any} */ (bad));
  assert.ok(problems.some((p) => /ends before it starts/.test(p)));
  assert.ok(problems.some((p) => /Unknown engine/.test(p)));
});

test('whisper-cli json: word pieces join, spaces start new words', () => {
  const raw = parseWhisperCliJson({
    transcription: [
      { text: ' Dand', offsets: { from: 0, to: 200 } },
      { text: 'elion', offsets: { from: 200, to: 520 } },
      { text: ' kit', offsets: { from: 520, to: 800 } },
      { text: '.', offsets: { from: 800, to: 820 } },
      { text: ' Next', offsets: { from: 900, to: 1100 } },
    ],
  });
  const words = normalizeWords(raw);
  assert.deepEqual(
    words.map((w) => w.text),
    ['Dandelion', 'kit.', 'Next'],
  );
  assert.equal(words[0].start_ms, 0);
  assert.equal(words[0].end_ms, 520);
  assertMonotonic(words);
});

test('ffmpeg whisper json: one object per line, and multi-word segments share their time', () => {
  const lines = [
    JSON.stringify({ start: 0, end: 1000, text: ' Hello there' }),
    JSON.stringify({ start: 1000, end: 1500, text: ' friend.' }),
  ].join('\n');
  const words = normalizeWords(parseFfmpegWhisperJson(lines));
  assert.deepEqual(
    words.map((w) => w.text),
    ['Hello', 'there', 'friend.'],
  );
  assertMonotonic(words);
  assert.ok(words[0].end_ms > 0 && words[0].end_ms < 1000);
  assert.deepEqual(parseFfmpegWhisperJson(''), []);
  assert.equal(parseFfmpegWhisperJson(JSON.stringify([{ start: 0, end: 10, text: ' a' }])).length, 1);
});

test('transformers chunks: seconds become milliseconds, a null end is allowed', () => {
  const raw = parseTransformersChunks([
    { text: ' Hi', timestamp: [0.5, 0.9] },
    { text: ' there', timestamp: [1.2, null] },
  ]);
  assert.deepEqual(raw, [
    { text: ' Hi', start_ms: 500, end_ms: 900 },
    { text: ' there', start_ms: 1200, end_ms: null },
  ]);
  assertMonotonic(normalizeWords(raw));
  assert.deepEqual(piecesToRawWords([]), []);
});

test('filter values escape colons, quotes and backslashes', () => {
  assert.equal(escapeFilterValue('C:\\models\\ggml-base.bin'), 'C\\:/models/ggml-base.bin');
  assert.equal(escapeFilterValue("it's"), "it\\'s");
});

test('model ids use the timestamped exports', () => {
  assert.match(TRANSFORMERS_MODELS.base, /^onnx-community\/whisper-base_timestamped$/);
  assert.match(TRANSFORMERS_MODELS.tiny, /^onnx-community\/whisper-tiny_timestamped$/);
});

test('engineStatus lists the three engines in preference order, and transformers can always run', async () => {
  const status = await engineStatus();
  assert.deepEqual(
    status.map((e) => e.id),
    [...TRANSCRIBE_ENGINES],
  );
  assert.equal(status.find((e) => e.id === 'transformers')?.available, true);
});

test('loadAudio16k decodes the fixture to 16 kHz samples', async () => {
  const audio = await loadAudio16k(SPEECH);
  assert.ok(audio instanceof Float32Array);
  const seconds = audio.length / 16000;
  assert.ok(seconds > 10.5 && seconds < 11.6, `got ${seconds} s`);
  assert.ok(
    audio.some((v) => Math.abs(v) > 0.05),
    'the audio is silent',
  );
});

test('an unknown engine name is refused in plain words', async () => {
  await assert.rejects(
    () => transcribe(SPEECH, { engine: /** @type {any} */ ('crystal-ball') }),
    /not a speech engine/,
  );
  await assert.rejects(() => transcribe(join(ROOT, 'nope.wav')), /could not find the audio/);
});

test('speech fixture: real transcript has words with rising times', async (t) => {
  if (process.env.KIT_TEST_SKIP_ASR) return t.skip('KIT_TEST_SKIP_ASR is set');
  let transcript;
  try {
    transcript = await transcribe(SPEECH, { engine: 'transformers', model: 'base' });
  } catch (error) {
    // No model on disk and no network: say so instead of failing the whole run.
    if (/fetch|network|ENOTFOUND|EAI_AGAIN|ECONN|download/i.test(String(/** @type {any} */ (error)?.message)))
      return t.skip(`speech model unavailable: ${/** @type {any} */ (error).message}`);
    throw error;
  }
  assert.equal(transcript.engine, 'transformers');
  assert.equal(transcript.quality, 'precise');
  assert.equal(transcript.language, 'en');
  assert.ok(transcript.words.length >= 3, `only ${transcript.words.length} words`);
  assertMonotonic(transcript.words);
  assert.deepEqual(validateTranscript(transcript), []);
  assert.ok(transcript.segments.length >= 2);
  const text = transcriptText(transcript).toLowerCase();
  assert.match(text, /welcome/);
  assert.match(text, /reel/);
  // The last word ends close to the end of the speech (11.1 s).
  const last = transcript.words[transcript.words.length - 1];
  assert.ok(last.end_ms > 9000 && last.end_ms <= 11700, `last word ends at ${last.end_ms}`);
});
