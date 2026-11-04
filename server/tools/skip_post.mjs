import { invalidateState, skipJob } from '../dandelion/client.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

// Dandelion answers "changed while you were looking" for a few seconds after a post is scheduled, while it is handed over.
const CHANGED = /changed while you were looking/i;
const RETRIES = 6;
const RETRY_MS = 3000;

/** @param {string} jobId */
async function skipWhenSettled(jobId) {
  for (let i = 0; ; i += 1) {
    try {
      return await skipJob(jobId);
    } catch (error) {
      if (i >= RETRIES || !CHANGED.test(/** @type {any} */ (error)?.message ?? '')) throw error;
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

export const tool = defineTool({
  name: 'skip_post',
  title: 'Skip a post',
  description: 'Skip one waiting or scheduled Dandelion post so it will not go out. The files stay in the person\'s library.',
  input: { job_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args) {
    try {
      const r = await skipWhenSettled(args.job_id);
      invalidateState();
      return ok({ job: { id: String(r?.job?.id ?? args.job_id), status: 'skipped' } });
    } catch (error) {
      const failure = asFail(error);
      if (failure) return failure;
      throw error;
    }
  },
});
