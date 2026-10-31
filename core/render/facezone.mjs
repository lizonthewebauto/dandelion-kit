// Face boxes from sampled frames, and the caption anchor just under the chin.
// The face finder is YuNet (MIT, 230 KB) run through onnxruntime-node. Frames are sampled every 500 ms
// from the 1080x1920 work copy. When no face is found in enough frames the anchor falls back to a fixed height.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { ensureDir, modelsDir } from '../util/fs.mjs';
import { info, warn } from '../util/log.mjs';
import { hashShotPlan } from '../edit/shotplan.mjs';
import { streamRawFrames } from './run.mjs';
import { requireProject, saveProject, updateProject } from '../../server/store/project.mjs';

export const YUNET_FILE = 'face_detection_yunet_2023mar.onnx';
export const YUNET_URL =
  'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx';
export const YUNET_SHA256 = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4';

export const FRAME = Object.freeze({ width: 1080, height: 1920 });
export const SAMPLE_INTERVAL_MS = 500;
/** The model takes a fixed 640x640 square; a 9:16 frame is shrunk to 360x640 and padded on the right. */
const INPUT = 640;
const SHRUNK_W = 360;
const SCALE_BACK = FRAME.height / INPUT;

export const ANCHOR_RULES = Object.freeze({
  /** Space between the chin and the caption block. */
  inflate_px: 40,
  /** The block also starts at least this share of the frame height below the chin. */
  min_gap_ratio: 0.04,
  /** Anchor stays between these shares of the frame height. */
  clamp_min: 0.5,
  clamp_max: 0.78,
  /** Small chin movements are ignored. */
  deadband_ratio: 0.015,
  median_window: 5,
  min_key_spacing_ms: 400,
  max_keys: 40,
  /** Fixed height (share of the frame) when there is no usable face. */
  fallback_ratio: 0.72,
  /** Share of samples that must hold a face for the face anchor to be used. */
  min_face_ratio: 0.6,
  /** Zoom used to allow for punch-ins when no plan exists yet. */
  default_zoom: 1.12,
  /** How the camera crops a punch-in: the crop sits this far down the spare height. */
  crop_bias: 0.4,
});

// ---------------------------------------------------------------------------
// Model file
// ---------------------------------------------------------------------------

