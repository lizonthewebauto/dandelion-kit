import { CHANNEL_IDS } from '../../core/types.mjs';
import { defineTool, notBuilt, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'send_to_dandelion',
  title: 'Send to Dandelion',
  description:
    'Send a post from offer_post to the person\'s Dandelion account. mode "library" saves the files and words to their library only. mode "review" also creates a post for each chosen app, waiting for their OK (nothing goes out). Needs Dandelion signed in (connect_dandelion). Never posts by itself.',
  input: {
    bundle_id: z.string().describe('The post id from offer_post.'),
    brand_id: z.string().describe('The Dandelion brand to use, from dandelion_status.'),
    mode: z.enum(['library', 'review']).default('library'),
    channels: z.array(z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (CHANNEL_IDS)))).optional().describe('For review: which apps to make a post for.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run() {
    return notBuilt('Sending to Dandelion');
  },
});
