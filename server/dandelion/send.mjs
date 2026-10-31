// Sending a post bundle to Dandelion: files up (create_upload, PUT), a library item (add_content), and in review mode
// a waiting post for each connected app (share_content) with the words the agent wrote for that app (update_job_copy).
// Nothing here approves or posts. Approving is a separate step the person must ask for (approve_post).
import { statSync } from 'node:fs';
import { DandelionError, NotSignedInError } from './config.mjs';
import { dandelionCopyFromKit, isKitPlatform, kitCopyFromDandelion, kitJobStatus, toDandelionPlatform, toKitPlatform } from './ids.mjs';
import * as defaultApi from './client.mjs';
import { uploadFiles } from './upload.mjs';

/** Dandelion takes up to this many files in one post. */
export const MAX_FILES_PER_POST = 10;

/** Which app's words to keep in the library, best first. */
const LIBRARY_ORDER = ['instagram', 'linkedin', 'threads', 'facebook', 'tiktok', 'x', 'youtube', 'pinterest'];

/**
 * The words that go with the files in the Dandelion library.
 * @param {import('../../core/types.mjs').PostBundle & Record<string, any>} bundle
 */
export function libraryCaption(bundle) {
  if (bundle.text && bundle.text.trim()) return bundle.text.trim();
  for (const id of LIBRARY_ORDER) {
    const copy = bundle.channels?.[id]?.copy;
    const body = copy?.caption || copy?.description || copy?.title;
    if (body) return [body, ...(copy.hashtags?.length ? ['', copy.hashtags.join(' ')] : [])].join('\n').trim();
  }
  return '';
}

/**
 * @typedef {object} SendOptions
 * @property {import('../../core/types.mjs').PostBundle & Record<string, any>} bundle
 * @property {string} brandId
 * @property {'library'|'review'} [mode]
 * @property {string[]} [channels]                       Kit app ids to make a post for (review).
 * @property {(fraction: number, message?: string) => void} [progress]
 * @property {(sent: import('../../core/types.mjs').SentBundle) => Promise<void> | void} [onSent]   Called as soon as the library item exists.
 * @property {typeof defaultApi} [api]                   For tests.
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [pollMs]                           How often to look at a post that is still being prepared.
 * @property {number} [preparingMs]                      How long to wait for that.
 * @property {number} [uploadRetryDelayMs]
 */

/**
 * @param {SendOptions} options
 * @returns {Promise<{sent: import('../../core/types.mjs').SentBundle, notes: string[]}>}
 */
export async function sendBundle(options) {
  const { bundle, brandId, mode = 'library', channels, progress, onSent, api = defaultApi, fetchImpl, pollMs = 3000, preparingMs = 45_000 } = options;
  /** @type {string[]} */
  const notes = [];
  progress?.(0.02, 'Checking your Dandelion account');
  const brands = await api.listBrands();
  const brand = brands.find((b) => b.id === brandId);
  if (!brand) {
    const names = brands.map((b) => `${b.name} (${b.id})`).join(', ');
    throw new DandelionError(`There is no brand ${brandId} in your Dandelion account.${names ? ` Your brands: ${names}.` : ' Make a brand in Dandelion first.'}`, 'not_found');
  }

  /** @type {import('../../core/types.mjs').SentBundle | null} */
  let sent = bundle.sent && bundle.sent.brand_id === brandId && bundle.sent.content_id ? { ...bundle.sent, jobs: [...(bundle.sent.jobs ?? [])] } : null;

  if (!sent) {
    // Dandelion's own rule: an Autoshare in auto mode that reads uploads would post a new library item in public.
    const flows = await api.listFlows(brandId);
    const risky = flows.filter((f) => f?.active && f?.mode === 'auto' && f?.sources?.uploads);
    if (risky.length) {
      throw new DandelionError(
        `${brand.name} has an Autoshare that posts new uploads by itself${risky[0].name ? ` ("${risky[0].name}")` : ''}. Sending this would post it in public. ` +
          'Pause that Autoshare in Dandelion, or set it to wait for review, then send again. Nothing was sent.',
        'autoshare_would_post',
      );
    }
    const files = bundle.files ?? [];
    if (files.length > MAX_FILES_PER_POST) {
      throw new DandelionError(`Dandelion takes up to ${MAX_FILES_PER_POST} files in one post. This one has ${files.length}.`, 'invalid_input');
    }
    for (const f of files) {
      try {
        if (!statSync(f).isFile()) throw new Error('not a file');
      } catch {
        throw new DandelionError(`I could not find the file ${f}. Offer the post again with offer_post.`, 'invalid_input');
      }
    }
    const caption = libraryCaption(bundle);
    if (!files.length && !caption) throw new DandelionError('There is nothing to send: this post has no words and no files.', 'invalid_input');

    const uploads = files.length
      ? await uploadFiles({
          brandId,
          files,
          createUpload: api.createUpload,
          fetchImpl,
          retryDelayMs: options.uploadRetryDelayMs,
          progress: (f, message) => progress?.(0.05 + f * 0.6, message),
        })
      : [];
    progress?.(0.68, 'Adding it to your Dandelion library');
    const item = await api.addContent({ brandId, caption: caption || undefined, uploadIds: uploads.map((u) => u.upload_id) });
    sent = { brand_id: brandId, content_id: item.id, mode: 'library', jobs: [], sent_at: Date.now() };
    await onSent?.(sent);
  } else {
    notes.push('The files were already in your Dandelion library, so they were not sent again.');
  }

  if (mode === 'library') {
    progress?.(1, 'Saved to your Dandelion library');
    return { sent, notes };
  }

  // Review: one waiting post for each connected app the person chose.
  progress?.(0.72, 'Looking at your connected apps');
  const accountChannels = await api.listChannels(brandId);
  const wanted = (channels && channels.length ? channels : Object.keys(bundle.channels ?? {})).filter((id, i, all) => all.indexOf(id) === i);
  /** @type {{kit: string, channel: any}[]} */
  const targets = [];
  /** @type {string[]} */
  const missing = [];
  for (const kit of wanted) {
    if (!isKitPlatform(kit) || !bundle.channels?.[kit]) {
      notes.push(`This post has no version for ${kit}, so I skipped it.`);
      continue;
    }
    const channel = accountChannels.find((c) => c.platform === toDandelionPlatform(kit) && c.can_post);
    if (!channel) {
      missing.push(kit);
      continue;
    }
    const alreadyThere = sent.jobs.some((j) => j.channel_id === channel.id && j.status !== 'skipped');
    if (alreadyThere) {
      notes.push(`A post for ${kit} is already waiting, so I did not make another.`);
      continue;
    }
    targets.push({ kit, channel });
  }
  if (missing.length) notes.push(`No connected app can post for ${missing.join(', ')} yet. Connect them in Dandelion (dandelion_status has the links).`);

  sent.mode = 'review';
  if (!targets.length) {
    progress?.(1, 'Nothing to share yet: no connected app can post');
    return { sent, notes };
  }

  progress?.(0.78, 'Making a waiting post for each app');
  const share = await shareWhenReady(api, { contentId: sent.content_id, channelIds: targets.map((t) => t.channel.id), pollMs, preparingMs });
  const byChannel = new Map(targets.map((t) => [t.channel.id, t]));
  let n = 0;
  for (const jobId of share.job_ids ?? []) {
    n += 1;
    progress?.(0.8 + (0.18 * n) / Math.max(1, share.job_ids.length), 'Writing the words for each app');
    sent.jobs.push(await describeJob(api, jobId, { byChannel, bundle, pollMs, preparingMs }));
  }
  sent.sent_at = Date.now();
  progress?.(1, 'Posts are waiting for your OK');
  return { sent, notes };
}

