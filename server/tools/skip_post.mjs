import { defineTool, notBuilt, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'skip_post',
  title: 'Skip a post',
  description: 'Skip one waiting Dandelion post so it will not go out. The files stay in the person\'s library.',
  input: { job_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run() {
    return notBuilt('Skipping a post');
  },
});
