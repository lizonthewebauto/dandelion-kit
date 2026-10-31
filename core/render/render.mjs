// Draft and final renders, render cache, one render at a time, disk preflight.
//   draft  540x960, 15 fps, crf 30, ultrafast, small "DRAFT" stamp: for the preview card
//   final  1080x1920, 30 fps, h264 crf 20, aac 160k at 48 kHz, faststart
// A render is built once from the shot plan. The same plan, cut and quality give the same file, so a repeat is free.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getLook } from '../edit/looks.mjs';
import { hashShotPlan } from '../edit/shotplan.mjs';
import { probeMedia } from '../media/probe.mjs';
import { requireFreeSpace } from '../util/disk.mjs';
import { ensureDir, kitHome, readJson, writeJson } from '../util/fs.mjs';
import { hashJson } from '../util/hash.mjs';
import { info } from '../util/log.mjs';
import {
  projectDir,
  registerAsset,
  requireProject,
  updateProject,
  ProjectError,
} from '../../server/store/project.mjs';
import { buildAss, fontFilesFor } from './ass.mjs';
import { buildAudioMix } from './audio.mjs';
import { checkReel } from './checks.mjs';
import { anchorForPlan, captionAnchor } from './facezone.mjs';
import { buildVideoGraph, gradeFilters, QUALITY, snapPieces, WORK_FPS } from './filtergraph.mjs';
import { ffmpegLog } from './run.mjs';

/** Bump when the render recipe changes, so cached files from an older recipe are not reused. */
export const RENDER_VERSION = 1;

/** @typedef {(stage: string, fraction: number, message?: string) => void} ProgressFn */

// ---------------------------------------------------------------------------
// One render at a time
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
/** @type {Promise<unknown>} */
let queue = Promise.resolve();

function lockPath() {
  return join(kitHome(), 'render.lock');
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {any} */ (error)?.code === 'EPERM';
  }
}

/**
 * Run a job while no other render is running. Jobs in this process wait their turn; another process
 * holding the lock gives a plain error.
 * @template T
 * @param {() => Promise<T>} job
 * @returns {Promise<T>}
 */
export function withRenderLock(job) {
  const run = queue
    .catch(() => {})
    .then(async () => {
      ensureDir(kitHome());
      const path = lockPath();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
          break;
        } catch (error) {
          if (/** @type {any} */ (error)?.code !== 'EEXIST') throw error;
          const held = await readJson(path, null);
          const stale =
            !held ||
            !processAlive(held.pid) ||
            Date.now() - (held.at ?? 0) > LOCK_STALE_MS ||
            held.pid === process.pid;
          if (!stale)
            throw new Error(
              `Another render is already running (process ${held.pid}). Wait for it to finish, then try again.`,
            );
          rmSync(path, { force: true });
          if (attempt === 1) throw error;
        }
      }
      try {
        return await job();
      } finally {
        rmSync(path, { force: true });
      }
    });
  queue = run;
  return run;
}

// ---------------------------------------------------------------------------
// Cache key and paths
// ---------------------------------------------------------------------------

/**
 * @param {import('../types.mjs').ShotPlan} plan
 * @param {import('../types.mjs').CutPlan} cut
 * @param {'draft'|'final'} quality
 * @param {string} workFingerprint
 */
export function renderKey(plan, cut, quality, workFingerprint) {
  return hashJson({
    v: RENDER_VERSION,
    plan: plan.hash,
    quality,
    work: workFingerprint,
    pieces: cut.pieces.map((p) => [p.src_start_ms, p.src_end_ms, p.out_start_ms, p.out_end_ms]),
  }).slice(0, 12);
}

/** @param {string} projectId */
export function renderFolder(projectId) {
  return join(projectDir(projectId), 'render');
}

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

/**
 * Render one plan to an mp4. Shared by renderReel and makeVariants.
 * @param {object} input
 * @param {string} input.projectId
 * @param {import('../types.mjs').ShotPlan} input.plan
 * @param {'draft'|'final'} input.quality
 * @param {string} [input.key]            Where to record the result in project.renders ("draft", "final" or a variant id).
 * @param {string} [input.variant_id]
 * @param {ProgressFn} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @param {boolean} [input.force]         Ignore the cache.
 * @returns {Promise<import('../types.mjs').RenderResult & {reused?: boolean, warnings?: string[]}>}
 */
