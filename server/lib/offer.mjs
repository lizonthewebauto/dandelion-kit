// The "post anything" bundle: one set of files plus a draft for each app, checked against Dandelion's public rules.
// Pure functions first (they are unit tested), then the parts that touch the disk.
import { join } from 'node:path';
import sharp from 'sharp';
import { CHANNEL_IDS, POST_KINDS } from '../../core/types.mjs';
import { probeMedia } from '../../core/media/probe.mjs';
import { sampleFrames } from '../../core/media/frames.mjs';
import { ensureDir, isFile, kitHome, readJson, writeJson } from '../../core/util/fs.mjs';
import { shortId } from '../../core/util/hash.mjs';
import { createProject, projectDir, registerAsset, requireProject, updateProject } from '../store/project.mjs';
import { assetByLabel, renderIsFresh } from './data.mjs';
import { ToolFailure } from './kit.mjs';
import { countedLength } from './counted.mjs';

export { countedLength, INLINE_HASHTAG_PLATFORMS, X_LINK_LENGTH } from './counted.mjs';

/** @typedef {import('../../core/types.mjs').PostBundle} PostBundle */
/** @typedef {import('../../core/types.mjs').ChannelCopy} ChannelCopy */
/** @typedef {import('../../core/types.mjs').PlatformRule} PlatformRule */

/** Count characters the way a person does: one emoji is one. @param {string|undefined} text */
export function charCount(text) {
  return text ? [...text].length : 0;
}

/**
 * Split a trailing block of hashtags off a text.
 * "Great tip. #focus #habits" gives the text "Great tip." and ["#focus", "#habits"].
 * @param {string} text
 * @returns {{body: string, hashtags: string[]}}
 */
