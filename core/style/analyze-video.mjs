// Read cuts, color and sound locally. The host AI judges captions and the opening.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { probeMedia } from '../media/probe.mjs';
import { runFfmpeg } from '../media/ffmpeg.mjs';
import { sampleFrames } from '../media/frames.mjs';
import { kitHome } from '../util/fs.mjs';
import { engineStatus, transcribe, transformersCanRun, transformersModelStatus } from '../transcribe/whisper.mjs';
import { pixelStats } from './analyze-image.mjs';

const rounded = (n) => Math.round(n * 1000) / 1000;

/** A linear percentile, including both ends. @param {number[]} values @param {number} fraction */
export function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const place = (sorted.length - 1) * fraction;
  const low = Math.floor(place), high = Math.ceil(place);
  return rounded(sorted[low] + (sorted[high] - sorted[low]) * (place - low));
}

/** @param {string} text @param {number} limitMs */
export function sceneTimes(text, limitMs) {
  const times = [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000))
    .filter((t) => Number.isFinite(t) && t > 0 && t < limitMs).sort((a, b) => a - b);
  const kept = [];
  for (const time of times) if (!kept.length || time - kept[kept.length - 1] >= 250) kept.push(time);
  return kept;
}

/**
 * @param {string} path
 * @param {{outDir?:string,speech?:boolean,onProgress?:(fraction:number,message?:string)=>void,signal?:AbortSignal}} [options]
 * @returns {Promise<import('../types.mjs').SampleVideo & {analyzed_ms:number,keyframes:import('../media/frames.mjs').SampledFrame[]}>}
 */