export async function renderPlan({
  projectId,
  plan,
  quality,
  key,
  variant_id,
  onProgress,
  signal,
  force = false,
}) {
  if (!QUALITY[quality]) throw new ProjectError(`Quality must be "draft" or "final", not "${quality}".`);
  const progress = onProgress ?? (() => {});
  let project = await requireProject(projectId);
  if (project.type !== 'video') throw new ProjectError('Only a video project can be rendered as a reel.');
  if (!project.cut || !project.cut.pieces?.length)
    throw new ProjectError('This video has no rough cut yet. Run the rough cut first.');
  const work = Object.values(project.assets).find((a) => a.kind === 'work');
  const audio = Object.values(project.assets).find((a) => a.kind === 'audio');
  if (!work || !existsSync(work.path))
    throw new ProjectError('The working copy of this video is missing. Open the video again.');
  if (!audio || !existsSync(audio.path))
    throw new ProjectError('This video has no sound to build a reel from.');
  const label = variant_id ?? quality;
  const recordKey = key ?? label;

  // Where the captions go: under the chin, found once per video.
  /** @type {import('../types.mjs').ShotPlan} */
  let use = plan;
  if (!use.caption_anchor) {
    const anchor = await anchorForPlan(projectId, use, progress);
    use = { ...use, caption_anchor: /** @type {any} */ (anchor) };
    use.hash = hashShotPlan(use);
  }

  const cut = project.cut;
  const fingerprint = `${work.bytes}:${statSync(work.path).mtimeMs}`;
  const cacheKey = renderKey(use, cut, quality, fingerprint);
  const folder = ensureDir(renderFolder(projectId));
  const outFile = join(folder, `${label}-${cacheKey}.mp4`);
  const sidecar = join(folder, `${label}-${cacheKey}.json`);

  if (!force && existsSync(outFile) && existsSync(sidecar)) {
    const stored = await readJson(sidecar, null);
    if (stored?.file === outFile) {
      await recordResult(projectId, recordKey, stored, outFile, label, quality);
      progress('done', 1, 'Already built');
      return { ...stored, reused: true };
    }
  }

  return withRenderLock(async () => {
    await requireFreeSpace(folder);
    const started = Date.now();
    const build = ensureDir(join(folder, `build-${label}`));
    try {
      const { segments, total_frames } = snapPieces(cut.pieces, WORK_FPS);
      const q = QUALITY[quality];
      const durationSec = total_frames / WORK_FPS;

      // Captions and the fonts they need, side by side so ffmpeg can use relative paths.
      const fontsDir = ensureDir(join(build, 'fonts'));
      for (const f of fontFilesFor()) copyFileSync(f, join(fontsDir, basename(f)));
      const ass = buildAss(use, { quality });
      await writeFile(join(build, 'captions.ass'), ass.text);

      progress('audio', 0, 'Mixing the sound');
      const mix = await buildAudioMix(
        { dir: build, audio_path: audio.path, segments, sfx: use.sfx, duration_ms: use.duration_ms },
        { signal },
      );
      progress('audio', 1, 'Sound ready');

      progress('video', 0, 'Building the video');
      await writeFile(
        join(build, 'video.txt'),
        buildVideoGraph({ segments, camera: use.camera, look_id: use.look_id, quality }),
      );
      const args = [
        '-i',
        work.path,
        '-i',
        mix.file,
        '-/filter_complex',
        'video.txt',
        '-map',
        '[vout]',
        '-map',
        '1:a',
        '-c:v',
        'libx264',
        '-preset',
        q.preset,
        '-crf',
        String(q.crf),
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(q.fps),
        '-g',
        String(q.fps * 2),
        '-c:a',
        'aac',
        '-b:a',
        q.audio_bitrate,
        '-ar',
        '48000',
        '-ac',
        '2',
        '-t',
        durationSec.toFixed(3),
        '-map_metadata',
        '-1',
        '-movflags',
        '+faststart',
        outFile,
      ];
      if (quality === 'final') args.splice(args.indexOf('-pix_fmt'), 0, '-profile:v', 'high');
      else args.splice(args.indexOf('-pix_fmt'), 0, '-maxrate', '900k', '-bufsize', '1800k');
      let lastReport = -1;
      await ffmpegLog(args, {
        cwd: build,
        signal,
        onProgress: ({ time_ms }) => {
          const f = Math.min(1, time_ms / (durationSec * 1000));
          progress('video', f, 'Building the video');
          const step = Math.floor(f * 10);
          if (step > lastReport) {
            lastReport = step;
            info(`render ${label}: ${step * 10}%`);
          }
        },
      });

      progress('checks', 0, 'Checking the result');
      const cut_points_ms = segments.slice(1).map((s) => Math.round((s.out_frame * 1000) / WORK_FPS));
      const checks = await checkReel({ file: outFile, plan: use, quality, cut_points_ms });
      const media = await probeMedia(outFile);
      /** @type {import('../types.mjs').RenderResult & {warnings?: string[]}} */
      const result = {
        file: outFile,
        quality,
        plan_hash: use.hash,
        duration_ms: media.duration_ms,
        bytes: statSync(outFile).size,
        checks,
        rendered_at: Date.now(),
      };
      if (variant_id) result.variant_id = variant_id;
      const anchor = /** @type {any} */ (use.caption_anchor);
      if (anchor?.note) result.warnings = [anchor.note];
      writeFileSync(join(folder, `${label}-${cacheKey}.ass`), ass.text);
      await writeJson(sidecar, result);
      await recordResult(
        projectId,
        recordKey,
        result,
        outFile,
        label,
        quality,
        join(folder, `${label}-${cacheKey}.ass`),
      );
      removeOlder(folder, label, cacheKey);
      progress('done', 1, `Done in ${Math.round((Date.now() - started) / 1000)} s`);
      return result;
    } finally {
      rmSync(build, { recursive: true, force: true });
    }
  });
}

