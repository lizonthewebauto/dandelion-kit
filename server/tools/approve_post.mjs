import { defineTool, notBuilt, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'approve_post',
  title: 'Approve a post',
  description:
    'Approve one waiting Dandelion post so it goes out now, or at post_at (an ISO time) if given. This publishes to a real social account. Only call it after the person has clearly said yes to this exact post.',
  input: {
    job_id: z.string().describe('The post (job) id from the card or send_to_dandelion.'),
    post_at: z.string().optional().describe('ISO time to schedule it. Leave out to post now.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run() {
    return notBuilt('Approving a post');
  },
});
