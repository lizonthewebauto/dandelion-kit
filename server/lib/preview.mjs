// The render functions (core/render/*) and the data for the kit-preview card.
// The card plays a small mp4 and shows 8 frames, both served in chunks through read_asset, so this makes them.
import { copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from '../../core/media/ffmpeg.mjs';
import { sampleFrames } from '../../core/media/frames.mjs';
import { ensureDir, isFile } from '../../core/util/fs.mjs';
import { projectDir, registerAsset, requireProject, updateProject } from '../store/project.mjs';
import { ToolFailure } from './kit.mjs';

/** The preview file is the proxy size so a 3 minute reel stays a few megabytes through read_asset. */
const PREVIEW_COPY_MAX_BYTES = 8 * 1024 * 1024;
const FRAME_COUNT = 8;

/**
 * Load one function from core/render. The render path is built separately, so a missing one is a plain message.
 * @param {string} file   File name without .mjs, for example "render".
 * @param {string} name   Export name, for example "renderReel".
 * @param {string} what   Plain words for the message.
 * @returns {Promise<(...args: any[]) => Promise<any>>}
 */
export async function renderFunction(file, name, what) {
  /** @type {any} */
  let mod = null;
  try {
    mod = await import(`../../core/render/${file}.mjs`);
  } catch {
    mod = null;
  }
  const fn = mod?.[name];
  if (typeof fn !== 'function') {
    throw new ToolFailure(`${what} is not built into this version of the kit yet. The editing steps before it still work.`);
  }
  return fn;
}

/** "v2" becomes "Variant B". @param {string} key */
export function renderLabel(key) {
  if (key === 'draft') return 'Draft';
  if (key === 'final') return 'Final';
  const m = /(\d+)$/.exec(key);
  if (m) return `Variant ${String.fromCharCode(64 + Math.min(26, Number(m[1])))}`;
  return key;
}

/**
 * Which render keys the card shows, in order: draft, final, then variants.
 * @param {import('../../core/types.mjs').Project} project
 */
export function renderKeys(project) {
  const keys = Object.keys(project.renders ?? {}).filter((k) => isFile(/** @type {any} */ (project.renders)[k].file));
  const rank = (/** @type {string} */ k) => (k === 'draft' ? 0 : k === 'final' ? 1 : 2);
  return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Make the small preview mp4 for one render.
 * @param {string} file     The render output.
 * @param {string} out
 * @param {number} bytes
 */
async function makePreviewVideo(file, out, bytes) {
  if (isFile(out)) return true;
  try {
    if (bytes <= PREVIEW_COPY_MAX_BYTES) {
      await copyFile(file, out);
      return true;
    }
    await runFfmpeg([
      '-y', '-i', file,
      '-vf', 'scale=540:960:flags=bicubic,fps=15',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
      '-movflags', '+faststart', out,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Data for the kit-preview card: every render the project has, with a preview video and 8 frames each.
 * Files for the card are made once per render and reused.
 * @param {string} projectId
 * @param {string} [active]   The render to show first. Defaults to the newest.
 */
export async function previewData(projectId, active) {
  const project = await requireProject(projectId);
  const keys = renderKeys(project);
  if (!keys.length) throw new ToolFailure('There is no finished render for this project yet. Build a draft first.');
  const renders = /** @type {Record<string, import('../../core/types.mjs').RenderResult>} */ (project.renders);

  /** @type {Record<string, {video?: string, frames: string[]}>} */
  const made = {};
  for (const key of keys) {
    const r = renders[key];
    const dir = ensureDir(join(projectDir(projectId), 'preview', `${key}-${r.rendered_at}`));
    const previewPath = join(dir, 'preview.mp4');
    const hasVideo = await makePreviewVideo(r.file, previewPath, r.bytes ?? (await stat(r.file)).size);
    const source = hasVideo ? previewPath : r.file;
    const duration = r.duration_ms || project.shot_plan?.duration_ms || 10000;
    const times = Array.from({ length: FRAME_COUNT }, (_, i) => Math.round(((i + 0.5) / FRAME_COUNT) * duration));
    /** @type {string[]} */
    let frames = [];
    try {
      frames = (await sampleFrames(source, times, join(dir, 'frames'), { width: 216, prefix: 'f' })).map((f) => f.path);
    } catch {
      frames = [];
    }
    made[key] = { video: hasVideo ? previewPath : undefined, frames };
    // Remember the paths in the project's file list so read_asset can serve them.
    await updateProject(projectId, async (p) => {
      if (hasVideo) await registerAsset(p, { path: previewPath, kind: 'output', label: `${renderLabel(key)} preview` });
      for (const f of frames) await registerAsset(p, { path: f, kind: 'frame', label: `${renderLabel(key)} frame` });
    });
  }

  const fresh = await requireProject(projectId);
  const idFor = (/** @type {string} */ path) => Object.values(fresh.assets).find((a) => a.path === path)?.id;
  const entries = keys.map((key) => {
    const r = renders[key];
    const variant = project.variants?.find((v) => v.id === key || v.id === r.variant_id);
    /** @type {Record<string, any>} */
    const entry = {
      id: key,
      label: renderLabel(key),
      quality: r.quality,
      file: r.file,
      duration_ms: r.duration_ms,
      bytes: r.bytes,
      plan_hash: r.plan_hash,
      checks: r.checks ?? [],
      frame_asset_ids: made[key].frames.map(idFor).filter(Boolean),
    };
    const videoId = made[key].video ? idFor(made[key].video) : undefined;
    if (videoId) entry.video_asset_id = videoId;
    if (r.variant_id) entry.variant_id = r.variant_id;
    if (variant?.axes) entry.axes = variant.axes;
    entry.stale = !r.variant_id && Boolean(project.shot_plan && r.plan_hash !== project.shot_plan.hash);
    return entry;
  });
  const newest = [...keys].sort((a, b) => renders[b].rendered_at - renders[a].rendered_at)[0];
  return { project_id: projectId, active: active && keys.includes(active) ? active : newest, renders: entries };
}
