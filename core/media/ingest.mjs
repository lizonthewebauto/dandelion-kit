// Makes the 1080x1920 work copy, the small proxy and the wav from a source video.
// Idempotent: the same source (by content hash) and the same options reuse the files already made.
import { stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runFfmpeg, KitMediaError } from './ffmpeg.mjs';
import { probeMedia } from './probe.mjs';
import { ensureDir, isFile, readJson, writeJson, renameWithRetry } from '../util/fs.mjs';
import { hashFile } from '../util/hash.mjs';

export const WORK = Object.freeze({ width: 1080, height: 1920, fps: 30 });
export const PROXY = Object.freeze({ width: 540, height: 960, fps: 15 });
/** The proxy size target: at most this many bytes per minute of video. */
export const PROXY_MAX_BYTES_PER_MINUTE = 6 * 1024 * 1024;
const INGEST_VERSION = 1;
const MARKER = 'ingest.json';

/**
 * @typedef {object} IngestResult
 * @property {string} source_hash
 * @property {import('../types.mjs').MediaInfo} source_media   Facts about the original file.
 * @property {import('../types.mjs').MediaInfo} work_media     Facts about work.mp4.
 * @property {{work:string, proxy:string, audio:string|null}} files  Absolute paths. audio is null when the video has no sound.
 * @property {boolean} reused                  True when nothing had to be encoded.
 * @property {'crop'|'pad'} fit
 */

/** The ffmpeg video filter that makes any source 1080x1920 at 30 fps. @param {'crop'|'pad'} fit */
export function workVideoFilter(fit) {
  const { width, height, fps } = WORK;
  const fitted =
    fit === 'pad'
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  return `${fitted},setsar=1,fps=${fps},format=yuv420p`;
}

/**
 * Make the work copy, proxy and wav in a project folder.
 * @param {string} sourcePath
 * @param {string} outDir                        Folder that receives work.mp4, proxy.mp4, audio.wav, ingest.json.
 * @param {{fit?: 'crop'|'pad', force?: boolean, sourceHash?: string, signal?: AbortSignal, onProgress?: (stage:string, fraction:number, message?:string) => void}} [options]
 * @returns {Promise<IngestResult>}
 */
export async function ingestVideo(sourcePath, outDir, options = {}) {
  const fit = options.fit ?? 'crop';
  const progress = options.onProgress ?? (() => {});
  const source = resolve(sourcePath);
  if (!isFile(source)) throw new KitMediaError(`I could not find a video at ${source}.`);
  ensureDir(outDir);

  progress('probe', 0, 'Reading the video');
  const source_media = await probeMedia(source);
  if (source_media.duration_ms <= 0) throw new KitMediaError('That video has no length. Try another file.');

  progress('hash', 0, 'Fingerprinting the file');
  const source_hash = options.sourceHash ?? (await hashFile(source));
  const bytes = (await stat(source)).size;

  const files = {
    work: join(outDir, 'work.mp4'),
    proxy: join(outDir, 'proxy.mp4'),
    audio: source_media.has_audio ? join(outDir, 'audio.wav') : null,
  };
  const marker = await readJson(join(outDir, MARKER));
  const outputsExist =
    isFile(files.work) && isFile(files.proxy) && (files.audio === null || isFile(files.audio));
  if (
    !options.force &&
    outputsExist &&
    marker?.version === INGEST_VERSION &&
    marker.source_hash === source_hash &&
    marker.fit === fit
  ) {
    const work_media = await probeMedia(files.work);
    progress('done', 1, 'Already prepared');
    return { source_hash, source_media, work_media, files, reused: true, fit };
  }

  const durationMs = source_media.duration_ms;
  const stageProgress =
    (stage, label) =>
    ({ time_ms }) =>
      progress(stage, Math.min(1, time_ms / durationMs), label);

  // 1. Work copy: 1080x1920, constant 30 fps, a keyframe every second so seeking is exact and fast.
  progress('work', 0, 'Making the 1080x1920 working copy');
  const workTemp = join(outDir, 'work.partial.mp4');
  const workArgs = ['-i', source, '-map', '0:v:0', '-vf', workVideoFilter(fit)];
  if (source_media.has_audio) workArgs.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  workArgs.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    String(WORK.fps),
    '-keyint_min',
    String(WORK.fps),
    '-pix_fmt',
    'yuv420p',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-movflags',
    '+faststart',
    workTemp,
  );
  await runFfmpeg(workArgs, {
    signal: options.signal,
    onProgress: stageProgress('work', 'Making the working copy'),
  });
  await renameWithRetry(workTemp, files.work);

  // 2. Proxy: small preview for cards. The maxrate keeps it near 5 MB per minute.
  progress('proxy', 0, 'Making the small preview');
  const proxyTemp = join(outDir, 'proxy.partial.mp4');
  const proxyArgs = [
    '-i',
    files.work,
    '-vf',
    `scale=${PROXY.width}:${PROXY.height}:flags=bicubic,fps=${PROXY.fps}`,
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-preset',
    'veryfast',
    '-crf',
    '30',
    '-maxrate',
    '700k',
    '-bufsize',
    '1400k',
    '-pix_fmt',
    'yuv420p',
  ];
  if (source_media.has_audio) proxyArgs.push('-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100');
  else proxyArgs.push('-an');
  proxyArgs.push('-map_metadata', '-1', '-movflags', '+faststart', proxyTemp);
  await runFfmpeg(proxyArgs, {
    signal: options.signal,
    onProgress: stageProgress('proxy', 'Making the small preview'),
  });
  await renameWithRetry(proxyTemp, files.proxy);

  // 3. Audio: 48 kHz mono wav, read back from the work copy so its timeline matches exactly.
  if (files.audio) {
    progress('audio', 0, 'Pulling out the sound');
    const audioTemp = join(outDir, 'audio.partial.wav');
    await runFfmpeg(
      [
        '-i',
        files.work,
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        audioTemp,
      ],
      { signal: options.signal },
    );
    await renameWithRetry(audioTemp, files.audio);
  } else {
    await rm(join(outDir, 'audio.wav'), { force: true });
  }

  const work_media = await probeMedia(files.work);
  await writeJson(join(outDir, MARKER), {
    version: INGEST_VERSION,
    source_hash,
    source_bytes: bytes,
    fit,
    created_at: Date.now(),
  });
  progress('done', 1, 'Ready');
  return { source_hash, source_media, work_media, files, reused: false, fit };
}
