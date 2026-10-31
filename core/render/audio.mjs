// Two-pass loudness and the sound effect mix.
//   speech.wav   the kept pieces of the sound track, joined
//   pass 1       measure it (loudnorm, JSON)
//   pass 2       normalize to -14 LUFS with a -1 dBTP ceiling, mix the effects under it, write mix.wav
// Each effect's level is set so its loudest point sits at its `gain_db` (usually -12 dBFS), which keeps it under the voice.
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildSpeechGraph } from './filtergraph.mjs';
import { ffmpegLog } from './run.mjs';
import { ensureSfx } from './sfx.mjs';

export const LOUDNESS = Object.freeze({ lufs: -14, true_peak: -1, lra: 11 });

/**
 * Read the JSON block loudnorm prints at the end of a pass.
 * @param {string} log
 * @returns {{input_i: string, input_tp: string, input_lra: string, input_thresh: string, target_offset: string} | null}
 */
export function parseLoudnormJson(log) {
  const end = log.lastIndexOf('}');
  const start = log.lastIndexOf('{', end);
  if (start < 0 || end < 0) return null;
  try {
    const json = JSON.parse(log.slice(start, end + 1));
    return json && 'input_i' in json ? json : null;
  } catch {
    return null;
  }
}

/**
 * The loudnorm filter text for pass 2, using the pass 1 numbers (or a one-pass fallback when the speech was silent).
 * @param {ReturnType<typeof parseLoudnormJson>} measured
 */
export function loudnormFilter(measured) {
  const base = `loudnorm=I=${LOUDNESS.lufs}:TP=${LOUDNESS.true_peak}:LRA=${LOUDNESS.lra}`;
  if (!measured) return base;
  const finite = [
    measured.input_i,
    measured.input_tp,
    measured.input_lra,
    measured.input_thresh,
    measured.target_offset,
  ].every((v) => Number.isFinite(Number(v)));
  if (!finite) return base;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
}

/**
 * Build the final sound track.
 * @param {object} input
 * @param {string} input.dir                       Working folder (ffmpeg runs here).
 * @param {string} input.audio_path                48 kHz wav of the work copy.
 * @param {import('./filtergraph.mjs').Segment[]} input.segments
 * @param {import('../types.mjs').SfxCue[]} input.sfx
 * @param {number} input.duration_ms
 * @param {{sfx_dir?: string, signal?: AbortSignal}} [options]
 * @returns {Promise<{file: string, measured: ReturnType<typeof parseLoudnormJson>, sfx_used: number}>}
 */
export async function buildAudioMix({ dir, audio_path, segments, sfx, duration_ms }, options = {}) {
  const speechGraph = join(dir, 'speech.txt');
  await writeFile(speechGraph, buildSpeechGraph(segments));
  await ffmpegLog(
    [
      '-i',
      audio_path,
      '-/filter_complex',
      'speech.txt',
      '-map',
      '[speech]',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      'speech.wav',
    ],
    { cwd: dir, signal: options.signal },
  );

  const pass1 = await ffmpegLog(
    [
      '-i',
      'speech.wav',
      '-af',
      `loudnorm=I=${LOUDNESS.lufs}:TP=${LOUDNESS.true_peak}:LRA=${LOUDNESS.lra}:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    { cwd: dir, signal: options.signal },
  );
  const measured = parseLoudnormJson(pass1);

  const library = sfx.length ? ensureSfx(options.sfx_dir) : null;
  const cues = library ? sfx.filter((c) => library.files[c.name] && c.out_ms < duration_ms - 50) : [];
  const inputs = ['-i', 'speech.wav'];
  const graph = [`[0:a]${loudnormFilter(measured)},aresample=48000[sp]`];
  cues.forEach((cue, i) => {
    const file = /** @type {NonNullable<typeof library>} */ (library).files[cue.name];
    inputs.push('-i', file.path);
    // Bring the effect's loudest point to gain_db (dBFS), whatever level the file was made at.
    const db = cue.gain_db - 20 * Math.log10(file.peak || 1);
    graph.push(
      `[${i + 1}:a]volume=${db.toFixed(2)}dB,adelay=${Math.max(0, Math.round(cue.out_ms))}|${Math.max(0, Math.round(cue.out_ms))}[f${i}]`,
    );
  });
  if (cues.length) {
    graph.push(
      `[sp]${cues.map((_, i) => `[f${i}]`).join('')}amix=inputs=${cues.length + 1}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.89:level=false[mix]`,
    );
  } else {
    graph.push('[sp]alimiter=limit=0.89:level=false[mix]');
  }
  await writeFile(join(dir, 'mix.txt'), graph.join(';\n') + '\n');
  await ffmpegLog(
    [
      ...inputs,
      '-/filter_complex',
      'mix.txt',
      '-map',
      '[mix]',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      'mix.wav',
    ],
    { cwd: dir, signal: options.signal },
  );
  return { file: join(dir, 'mix.wav'), measured, sfx_used: cues.length };
}