/** Where the face model lives. */
export function yunetPath() {
  return join(modelsDir(), YUNET_FILE);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** True when the model file is on disk and matches the pinned hash. */
export function yunetReady() {
  const path = yunetPath();
  return existsSync(path) && sha256File(path) === YUNET_SHA256;
}

/**
 * Download the face model once, check it against the pinned sha256, and return its path.
 * @param {{fetch?: typeof fetch}} [options]
 */
export async function ensureYunet(options = {}) {
  const path = yunetPath();
  if (yunetReady()) return path;
  ensureDir(modelsDir());
  info('Downloading the face finder model (230 KB), once.');
  const response = await (options.fetch ?? fetch)(YUNET_URL, { redirect: 'follow' });
  if (!response.ok || !response.body)
    throw new Error(`I could not download the face model (HTTP ${response.status}).`);
  const temp = `${path}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(temp));
    if (sha256File(temp) !== YUNET_SHA256)
      throw new Error('The face model download did not match its fingerprint, so I threw it away.');
    rmSync(path, { force: true });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return path;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Read the model's 12 outputs into face boxes in the 640x640 input space.
 * @param {Record<string, {data: Float32Array | number[]}>} out
 * @param {string[]} names  Output names in model order.
 * @param {{score?: number, nms?: number}} [options]
 * @returns {{x:number,y:number,w:number,h:number,score:number}[]}
 */
export function decodeYunet(out, names, options = {}) {
  const threshold = options.score ?? 0.6;
  const strides = [8, 16, 32];
  /** @type {{x:number,y:number,w:number,h:number,score:number}[]} */
  const boxes = [];
  strides.forEach((stride, k) => {
    const cls = out[names[k]].data;
    const obj = out[names[k + 3]].data;
    const bbox = out[names[k + 6]].data;
    const cells = INPUT / stride;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const i = r * cells + c;
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (score < threshold) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
      }
    }
  });
  return nonMaxSuppression(boxes, options.nms ?? 0.3);
}

/** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Keep the best box of each cluster of overlapping boxes.
 * @template {{x:number,y:number,w:number,h:number,score:number}} T
 * @param {T[]} boxes
 * @param {number} limit
 * @returns {T[]}
 */
export function nonMaxSuppression(boxes, limit) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  /** @type {T[]} */
  const kept = [];
  for (const b of sorted) if (kept.every((k) => overlap(k, b) <= limit)) kept.push(b);
  return kept;
}

/** @type {Promise<any> | null} */
let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import('onnxruntime-node');
      const path = await ensureYunet();
      const session = await ort.InferenceSession.create(path, { logSeverityLevel: 3 });
      return { ort, session };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/**
 * Find the speaker's head in the work copy, one sample every 500 ms.
 * @param {string} workPath
 * @param {{interval_ms?: number, signal?: AbortSignal, onProgress?: (fraction: number) => void, duration_ms?: number}} [options]
 * @returns {Promise<import('../types.mjs').FaceSample[]>}
 */
export async function detectFaces(workPath, options = {}) {
  const interval = options.interval_ms ?? SAMPLE_INTERVAL_MS;
  const { ort, session } = await getSession();
  const frameBytes = INPUT * INPUT * 3;
  /** @type {import('../types.mjs').FaceSample[]} */
  const samples = [];
  const args = [
    '-i',
    workPath,
    '-vf',
    `fps=1000/${interval},scale=${SHRUNK_W}:${INPUT},pad=${INPUT}:${INPUT}:0:0:black`,
    '-pix_fmt',
    'bgr24',
    '-f',
    'rawvideo',
    'pipe:1',
  ];
  await streamRawFrames(
    args,
    frameBytes,
    async (frame, index) => {
      // Packed BGR to planar BGR floats (the model wants 0..255, channels first).
      const plane = INPUT * INPUT;
      const data = new Float32Array(plane * 3);
      for (let p = 0; p < plane; p++) {
        data[p] = frame[p * 3];
        data[plane + p] = frame[p * 3 + 1];
        data[2 * plane + p] = frame[p * 3 + 2];
      }
      const t_ms = index * interval;
      samples[index] = { t_ms, box: null };
      const result = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, INPUT, INPUT]),
      });
      const faces = decodeYunet(result, session.outputNames);
      // The speaker is the biggest face found.
      faces.sort((a, b) => b.w * b.h - a.w * a.h);
      const best = faces[0];
      if (best) {
        samples[index].box = {
          x: Math.round(best.x * SCALE_BACK),
          y: Math.round(best.y * SCALE_BACK),
          w: Math.round(best.w * SCALE_BACK),
          h: Math.round(best.h * SCALE_BACK),
        };
      }
      if (options.duration_ms) options.onProgress?.(Math.min(1, t_ms / options.duration_ms));
    },
    { signal: options.signal },
  );
  return samples;
}

// ---------------------------------------------------------------------------
// Anchor
// ---------------------------------------------------------------------------

/** @param {number[]} values */
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Where the chin sits in the output once the camera has zoomed by `zoom`.
 * The camera scales the frame and crops it with the crop sitting 40% of the way down the spare height.
 * @param {number} chin_y   Chin in the unzoomed 1080x1920 frame.
 * @param {number} zoom
 */
export function chinAtZoom(chin_y, zoom) {
  return chin_y * zoom - ANCHOR_RULES.crop_bias * FRAME.height * (zoom - 1);
}

/**
 * A smooth chin height over time: median of 5, ignore small moves, at most 40 keys at least 400 ms apart.
 * @param {import('../types.mjs').FaceSample[]} samples
 * @returns {{t_ms: number, chin_y: number}[]}
 */
export function chinTrack(samples) {
  const chins = samples.map((s) => (s.box ? s.box.y + s.box.h : null));
  const window = ANCHOR_RULES.median_window;
  const half = window >> 1;
  /** @type {{t_ms: number, chin_y: number}[]} */
  const keys = [];
  let held = NaN;
  let lastKeyAt = -Infinity;
  const deadband = ANCHOR_RULES.deadband_ratio * FRAME.height;
  samples.forEach((s, i) => {
    const near = chins.slice(Math.max(0, i - half), i + half + 1).filter((v) => v !== null);
    if (near.length === 0) return;
    const smooth = median(/** @type {number[]} */ (near));
    const moved = Number.isNaN(held) || Math.abs(smooth - held) > deadband;
    if (
      moved &&
      s.t_ms - lastKeyAt >= ANCHOR_RULES.min_key_spacing_ms &&
      keys.length < ANCHOR_RULES.max_keys
    ) {
      held = smooth;
      lastKeyAt = s.t_ms;
      keys.push({ t_ms: s.t_ms, chin_y: Math.round(smooth) });
    }
  });
  return keys;
}

/**
 * @typedef {object} CaptionAnchor
 * @property {number} x
 * @property {number} y                 Top of the caption block in the 1080x1920 frame.
 * @property {'face'|'fallback'} source
 * @property {number} face_ratio        Share of samples that held a face.
 * @property {number} [chin_y]          Chin height used (unzoomed frame).
 * @property {string} [note]            Plain sentence when the fallback was used.
 */

/**
 * Work out the one caption anchor for a video.
 * @param {import('../types.mjs').FaceSample[]} samples
 * @param {{zoom?: number}} [options]  Largest zoom the plan uses; the chin sits lower at higher zoom.
 * @returns {CaptionAnchor}
 */
export function anchorFromSamples(samples, options = {}) {
  const total = samples.length;
  const found = samples.filter((s) => s.box).length;
  const ratio = total === 0 ? 0 : found / total;
  const H = FRAME.height;
  const fallbackY = Math.round(ANCHOR_RULES.fallback_ratio * H);
  if (total === 0 || ratio < ANCHOR_RULES.min_face_ratio) {
    return {
      x: FRAME.width / 2,
      y: fallbackY,
      source: 'fallback',
      face_ratio: Math.round(ratio * 100) / 100,
      note:
        total === 0
          ? 'No face data, so captions sit at a fixed height.'
          : `A face was found in only ${Math.round(ratio * 100)}% of the video, so captions sit at a fixed height.`,
    };
  }
  const track = chinTrack(samples);
  const chin = median(track.map((k) => k.chin_y));
  const zoom = Math.max(1, options.zoom ?? ANCHOR_RULES.default_zoom);
  const gap = Math.max(ANCHOR_RULES.inflate_px, ANCHOR_RULES.min_gap_ratio * H);
  const raw = chinAtZoom(chin, zoom) + gap;
  const y = Math.round(Math.min(ANCHOR_RULES.clamp_max * H, Math.max(ANCHOR_RULES.clamp_min * H, raw)));
  return {
    x: FRAME.width / 2,
    y,
    source: 'face',
    face_ratio: Math.round(ratio * 100) / 100,
    chin_y: Math.round(chin),
  };
}

/** Largest zoom a plan reaches. @param {import('../types.mjs').ShotPlan | undefined} plan */
export function maxZoomOf(plan) {
  if (!plan || !plan.camera?.length) return ANCHOR_RULES.default_zoom;
  return Math.max(1, ...plan.camera.map((m) => Math.max(m.zoom_from, m.zoom_to)));
}

/**
 * Face samples for a project, found once and kept on the project (project.face_samples).
 * Returns an empty list (and a plain reason) when the face finder cannot run, so captions can still fall back.
 * @param {string} projectId
 * @param {(stage: string, fraction: number, message?: string) => void} [onProgress]
 * @param {boolean} [force]
 * @returns {Promise<{samples: import('../types.mjs').FaceSample[], problem?: string}>}
 */
export async function ensureFaceSamples(projectId, onProgress, force = false) {
  const project = await requireProject(projectId);
  if (!force && project.face_samples && project.face_samples.length > 0)
    return { samples: project.face_samples };
  const work = Object.values(project.assets ?? {}).find((a) => a.kind === 'work');
  if (!work || !existsSync(work.path))
    throw new Error('This project has no working copy to look at. Open the video again.');
  try {
    onProgress?.('faces', 0, 'Finding where you are in the frame');
    const samples = await detectFaces(work.path, {
      duration_ms: project.media?.duration_ms,
      onProgress: (f) => onProgress?.('faces', f, 'Finding where you are in the frame'),
    });
    await updateProject(projectId, (p) => {
      p.face_samples = samples;
    });
    return { samples };
  } catch (error) {
    const problem = /** @type {any} */ (error)?.message ?? String(error);
    warn('Face finding failed:', problem);
    return { samples: [], problem };
  }
}

/**
 * The anchor for a given plan (uses the plan's own largest zoom). Does not change the project.
 * @param {string} projectId
 * @param {import('../types.mjs').ShotPlan | undefined} plan
 * @param {(stage: string, fraction: number, message?: string) => void} [onProgress]
 * @returns {Promise<CaptionAnchor>}
 */
export async function anchorForPlan(projectId, plan, onProgress) {
  const { samples, problem } = await ensureFaceSamples(projectId, onProgress);
  const anchor = anchorFromSamples(samples, { zoom: maxZoomOf(plan) });
  if (problem) anchor.note = `The face finder could not run (${problem}). Captions sit at a fixed height.`;
  return anchor;
}

/**
 * The caption anchor for a project. Looks for faces once (cached on the project as face_samples),
 * writes the anchor into the project's shot plan and refreshes the plan hash so the render cache stays honest.
 * @param {{projectId: string, force?: boolean, onProgress?: (stage: string, fraction: number, message?: string) => void}} input
 * @returns {Promise<CaptionAnchor>}
 */
export async function captionAnchor({ projectId, force = false, onProgress }) {
  if (force) await ensureFaceSamples(projectId, onProgress, true);
  const fresh = await requireProject(projectId);
  const anchor = await anchorForPlan(projectId, fresh.shot_plan, onProgress);
  const again = await requireProject(projectId);
  if (again.shot_plan) {
    const changed = JSON.stringify(again.shot_plan.caption_anchor ?? null) !== JSON.stringify(anchor);
    if (changed) {
      again.shot_plan.caption_anchor = /** @type {any} */ (anchor);
      again.shot_plan.hash = hashShotPlan(again.shot_plan);
      await saveProject(again);
    }
  }
  return anchor;
}
