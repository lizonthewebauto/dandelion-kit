import { CHANNEL_IDS } from '../../core/types.mjs';
import { loadRules } from '../rules.mjs';
import { checkCopy, loadBundle, saveBundle } from '../lib/offer.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'set_channel_copy',
  title: 'Save the words for one app',
  description:
    'Used by the post card. Save the edited words for one app and re-check them against that app\'s limits. Words over a limit are saved and flagged in warnings.',
  input: {
    bundle_id: z.string(),
    channel: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (CHANNEL_IDS))),
    copy: z.object({
      caption: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      hashtags: z.array(z.string()).optional(),
    }),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const bundle = await loadBundle(args.bundle_id);
    const entry = bundle.channels?.[args.channel];
    if (!entry) return fail(`This post has no version for ${args.channel}.`);
    const { rules } = await loadRules();
    const rule = rules.platforms?.[args.channel];
    const media = { kind: bundle.kind, duration_ms: bundle.media?.duration_ms, image_count: bundle.media?.image_count };
    const warnings = rule ? checkCopy(rule, args.copy, media) : [];
    bundle.channels[args.channel] = { ...entry, copy: args.copy, warnings };
    await saveBundle(bundle);
    return ok({ channel: args.channel, copy: args.copy, warnings });
  },
});
