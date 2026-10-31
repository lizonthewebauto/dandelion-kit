// Samples JPEG frames from a video, at chosen times or at a steady interval.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from './ffmpeg.mjs';
import { ensureDir } from '../util/fs.mjs';

/**
 * @typedef {object} SampledFrame
 * @property {number} t_ms
 * @property {string} path   Absolute path of the JPEG.
 */

/**
 * Pull one JPEG per requested time. Up to four ffmpeg runs go at once.
 * @param {string} videoPath
 * @param {number[]} timesMs
 * @param {string} outDir
 * @param {{width?: number, quality?: number, prefix?: string, signal?: AbortSignal}} [options]  quality is ffmpeg -q:v (2 best, 31 worst).
 * @returns {Promise<SampledFrame[]>}
 */
export async function sampleFrames(videoPath, timesMs, outDir, options = {}) {
  const width = options.width ?? 540;
  const quality = options.quality ?? 3;
  const prefix = options.prefix ?? 'frame';
  ensureDir(outDir);
  /** @type {SampledFrame[]} */
  const results = new Array(timesMs.length);
  let next = 0;
  async function worker() {
    while (next < timesMs.length) {
      const index = next++;
      const t_ms = Math.max(0, Math.round(timesMs[index]));
      const path = join(outDir, `${prefix}-${String(t_ms).padStart(7, '0')}.jpg`);
      await runFfmpeg(
        [
          '-ss',
          (t_ms / 1000).toFixed(3),
          '-i',
          videoPath,
          '-frames:v',
          '1',
          '-vf',
          `scale=${width}:-2`,
          '-q:v',
          String(quality),
          '-pix_fmt',
          'yuvj420p',
          path,
        ],
        { signal: options.signal },
      );
      results[index] = { t_ms, path };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, timesMs.length) }, worker));
  return results;
}

/**
 * Pull a frame every intervalMs in one pass (cheaper than many seeks). Frame k is at about k * intervalMs.
 * @param {string} videoPath
 * @param {number} intervalMs
 * @param {string} outDir
 * @param {{width?: number, height?: number, quality?: number, prefix?: string, signal?: AbortSignal}} [options]  height defaults to keeping the aspect ratio.
 * @returns {Promise<SampledFrame[]>}
 */
export async function sampleFramesEvery(videoPath, intervalMs, outDir, options = {}) {
  const width = options.width ?? 320;
  const height = options.height ?? -2;
  const quality = options.quality ?? 3;
  const prefix = options.prefix ?? 'tick';
  ensureDir(outDir);
  await runFfmpeg(
    [
      '-i',
      videoPath,
      '-vf',
      `fps=1000/${intervalMs},scale=${width}:${height}`,
      '-q:v',
      String(quality),
      '-pix_fmt',
      'yuvj420p',
      join(outDir, `${prefix}-%05d.jpg`),
    ],
    { signal: options.signal },
  );
  const names = (await readdir(outDir))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.jpg'))
    .sort();
  return names.map((name, index) => ({ t_ms: index * intervalMs, path: join(outDir, name) }));
}
