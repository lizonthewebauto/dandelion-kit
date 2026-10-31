import { invalidateState, skipJob } from '../dandelion/client.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

export const tool = defineTool({
  name: 'skip_post',
  title: 'Skip a post',
  description: 'Skip one waiting Dandelion post so it will not go out. The files stay in the person\'s library.',
  input: { job_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args) {
    try {
      const r = await skipJob(args.job_id);
      invalidateState();
      return ok({ job: { id: String(r?.job?.id ?? args.job_id), status: 'skipped' } });
    } catch (error) {
      const failure = asFail(error);
      if (failure) return failure;
      throw error;
    }
  },
});