export function splitHashtags(text) {
  const trimmed = String(text ?? '').trim();
  const m = /(?:^|\s+)((?:#[\p{L}\p{N}_]+\s*)+)$/u.exec(trimmed);
  if (!m) return { body: trimmed, hashtags: [] };
  const hashtags = m[1].trim().split(/\s+/);
  return { body: trimmed.slice(0, m.index).trim(), hashtags };
}

/** The first sentence of a text, or its first line when that is shorter. @param {string} body */
export function firstSentence(body) {
  const line = body.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const m = /^(.+?[.!?])(\s|$)/u.exec(line.trim());
  return (m ? m[1] : line).trim();
}

/** Which kind of file a post kind needs. @param {string} kind */
export function acceptsFor(kind) {
  if (kind === 'video') return 'video';
  if (kind === 'image' || kind === 'carousel') return 'image';
  return 'text';
}

const NOUN = { video: 'a video', image: 'pictures', text: 'a text post' };

/**
 * Check one channel's copy against its rule. Returns plain sentences; empty means all good.
 * Never changes the copy: the person decides what to cut.
 * @param {PlatformRule} rule
 * @param {ChannelCopy} copy
 * @param {{kind?: string, duration_ms?: number, image_count?: number, platform?: string}} [media]
 *   `platform` is the channel id; with it the caption is counted the way that app counts (see countedLength).
 * @returns {string[]}
 */
export function checkCopy(rule, copy, media = {}) {
  /** @type {string[]} */
  const warnings = [];
  const name = rule.name;
  const limits = rule.limits ?? {};
  const over = (/** @type {string|undefined} */ text, /** @type {number|undefined} */ max, /** @type {string} */ field) => {
    if (!max) return;
    const n = charCount(text);
    if (n > max) warnings.push(`The ${field} is ${n - max} characters too long for ${name} (${n} of ${max}). Shorten it before you send.`);
  };
  if (limits.caption_max) {
    const { total, with_hashtags } = countedLength(media.platform, copy);
    if (total > limits.caption_max) {
      warnings.push(
        `The caption is ${total - limits.caption_max} characters too long for ${name} (${total} of ${limits.caption_max}${with_hashtags ? ' with hashtags' : ''}). Shorten it before you send.`,
      );
    }
  }
  over(copy.title, limits.title_max, 'title');
  over(copy.description, limits.description_max, 'description');
  const tags = copy.hashtags ?? [];
  if (limits.hashtags_max !== undefined && tags.length > limits.hashtags_max) {
    warnings.push(
      limits.hashtags_max === 0
        ? `${name} does not use hashtags. Take them out.`
        : `${name} allows at most ${limits.hashtags_max} hashtags. You have ${tags.length}.`,
    );
  }
  if (media.kind) {
    const want = acceptsFor(media.kind);
    const formats = (rule.formats ?? []).filter((f) => f.accepts.includes(/** @type {any} */ (want)));
    if (formats.length === 0) {
      warnings.push(`${name} does not take ${NOUN[/** @type {'video'|'image'|'text'} */ (want)]}.`);
    } else {
      if (want === 'video' && media.duration_ms) {
        const longest = Math.max(...formats.map((f) => f.maxSeconds ?? 0));
        if (longest && media.duration_ms / 1000 > longest) {
          warnings.push(`This video is ${Math.round(media.duration_ms / 1000)} seconds. ${name} takes up to ${longest} seconds.`);
        }
      }
      if (want === 'image' && media.image_count) {
        const most = Math.max(...formats.map((f) => f.maxImages ?? 1));
        if (media.image_count > most) warnings.push(`${name} takes up to ${most} pictures in one post. You have ${media.image_count}.`);
      }
    }
  }
  return warnings;
}

/**
 * Pick the format of a platform that fits the post kind.
 * @param {PlatformRule} rule
 * @param {string} kind
 * @param {number} [imageCount]
 */
export function pickFormat(rule, kind, imageCount = 0) {
  const want = acceptsFor(kind);
  const formats = (rule.formats ?? []).filter((f) => f.accepts.includes(/** @type {any} */ (want)));
  if (!formats.length) return undefined;
  if (want === 'image' && imageCount > 1) {
    const multi = formats.find((f) => (f.maxImages ?? 1) > 1);
    if (multi) return multi;
  }
  return formats[0];
}

/**
 * A first draft of one channel's copy from a single text.
 * @param {PlatformRule} rule
 * @param {string} text
 * @returns {ChannelCopy}
 */
export function draftCopy(rule, text) {
  const { body, hashtags } = splitHashtags(text);
  const limits = rule.limits ?? {};
  if (limits.title_max) {
    const title = firstSentence(body);
    /** @type {ChannelCopy} */
    const copy = { title, description: body };
    if (hashtags.length) copy.hashtags = hashtags;
    return copy;
  }
  /** @type {ChannelCopy} */
  const copy = { caption: body };
  if (hashtags.length) copy.hashtags = hashtags;
  return copy;
}

/**
 * Per-channel drafts and warnings.
 * @param {object} input
 * @param {import('../../core/types.mjs').PlatformRules} input.rules
 * @param {string} input.kind
 * @param {string} [input.text]
 * @param {Record<string, ChannelCopy>} [input.copies]    Words the agent wrote for a channel. Used as written.
 * @param {string[]} [input.channels]                    Only these channels. Default: all eight.
 * @param {number} [input.duration_ms]
 * @param {number} [input.image_count]
 * @returns {PostBundle['channels']}
 */
export function buildChannels({ rules, kind, text, copies, channels, duration_ms, image_count }) {
  /** @type {Record<string, any>} */
  const out = {};
  const ids = CHANNEL_IDS.filter((id) => !channels || channels.includes(id));
  for (const id of ids) {
    const rule = rules.platforms?.[id];
    if (!rule) continue;
    const copy = copies?.[id] ?? (text ? draftCopy(rule, text) : {});
    const warnings = checkCopy(rule, copy, { kind, duration_ms, image_count, platform: id });
    if (!text && !copies?.[id]) warnings.push(`Write the words for ${rule.name}, or tell me what the post is about.`);
    const format = pickFormat(rule, kind, image_count);
    out[id] = { copy, limits: rule.limits ?? {}, warnings, ...(format ? { format: format.label } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** <kit home>/bundles */
export function bundlesDir() {
  return join(kitHome(), 'bundles');
}

/** @param {string} id */
function bundlePath(id) {
  if (!/^b_[a-z0-9]{4,32}$/.test(String(id))) throw new ToolFailure(`"${id}" is not a post bundle id.`);
  return join(bundlesDir(), `${id}.json`);
}

/** @param {PostBundle & Record<string, any>} bundle */
export async function saveBundle(bundle) {
  ensureDir(bundlesDir());
  await writeJson(bundlePath(bundle.id), bundle);
  return bundle;
}

/** @param {string} id @returns {Promise<PostBundle & Record<string, any>>} */
export async function loadBundle(id) {
  const bundle = await readJson(bundlePath(id), null);
  if (!bundle) throw new ToolFailure(`I could not find the post ${id}. Ask for the post again with offer_post.`);
  return /** @type {any} */ (bundle);
}

export function newBundleId() {
  return shortId('b', `${Date.now()}:${Math.random()}`, 8);
}

// ---------------------------------------------------------------------------
// Files and previews
// ---------------------------------------------------------------------------

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** @param {string} path */
export const isVideoFile = (path) => VIDEO_EXT.test(path);
/** @param {string} path */
export const isImageFile = (path) => IMAGE_EXT.test(path);

/**
 * The files for a post made from a kit project, when the caller gave none.
 * @param {string} projectId
 * @param {string} kind
 * @returns {Promise<string[]>}
 */
export async function filesFromProject(projectId, kind) {
  const project = await requireProject(projectId);
  if (project.type === 'carousel' || kind === 'image' || kind === 'carousel') {
    const rendered = project.carousel?.rendered ?? [];
    if (!rendered.length) throw new ToolFailure('This project has no rendered slides yet.');
    return rendered.map((r) => r.file).filter(isFile);
  }
  const final = project.renders?.final;
  if (final && renderIsFresh(project, 'final')) return [final.file];
  const any = Object.values(project.renders ?? {}).filter((r) => isFile(r.file));
  if (final && isFile(final.file)) return [final.file];
  if (any.length) throw new ToolFailure('Only a draft exists for this project. Render the final reel first, then offer it for posting.');
  throw new ToolFailure('This project has no rendered reel yet. Render the final reel first, then offer it for posting.');
}

/**
 * Small pictures for the post card. Returns asset ids the card reads through read_asset.
 * Uses the project's own thumbnails when there is one, otherwise a hidden preview project.
 * @param {string} bundleId
 * @param {string[]} files
 * @param {string} [projectId]
 * @returns {Promise<string[]>}
 */
export async function previewAssetIds(bundleId, files, projectId) {
  try {
    if (projectId) {
      const project = await requireProject(projectId);
      const thumbs = Object.values(project.assets).filter((a) => a.kind === 'thumb').map((a) => a.id);
      if (thumbs.length) return thumbs.slice(0, 10);
      const poster = assetByLabel(project, 'Poster');
      if (poster) return [poster.id];
    }
    if (!files.length) return [];
    const hidden = await createProject({ type: 'carousel', title: 'Post preview' });
    const dir = ensureDir(join(projectDir(hidden.id), 'thumbs'));
    /** @type {string[]} */
    const paths = [];
    let n = 0;
    for (const file of files.slice(0, 10)) {
      n += 1;
      const out = join(dir, `${bundleId}-${n}.jpg`);
      if (isImageFile(file)) {
        await sharp(file).resize({ width: 216, withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(out);
        paths.push(out);
      } else if (isVideoFile(file)) {
        const [frame] = await sampleFrames(file, [1000], dir, { width: 270, prefix: `${bundleId}-v${n}` });
        paths.push(frame.path);
      }
    }
    const { project } = await updateProject(hidden.id, async (p) => {
      /** @type {any} */ (p).hidden = true;
      for (const path of paths) await registerAsset(p, { path, kind: 'thumb', label: 'Post preview' });
    });
    return Object.values(project.assets).map((a) => a.id);
  } catch {
    return [];
  }
}

/**
 * Length of a video file, or undefined when it cannot be read.
 * @param {string} file
 */
export async function videoDuration(file) {
  try {
    return (await probeMedia(file)).duration_ms;
  } catch {
    return undefined;
  }
}

export { POST_KINDS };
