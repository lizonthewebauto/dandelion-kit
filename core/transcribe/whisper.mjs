// Word-level transcript. Three engines, tried in this order when more than one can run:
//   1. whisper-cli (whisper.cpp) when it is on PATH and a ggml model file is present. Fastest.
//   2. transformers.js (the default): onnx-community whisper, quantized, runs in Node on the CPU.
//   3. the ffmpeg "whisper" filter, when the build has it and a ggml model file is present. Coarse timings.
// The kit never ships a model. The transformers model downloads once into the models folder.
import { readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TRANSCRIBE_ENGINES } from '../types.mjs';
import {
  captureFfmpeg,
  detectFfmpeg,
  findExecutable,
  runCommand,
  runFfmpeg,
  KitMediaError,
} from '../media/ffmpeg.mjs';
import { probeAudio } from '../media/probe.mjs';
import { ensureDir, isFile, makeTempDir, modelsDir } from '../util/fs.mjs';
import * as log from '../util/log.mjs';
import { makeTranscript, normalizeWords } from './types.mjs';

/**
 * The transformers.js models. The "_timestamped" exports carry the cross attentions that word
 * timestamps need; the plain onnx-community/whisper-* exports do not work for word timing.
 */
export const TRANSFORMERS_MODELS = Object.freeze({
  base: 'onnx-community/whisper-base_timestamped',
  tiny: 'onnx-community/whisper-tiny_timestamped',
});

/** Files that must be present for a transformers model to count as downloaded. */
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

/** @typedef {'base'|'tiny'} ModelSize */

/**
 * @typedef {object} TranscribeOptions
 * @property {'auto' | typeof TRANSCRIBE_ENGINES[number]} [engine]   Default "auto": the first engine that can run, then the next if it fails.
 * @property {ModelSize} [model]        transformers.js model size. Default "base".
 * @property {string} [language]        Two-letter code, default "en".
 * @property {AbortSignal} [signal]
 * @property {(stage:string, fraction:number, message?:string) => void} [onProgress]
 */

// ---------------------------------------------------------------------------
// Pure parsing helpers (unit tested)
// ---------------------------------------------------------------------------

/**
 * Turn engine pieces into raw words. A piece that starts with a space begins a new word; a piece
 * with no leading space joins the word before it (word-piece output). A piece holding several
 * words is shared out by letter count.
 * @param {{text:string, start_ms:number, end_ms:number}[]} pieces
 * @returns {import('./types.mjs').RawWord[]}
 */
export function piecesToRawWords(pieces) {
  /** @type {import('./types.mjs').RawWord[]} */
  const out = [];
  for (const piece of pieces) {
    const text = String(piece.text ?? '');
    const trimmed = text.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 1) {
      const prev = out[out.length - 1];
      const startsNew = !prev || /^\s/.test(text) || /[.!?,;:]["')\]]*$/.test(prev.text);
      if (startsNew) out.push({ text: trimmed, start_ms: piece.start_ms, end_ms: piece.end_ms });
      else {
        prev.text += trimmed;
        prev.end_ms = piece.end_ms;
      }
    } else {
      const total = tokens.reduce((sum, token) => sum + token.length, 0) || 1;
      const span = Math.max(0, piece.end_ms - piece.start_ms);
      let cursor = piece.start_ms;
      for (const token of tokens) {
        const share = Math.round((span * token.length) / total);
        out.push({ text: token, start_ms: cursor, end_ms: cursor + share });
        cursor += share;
      }
    }
  }
  return out;
}

/**
 * Read whisper.cpp JSON (from `whisper-cli -ml 1 -oj`).
 * @param {any} json
 * @returns {import('./types.mjs').RawWord[]}
 */
export function parseWhisperCliJson(json) {
  const entries = Array.isArray(json?.transcription) ? json.transcription : [];
  return piecesToRawWords(
    entries.map((entry) => ({
      text: String(entry.text ?? ''),
      start_ms: Number(entry.offsets?.from ?? 0),
      end_ms: Number(entry.offsets?.to ?? entry.offsets?.from ?? 0),
    })),
  );
}