/**
 * Save a result on the project and register its files.
 * @param {string} projectId
 * @param {string} recordKey
 * @param {import('../types.mjs').RenderResult} result
 * @param {string} outFile
 * @param {string} label
 * @param {'draft'|'final'} quality
 * @param {string} [assFile]
 */
async function recordResult(projectId, recordKey, result, outFile, label, quality, assFile) {
  await updateProject(projectId, async (p) => {
    await registerAsset(p, {
      path: outFile,
      kind: 'output',
      label: label === 'draft' ? 'Draft preview' : label === 'final' ? 'Final reel' : `Variant ${label}`,
    });
    if (assFile && existsSync(assFile))
      await registerAsset(p, { path: assFile, kind: 'caption', label: `Captions for ${label}` });
    p.renders = { ...(p.renders ?? {}), [recordKey]: result };
    // Forget assets whose files are gone (older renders removed by removeOlder).
    for (const [id, asset] of Object.entries(p.assets)) if (!existsSync(asset.path)) delete p.assets[id];
  });
}

/** Delete earlier renders of the same label (they are this kit's own files and are replaced by this one). */
function removeOlder(folder, label, keepKey) {
  for (const name of readdirSync(folder)) {
    const m = /^(.+)-([0-9a-f]{12})\.(mp4|json|ass)$/.exec(name);
    if (m && m[1] === label && m[2] !== keepKey) rmSync(join(folder, name), { force: true });
  }
}

/**
 * Render the project's shot plan.
 * @param {object} input
 * @param {string} input.projectId
 * @param {'draft'|'final'} input.quality
 * @param {ProgressFn} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @param {boolean} [input.force]
 * @returns {Promise<import('../types.mjs').RenderResult>}
 */
export async function renderReel({ projectId, quality, onProgress, signal, force }) {
  if (!QUALITY[quality]) throw new ProjectError(`Quality must be "draft" or "final", not "${quality}".`);
  let project = await requireProject(projectId);
  if (!project.shot_plan) throw new ProjectError('This video has no shot plan yet. Plan the shots first.');
  if (!project.shot_plan.caption_anchor) {
    // Find where captions go and save it in the plan, so the plan's hash and the render agree.
    await captionAnchor({ projectId, onProgress });
    project = await requireProject(projectId);
  }
  return renderPlan({
    projectId,
    plan: /** @type {import('../types.mjs').ShotPlan} */ (project.shot_plan),
    quality,
    onProgress,
    signal,
    force,
  });
}