/** share_content, waiting a little if Dandelion is still getting the new item ready. */
async function shareWhenReady(/** @type {typeof defaultApi} */ api, /** @type {{contentId: string, channelIds: string[], pollMs: number, preparingMs: number}} */ o) {
  const started = Date.now();
  for (;;) {
    try {
      return await api.shareContent({ contentId: o.contentId, channelIds: o.channelIds, mode: 'review' });
    } catch (error) {
      const notReady = error instanceof DandelionError && error.code === 'conflict' && /not ready/i.test(error.message);
      if (!notReady || Date.now() - started > o.preparingMs) throw error;
      await new Promise((r) => setTimeout(r, o.pollMs));
    }
  }
}

/**
 * Fill in one waiting post: wait until Dandelion has prepared it, save the words for that app, read it back.
 * @returns {Promise<import('../../core/types.mjs').PostJob>}
 */
async function describeJob(
  /** @type {typeof defaultApi} */ api,
  /** @type {string} */ jobId,
  /** @type {{byChannel: Map<string, {kit: string, channel: any}>, bundle: Record<string, any>, pollMs: number, preparingMs: number}} */ o,
) {
  const started = Date.now();
  let job = await api.getJob(jobId);
  /** @type {string[]} */
  const extraChecks = [];
  while ((job.status === 'queued' || job.status === 'processing') && Date.now() - started < o.preparingMs) {
    await new Promise((r) => setTimeout(r, o.pollMs));
    job = await api.getJob(jobId);
  }
  if (job.status === 'queued' || job.status === 'processing') extraChecks.push('Dandelion is still getting this post ready. Check again in a minute before you approve it.');

  const target = o.byChannel.get(job.channel_id);
  const kit = target?.kit ?? toKitPlatform(String(job.platform));
  const entry = o.bundle.channels?.[kit];
  if (entry?.copy) {
    const fields = dandelionCopyFromKit(entry.copy, { skipHashtags: entry.limits?.hashtags_max === 0 });
    if (Object.keys(fields).length) {
      try {
        const saved = await api.updateJobCopy(jobId, fields);
        for (const w of Array.isArray(saved?.warnings) ? saved.warnings : []) extraChecks.push(typeof w === 'string' ? w : String(w?.message ?? ''));
        job = await api.getJob(jobId);
      } catch (error) {
        if (error instanceof NotSignedInError) throw error;
        extraChecks.push(error instanceof Error ? error.message : 'Dandelion could not save the words for this app.');
      }
    }
  }
  const checks = [
    ...(Array.isArray(job.checks) ? job.checks.map((/** @type {any} */ c) => String(c?.message ?? c)) : []),
    ...extraChecks,
  ].filter(Boolean);
  const handle = String(job.channel?.handle ?? target?.channel?.handle ?? '');
  /** @type {import('../../core/types.mjs').PostJob} */
  const out = {
    id: String(job.id ?? jobId),
    channel_id: String(job.channel_id ?? ''),
    platform: /** @type {any} */ (kit),
    handle,
    status: kitJobStatus(job.status, Boolean(job.scheduled_for)),
    copy: kitCopyFromDandelion(job.copy),
    checks,
  };
  if (job.scheduled_for) out.post_at = String(job.scheduled_for);
  return out;
}