/**
 * Read the ffmpeg whisper filter's json output: one object per line, or one array.
 * @param {string} text
 * @returns {import('./types.mjs').RawWord[]}
 */
export function parseFfmpegWhisperJson(text) {
  /** @type {any[]} */
  let items = [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transcription)
        ? parsed.transcription
        : [parsed];
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      try {
        items.push(JSON.parse(line));
      } catch {
        // skip lines that are not json
      }
    }
  }
  return piecesToRawWords(
    items.map((item) => ({
      text: String(item.text ?? ''),
      start_ms: Number(item.start ?? item.offsets?.from ?? 0),
      end_ms: Number(item.end ?? item.offsets?.to ?? item.start ?? 0),
    })),
  );
}

/**
 * Read transformers.js ASR chunks ({text, timestamp:[start_s, end_s|null]}).
 * @param {{text:string, timestamp:[number|null, number|null]}[]} chunks
 * @returns {import('./types.mjs').RawWord[]}
 */
export function parseTransformersChunks(chunks) {
  return (chunks ?? []).map((chunk) => ({
    text: String(chunk.text ?? ''),
    start_ms: typeof chunk.timestamp?.[0] === 'number' ? Math.round(chunk.timestamp[0] * 1000) : null,
    end_ms: typeof chunk.timestamp?.[1] === 'number' ? Math.round(chunk.timestamp[1] * 1000) : null,
  }));
}

