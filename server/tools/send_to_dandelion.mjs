import { CHANNEL_IDS } from '../../core/types.mjs';
import { getState, invalidateState } from '../dandelion/client.mjs';
import { sendBundle } from '../dandelion/send.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';
import { loadBundle, saveBundle } from '../lib/offer.mjs';
import { runInBackground } from '../lib/render-jobs.mjs';
import { renderText } from '../text.mjs';

export const tool = defineTool({
  name: 'send_to_dandelion',
  title: 'Send to Dandelion',
  description:
    'Send a post from offer_post to the person\'s Dandelion account. mode "library" saves the files and words to their library only. mode "review" also creates a post for each chosen app, waiting for their OK (nothing goes out). Needs Dandelion signed in (connect_dandelion). Never posts by itself. This can take a few minutes: if the answer says it is still sending, call it again with the same arguments to wait (it never sends twice).',
  input: {
    bundle_id: z.string().describe('The post id from offer_post.'),
    brand_id: z.string().describe('The Dandelion brand to use, from dandelion_status.'),
    mode: z.enum(['library', 'review']).default('library'),
    channels: z.array(z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (CHANNEL_IDS)))).optional().describe('For review: which apps to make a post for.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(args, ctx) {
    const bundle = await loadBundle(args.bundle_id);
    return runInBackground({
      key: `send:${args.bundle_id}:${args.brand_id}:${args.mode}:${[...(args.channels ?? [])].sort().join(',')}`,
      projectId: args.bundle_id,
      tool: 'send_to_dandelion',
      extra: { bundle_id: args.bundle_id },
      ctx,
      start: async (report) => {
        try {
          const { sent, notes } = await sendBundle({
            bundle,
            brandId: args.brand_id,
            mode: args.mode,
            channels: args.channels,
            progress: report,
            // Keep the record at once, so a failed later step never makes the files go up twice or shares a post twice.
            onSent: async (s) => {
              bundle.sent = s;
              await saveBundle(bundle);
            },
          });
          bundle.sent = sent;
          await saveBundle(bundle);
          invalidateState();
          const dandelion = await getState({ fresh: true });
          const text = [renderText('send_to_dandelion', { sent }), ...notes.map((n) => `Note: ${n}`)].join('\n');
          return ok({ sent, dandelion }, text);
        } catch (error) {
          const failure = asFail(error);
          if (failure) return failure;
          throw error;
        }
      },
    });
  },
});
