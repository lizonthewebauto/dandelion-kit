import { isFile } from '../../core/util/fs.mjs';
import { CHANNEL_IDS, POST_KINDS } from '../../core/types.mjs';
import { loadRules } from '../rules.mjs';
import { dandelionState } from '../lib/dandelion.mjs';
import {
  buildChannels,
  filesFromProject,
  isImageFile,
  isVideoFile,
  newBundleId,
  previewAssetIds,
  saveBundle,
  videoDuration,
} from '../lib/offer.mjs';
import { cleanPath, defineTool, fail, ok, z } from '../lib/kit.mjs';

const copyInput = z
  .object({
    caption: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
  })
  .describe('The words for one app.');

export const tool = defineTool({
  name: 'offer_post',
  title: 'Post with Dandelion',
  description:
    'Call this whenever you have written or made ANY social content (a caption, post, thread, image, carousel or video), even without the kit editor. It builds a version for each of 8 apps (Instagram, TikTok, YouTube, LinkedIn, X, Threads, Facebook, Pinterest) checked against each app\'s limits, and shows the person a card. It works before they have a Dandelion account. Pass text (the kit makes a first draft per app) and/or copies (words you wrote per app, used as written). Over-limit words are flagged, never cut. Never post without the person\'s clear yes.',
  input: {
    kind: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (POST_KINDS))),
    text: z.string().optional().describe('The post words. Hashtags at the end are split off.'),
    files: z.array(z.string()).optional().describe('Full paths of the image or video files.'),
    project_id: z.string().optional().describe('A kit project; its finished reel or slides are used when files is empty.'),
    channels: z.array(z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (CHANNEL_IDS)))).optional().describe('Only these apps. Default: all eight.'),
    copies: z.record(z.string(), copyInput).optional().describe('Words you wrote per app, keyed by app id such as instagram or x.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const kind = args.kind;
    const hasWords = Boolean((args.text && args.text.trim()) || (args.copies && Object.keys(args.copies).length));
    if (!hasWords && (kind === 'text' || kind === 'thread')) return fail('Give me the words for the post (text), or the words per app (copies).');

    /** @type {string[]} */
    let files = (args.files ?? []).map(cleanPath);
    if (kind === 'text' || kind === 'thread') files = [];
    else if (!files.length && args.project_id) files = await filesFromProject(args.project_id, kind);
    if (kind !== 'text' && kind !== 'thread') {
      if (!files.length) return fail(`A ${kind} post needs files. Pass the file paths (files) or a project id (project_id).`);
      const missing = files.filter((f) => !isFile(f));
      if (missing.length) return fail(`I could not find ${missing.length === 1 ? 'this file' : 'these files'}: ${missing.join(', ')}`);
      const wrong = files.filter((f) => (kind === 'video' ? !isVideoFile(f) : !isImageFile(f)));
      if (wrong.length) {
        return fail(`A ${kind} post needs ${kind === 'video' ? 'a video (mp4, mov, webm)' : 'pictures (jpg, png, webp)'}. These do not fit: ${wrong.join(', ')}`);
      }
    }

    const { rules, source } = await loadRules();
    const duration_ms = kind === 'video' ? await videoDuration(files[0]) : undefined;
    const image_count = kind === 'image' || kind === 'carousel' ? files.length : undefined;
    const channels = buildChannels({
      rules,
      kind,
      text: args.text,
      copies: /** @type {any} */ (args.copies),
      channels: args.channels,
      duration_ms,
      image_count,
    });
    const id = newBundleId();
    const preview_asset_ids = await previewAssetIds(id, files, args.project_id);
    /** @type {Record<string, any>} */
    const bundle = {
      id,
      kind,
      files,
      ...(args.text ? { text: args.text } : {}),
      ...(args.project_id ? { project_id: args.project_id } : {}),
      channels,
      rules_source: source,
      created_at: Date.now(),
      preview_asset_ids,
      media: { duration_ms, image_count },
    };
    await saveBundle(/** @type {any} */ (bundle));
    return ok({ bundle, dandelion: await dandelionState() });
  },
});