/** Escape a value for use inside an ffmpeg filter option. @param {string} value */
export function escapeFilterValue(value) {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Engine discovery
// ---------------------------------------------------------------------------

/** A ggml model file for whisper.cpp / the ffmpeg filter: WHISPER_CPP_MODEL, or ggml-*.bin in the models folder. */
export function findGgmlModel() {
  const fromEnv = process.env.WHISPER_CPP_MODEL?.trim();
  if (fromEnv && isFile(fromEnv)) return resolve(fromEnv);
  try {
    const dir = modelsDir();
    const names = readdirSync(dir).filter((name) => /^ggml-.*\.bin$/i.test(name));
    const order = [
      'ggml-base.en.bin',
      'ggml-base.bin',
      'ggml-small.en.bin',
      'ggml-tiny.en.bin',
      'ggml-tiny.bin',
    ];
    names.sort((a, b) => {
      const ia = order.indexOf(a.toLowerCase());
      const ib = order.indexOf(b.toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return names.length ? join(dir, names[0]) : null;
  } catch {
    return null;
  }
}

/** The whisper-cli program: WHISPER_CLI, or "whisper-cli" on PATH. */
export function findWhisperCli() {
  const fromEnv = process.env.WHISPER_CLI?.trim();
  if (fromEnv && isFile(fromEnv)) return resolve(fromEnv);
  return findExecutable('whisper-cli');
}

/**
 * Which transformers models are already downloaded.
 * @returns {{dir:string, base:boolean, tiny:boolean}}
 */
export function transformersModelStatus() {
  const dir = modelsDir();
  const has = (id) => MODEL_FILES.every((file) => isFile(join(dir, ...id.split('/'), ...file.split('/'))));
  return { dir, base: has(TRANSFORMERS_MODELS.base), tiny: has(TRANSFORMERS_MODELS.tiny) };
}

/**
 * What each engine can do right now.
 * @returns {Promise<{id: typeof TRANSCRIBE_ENGINES[number], available: boolean, detail: string}[]>}
 */
export async function engineStatus() {
  const ggml = findGgmlModel();
  const cli = findWhisperCli();
  const ffmpeg = await detectFfmpeg();
  const models = transformersModelStatus();
  return [
    {
      id: 'whisper-cli',
      available: Boolean(cli && ggml),
      detail: cli
        ? ggml
          ? `whisper-cli with ${ggml}`
          : 'whisper-cli found but no ggml model file'
        : 'whisper-cli is not on PATH',
    },
    {
      id: 'transformers',
      available: true,
      detail: models.base
        ? 'transformers.js, base model ready'
        : 'transformers.js, downloads the base model (about 80 MB) the first time',
    },
    {
      id: 'ffmpeg',
      available: Boolean(ffmpeg.found && ffmpeg.has_whisper && ggml),
      detail: ffmpeg.has_whisper
        ? ggml
          ? `ffmpeg whisper filter with ${ggml}`
          : 'ffmpeg has the whisper filter but no ggml model file'
        : 'this ffmpeg build has no whisper filter',
    },
  ];
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * Decode any audio or video file to 16 kHz mono float samples.
 * @param {string} path
 * @param {AbortSignal} [signal]
 * @returns {Promise<Float32Array>}
 */
export async function loadAudio16k(path, signal) {
  const buffer = await captureFfmpeg(
    ['-i', path, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
    {
      signal,
    },
  );
  // Copy so the view starts on a 4-byte boundary.
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(copy);
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<any>>} */
const pipelines = new Map();

async function getPipeline(modelId, onProgress, quiet) {
  let pending = pipelines.get(modelId);
  if (!pending) {
    pending = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = ensureDir(modelsDir());
      env.allowLocalModels = false;
      const lastShown = new Map();
      return pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q8',
        progress_callback: (event) => {
          // Cached files report progress too, so stay quiet when the model is already downloaded.
          if (quiet || event?.status !== 'progress' || typeof event.progress !== 'number') return;
          const step = Math.floor(event.progress / 20) * 20;
          if (lastShown.get(event.file) === step) return;
          lastShown.set(event.file, step);
          const message = `Downloading the speech model (one time): ${event.file} ${step}%`;
          log.info(message);
          onProgress?.('model', event.progress / 100, message);
        },
      });
    })();
    pipelines.set(modelId, pending);
    pending.catch(() => pipelines.delete(modelId));
  }
  return pending;
}

/** transformers.js engine. */
async function transcribeWithTransformers(audioPath, options) {
  const size = options.model === 'tiny' ? 'tiny' : 'base';
  const modelId = TRANSFORMERS_MODELS[size];
  const have = transformersModelStatus()[size];
  if (!have)
    log.info(
      `The ${size} speech model is not downloaded yet. Fetching it once (about ${size === 'base' ? '80' : '40'} MB).`,
    );
  options.onProgress?.('model', 0, have ? 'Loading the speech model' : 'Downloading the speech model');
  const asr = await getPipeline(modelId, options.onProgress, have);
  options.onProgress?.('transcribe', 0, 'Listening to the audio');
  const audio = await loadAudio16k(audioPath, options.signal);
  const result = await asr(audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    language: options.language ?? 'en',
    task: 'transcribe',
  });
  const raw = parseTransformersChunks(result.chunks);
  const duration_ms = Math.round((audio.length / 16000) * 1000);
  options.onProgress?.('transcribe', 1, 'Transcript ready');
  return makeTranscript(normalizeWords(raw, { duration_ms }), {
    language: options.language ?? 'en',
    engine: 'transformers',
    quality: 'precise',
  });
}

/** whisper.cpp command line engine. */
async function transcribeWithWhisperCli(audioPath, options) {
  const cli = findWhisperCli();
  const model = findGgmlModel();
  if (!cli || !model) throw new KitMediaError('whisper-cli or its model file is missing.');
  const temp = makeTempDir('kit-whisper-');
  try {
    options.onProgress?.('transcribe', 0, 'Listening with whisper-cli');
    const wav = join(temp, 'in.wav');
    await runFfmpeg(
      ['-i', audioPath, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav],
      {
        signal: options.signal,
      },
    );
    const base = join(temp, 'out');
    const language = options.language ?? 'en';
    const run = await runCommand(
      cli,
      ['-m', model, '-f', wav, '-ml', '1', '-oj', '-of', base, '-l', language, '-np'],
      30 * 60 * 1000,
    );
    if (run.code !== 0)
      throw new KitMediaError(`whisper-cli stopped with code ${run.code}. ${run.err.slice(-300)}`);
    const json = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
    const raw = parseWhisperCliJson(json);
    const info = await probeAudio(audioPath).catch(() => null);
    options.onProgress?.('transcribe', 1, 'Transcript ready');
    return makeTranscript(normalizeWords(raw, { duration_ms: info?.duration_ms }), {
      language,
      engine: 'whisper-cli',
      quality: 'precise',
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

/** ffmpeg whisper filter engine (coarse). */
async function transcribeWithFfmpegFilter(audioPath, options) {
  const ffmpeg = await detectFfmpeg();
  const model = findGgmlModel();
  if (!ffmpeg.found || !ffmpeg.has_whisper)
    throw new KitMediaError('This ffmpeg build has no whisper filter.');
  if (!model)
    throw new KitMediaError('The ffmpeg whisper filter needs a ggml model file (set WHISPER_CPP_MODEL).');
  const temp = makeTempDir('kit-whisper-');
  try {
    options.onProgress?.('transcribe', 0, 'Listening with the ffmpeg whisper filter');
    const language = options.language ?? 'en';
    const destination = join(temp, 'out.json');
    const filter = `whisper=model=${escapeFilterValue(model)}:language=${language}:queue=10:max_len=1:format=json:destination=${escapeFilterValue(destination)}`;
    await runFfmpeg(['-i', audioPath, '-vn', '-map', '0:a:0', '-af', filter, '-f', 'null', '-'], {
      signal: options.signal,
    });
    const raw = parseFfmpegWhisperJson(readFileSync(destination, 'utf8'));
    const info = await probeAudio(audioPath).catch(() => null);
    options.onProgress?.('transcribe', 1, 'Transcript ready');
    return makeTranscript(normalizeWords(raw, { duration_ms: info?.duration_ms }), {
      language,
      engine: 'ffmpeg',
      quality: 'coarse',
    });
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

const RUNNERS = {
  'whisper-cli': transcribeWithWhisperCli,
  transformers: transcribeWithTransformers,
  ffmpeg: transcribeWithFfmpegFilter,
};

/**
 * Transcribe a file (audio.wav or any video) into words with times.
 * With engine "auto" the first engine that can run is used, and the next one if it fails.
 * @param {string} audioPath
 * @param {TranscribeOptions} [options]
 * @returns {Promise<import('../types.mjs').Transcript>}
 */
export async function transcribe(audioPath, options = {}) {
  if (!isFile(audioPath)) throw new KitMediaError(`I could not find the audio at ${audioPath}.`);
  const requested = options.engine ?? 'auto';
  const status = await engineStatus();
  /** @type {typeof TRANSCRIBE_ENGINES[number][]} */
  let order;
  if (requested === 'auto') order = status.filter((e) => e.available).map((e) => e.id);
  else if (TRANSCRIBE_ENGINES.includes(requested)) order = [requested];
  else
    throw new KitMediaError(
      `"${requested}" is not a speech engine. Use ${TRANSCRIBE_ENGINES.join(', ')} or auto.`,
    );

  /** @type {unknown} */
  let lastError = null;
  for (const id of order) {
    try {
      const transcript = await RUNNERS[id](audioPath, options);
      if (!transcript.words.length) {
        throw new KitMediaError('I did not hear any words in that audio.');
      }
      return transcript;
    } catch (error) {
      lastError = error;
      if (requested !== 'auto') break;
      log.warn(`Speech engine ${id} failed (${/** @type {any} */ (error).message}). Trying the next one.`);
    }
  }
  if (lastError instanceof KitMediaError) throw lastError;
  throw new KitMediaError(
    `Transcription failed: ${/** @type {any} */ (lastError)?.message ?? 'no speech engine could run'}`,
  );
}