export async function analyzeVideo(path, options = {}) {
  options.signal?.throwIfAborted();
  const report = options.onProgress ?? (() => {});
  report(0, 'Reading the sample video');
  const media = await probeMedia(path);
  if (media.duration_ms <= 0) throw new Error('The sample video needs a length greater than zero.');
  let outDir = options.outDir;
  if (!outDir) {
    const base = join(kitHome(), 'samples');
    await mkdir(base, { recursive: true, mode: 0o700 });
    outDir = await mkdtemp(join(base, 'video-'));
  }
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const analyzed_ms = Math.min(90000, media.duration_ms);
  const seconds = String(analyzed_ms / 1000);
  const latest = Math.max(0, analyzed_ms - Math.max(40, 1000 / Math.max(1, media.fps)));
  const frameOptions = { width: 320, prefix: 'key', signal: options.signal };
  report(0.1, 'Measuring the cuts');
  const sceneLog = await runFfmpeg([
    '-loglevel', 'info', '-i', path, '-t', seconds, '-an',
    '-vf', "fps=10,scale=160:-2,select='gt(scene,0.35)',showinfo", '-f', 'null', '-',
  ], { signal: options.signal });
  const cut_times_ms = sceneTimes(sceneLog.stderr, analyzed_ms);
  const boundaries = [0, ...cut_times_ms, analyzed_ms];
  const gaps = boundaries.slice(1).map((t, i) => t - boundaries[i]);
  const shot_ms = { p25: percentile(gaps, 0.25), median: percentile(gaps, 0.5), p75: percentile(gaps, 0.75) };
  report(0.3, 'Reading sample frames');
  const hook = [0, 500, 1000, 1500, 2000].filter((t) => t <= latest);
  const spread = Array.from({ length: 6 }, (_, i) => Math.round(latest * (i + 1) / 7));
  const keyframes = await sampleFrames(path, [...new Set([...hook, ...spread])].sort((a, b) => a - b), outDir, frameOptions);
  const gradeFrames = await sampleFrames(path, Array.from({ length: 8 }, (_, i) => Math.round(latest * i / 7)), outDir,
    { width: 96, prefix: 'color', signal: options.signal });
  const gradeSamples = [];
  for (const frame of gradeFrames) {
    const { data, info } = await sharp(frame.path).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    gradeSamples.push(pixelStats(data, info.width, info.height));
  }
  const mean = (key) => rounded(gradeSamples.reduce((sum, s) => sum + s[key], 0) / gradeSamples.length);
  const grade = { saturation: mean('saturation'), contrast: mean('contrast'), warmth: mean('warmth') };
  report(0.6, 'Measuring the sound');
  /** @type {number|null} */
  let loudness_lufs = null;
  if (media.has_audio) {
    try {
      const loud = await runFfmpeg(['-loglevel', 'info', '-i', path, '-t', seconds, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { signal: options.signal });
      const match = /"input_i"\s*:\s*"([^"]+)"/.exec(loud.stderr);
      const value = match ? Number(match[1]) : NaN;
      if (Number.isFinite(value)) loudness_lufs = value;
    } catch { options.signal?.throwIfAborted(); }
  }
  /** @type {'measured'|'unavailable'} */
  let speech = 'unavailable';
  let speech_note = !media.has_audio ? 'This video has no sound, so speech could not be measured.'
    : options.speech === false ? 'Speech was not measured for this sample.' : 'Speech could not be measured on this computer.';
  let word_count = 0;
  /** @type {number|null} */
  let words_per_minute = null;
  /** @type {{median:number,p90:number}|null} */
  let pause_ms = null;
  if (media.has_audio && options.speech !== false) {
    const audio = join(outDir, 'speech-sample.wav');
    try {
      const models = transformersModelStatus();
      const engines = await engineStatus();
      const available = engines.find((e) => e.available && (e.id !== 'transformers' || (transformersCanRun() && (models.base || models.tiny))));
      if (!available) {
        speech_note = 'Speech needs a model that is ready on this computer. The cuts, frames and colors were still measured.';
      } else {
        report(0.75, 'Reading up to one minute of speech');
        await runFfmpeg(['-i', path, '-t', String(Math.min(60000, analyzed_ms) / 1000), '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio], { signal: options.signal });
        const transcript = await transcribe(audio, {
          engine: available.id, model: models.base ? 'base' : 'tiny', signal: options.signal,
          onProgress: (_stage, fraction, message) => report(0.75 + Math.max(0, Math.min(1, fraction)) * 0.2, message),
        });
        const words = transcript.words;
        word_count = words.length;
        const pauses = words.slice(1).map((w, i) => w.start_ms - words[i].end_ms).filter((n) => n >= 250);
        const speaking = words.length ? words[words.length - 1].end_ms - words[0].start_ms - pauses.reduce((a, b) => a + b, 0) : 0;
        if (words.length && speaking > 0) {
          words_per_minute = rounded(words.length * 60000 / speaking);
          pause_ms = pauses.length ? { median: percentile(pauses, 0.5), p90: percentile(pauses, 0.9) } : null;
          speech = 'measured';
          speech_note = words.length < 20 ? 'Fewer than 20 words were heard, so speech pace and pauses are a small sample.' : '';
        }
      }
    } catch {
      options.signal?.throwIfAborted();
      speech_note = 'Speech could not be measured here. The cuts, frames and colors were still measured.';
    } finally {
      await rm(audio, { force: true });
    }
  }
  const cadenceLow = analyzed_ms < 8000 || cut_times_ms.length < 3;
  const confidence = cadenceLow || word_count < 20 ? 'low' : 'ok';
  const notes = [];
  if (cadenceLow) notes.push('This clip has too few cuts to tell how fast it is cut; tell me how it feels.');
  if (word_count < 20) notes.push('Fewer than 20 words were heard, so speech pace and pauses are a small sample.');
  report(1, 'Sample video read');
  return {
    path, duration_ms: media.duration_ms, width: media.width, height: media.height, fps: media.fps,
    analyzed_ms, cut_times_ms, shot_ms, cuts_per_10s: rounded(cut_times_ms.length * 10000 / analyzed_ms),
    grade, loudness_lufs, speech, ...(speech_note ? { speech_note } : {}),
    word_count, words_per_minute, pause_ms, confidence, confidence_note: notes.join(' ') || 'The sample has enough cuts and speech to measure these choices.',
    keyframes,
  };
}
