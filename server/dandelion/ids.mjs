// Dandelion and the kit name the apps the same way, except X: Dandelion says "twitter", the kit says "x".
import { CHANNEL_IDS } from '../../core/types.mjs';

/** Kit id to Dandelion id. @param {string} id */
export function toDandelionPlatform(id) {
  return id === 'x' ? 'twitter' : id;
}

/** Dandelion id to kit id. @param {string} id */
export function toKitPlatform(id) {
  return id === 'twitter' ? 'x' : id;
}

/** Is this one of the eight apps the kit writes for? @param {string} id */
export function isKitPlatform(id) {
  return /** @type {readonly string[]} */ (CHANNEL_IDS).includes(id);
}

/** Dandelion's job status in the words the card knows. @param {string|undefined} status @param {boolean} [scheduled] */
export function kitJobStatus(status, scheduled = false) {
  switch (status) {
    case 'review':
    case 'queued':
    case 'processing':
    case 'draft':
      return 'review';
    case 'scheduled':
      return 'scheduled';
    case 'approved':
      return scheduled ? 'scheduled' : 'posting';
    case 'posting':
    case 'publishing':
      return 'posting';
    case 'posted':
      return 'posted';
    case 'skipped':
      return 'skipped';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'review';
  }
}

/**
 * Dandelion's copy (snake_case, hashtags without #) as the kit's ChannelCopy.
 * @param {Record<string, any>|null|undefined} copy
 * @returns {import('../../core/types.mjs').ChannelCopy}
 */
export function kitCopyFromDandelion(copy) {
  /** @type {import('../../core/types.mjs').ChannelCopy} */
  const out = {};
  if (!copy) return out;
  if (typeof copy.caption === 'string' && copy.caption) out.caption = copy.caption;
  if (typeof copy.title === 'string' && copy.title) out.title = copy.title;
  if (typeof copy.description === 'string' && copy.description) out.description = copy.description;
  if (Array.isArray(copy.hashtags) && copy.hashtags.length) {
    out.hashtags = copy.hashtags.map((/** @type {string} */ h) => (String(h).startsWith('#') ? String(h) : `#${h}`));
  }
  return out;
}

/**
 * The kit's ChannelCopy as the fields update_job_copy takes (hashtags without #).
 * @param {import('../../core/types.mjs').ChannelCopy} copy
 * @param {{skipHashtags?: boolean}} [options]
 */
export function dandelionCopyFromKit(copy, options = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  if (copy.caption) out.caption = copy.caption;
  if (copy.title) out.title = copy.title;
  if (copy.description) out.description = copy.description;
  if (copy.hashtags?.length && !options.skipHashtags) out.hashtags = copy.hashtags.map((h) => String(h).replace(/^#+/, '')).filter(Boolean);
  return out;
}