// ---------------------------------------------------------------------------
// One-frame caption sample for the look picker
// ---------------------------------------------------------------------------

/**
 * Draw one caption on a frame of the video in a given look, as a small JPEG, and register it.
 * @param {object} input
 * @param {string} input.projectId
 * @param {string} input.look            A look id.
 * @param {string} [input.captionTheme]  Overrides the look's caption theme.
 * @returns {Promise<string>}            The asset id of the JPEG.
 */
export async function renderLookSample({ projectId, look, captionTheme }) {
  const project = await requireProject(projectId);
  const lk = getLook(look, captionTheme ? { caption_theme: captionTheme } : {});
  const work = Object.values(project.assets).find((a) => a.kind === 'work');
  if (!work || !existsSync(work.path))
    throw new ProjectError('The working copy of this video is missing. Open the video again.');
  const anchor = await anchorForPlan(projectId, project.shot_plan);

  // A few real words from the middle of the video, with the second one lit.
  const words = project.transcript?.words ?? [];
  const mid = Math.max(0, Math.floor(words.length / 2) - 2);
  const picked = words.slice(mid, mid + 4);
  const text = picked.length ? picked.map((w) => w.text).join(' ') : 'Say it like you mean it';
  const idx = picked.length
    ? picked.map((_, i) => mid + i)
    : [0, 1, 2, 3, 4].slice(0, text.split(' ').length);
  const t_ms = picked.length
    ? Math.round((picked[0].start_ms + picked[picked.length - 1].end_ms) / 2)
    : Math.round((project.media?.duration_ms ?? 4000) / 2);

  /** @type {import('../types.mjs').ShotPlan} */
  const plan = {
    look_id: lk.id,
    caption_theme: lk.caption_theme,
    accent: lk.accent,
    seed: 1,
    duration_ms: 1000,
    beats: [
      {
        id: 'b1',
        kind: 'default',
        out_start_ms: 0,
        out_end_ms: 1000,
        first_word: idx[0],
        last_word: idx[idx.length - 1],
        text,
        treatment: 'face',
        emphasis_words: [idx[1] ?? idx[0]],
      },
    ],
    captions: [
      { start_ms: 0, end_ms: 1000, word_indexes: idx, text, active_word: Math.min(1, idx.length - 1) },
    ],
    camera: [],
    sfx: [],
    hook: { text: '', formula: '', score: 0, candidates: [] },
    caption_anchor: anchor,
    hash: '',
  };
  plan.hash = hashShotPlan(plan);

  const folder = ensureDir(join(projectDir(projectId), 'samples'));
  const name = `${lk.id}-${lk.caption_theme}-${hashJson({ v: RENDER_VERSION, plan: plan.hash, text }).slice(0, 8)}`;
  const outFile = join(folder, `${name}.jpg`);
  if (!existsSync(outFile)) {
    const build = ensureDir(join(folder, `build-${name}`));
    try {
      const fontsDir = ensureDir(join(build, 'fonts'));
      for (const f of fontFilesFor()) copyFileSync(f, join(fontsDir, basename(f)));
      await writeFile(join(build, 'c.ass'), buildAss(plan, { quality: 'final' }).text);
      const grade = gradeFilters(lk.id);
      await ffmpegLog(
        [
          '-ss',
          (t_ms / 1000).toFixed(3),
          '-i',
          work.path,
          '-frames:v',
          '1',
          '-vf',
          ['scale=540:960', ...grade, 'ass=c.ass:fontsdir=fonts', 'format=yuvj420p'].join(','),
          '-q:v',
          '3',
          outFile,
        ],
        { cwd: build },
      );
    } finally {
      rmSync(build, { recursive: true, force: true });
    }
  }
  const { result } = await updateProject(projectId, async (p) => {
    const asset = await registerAsset(p, {
      path: outFile,
      kind: 'sample',
      label: `${lk.name} caption sample`,
    });
    return asset.id;
  });
  return /** @type {string} */ (result);
}
