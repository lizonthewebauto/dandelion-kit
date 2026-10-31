import { approveJob, invalidateState } from '../dandelion/client.mjs';
import { kitJobStatus } from '../dandelion/ids.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

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
  async run(args) {
    let postAt;
    if (args.post_at) {
      const t = new Date(args.post_at);
      if (Number.isNaN(t.getTime())) return fail(`"${args.post_at}" is not a time I can read. Use an ISO time such as 2026-12-02T14:00:00-05:00.`);
      postAt = t.toISOString();
    }
    try {
      const r = await approveJob(args.job_id, postAt);
      invalidateState();
      const job = r?.job ?? {};
      const scheduledFor = job.scheduled_for ?? postAt;
      const status = kitJobStatus(job.status, Boolean(scheduledFor));
      return ok({
        job: { id: String(job.id ?? args.job_id), status: postAt && status === 'posting' ? 'scheduled' : status, ...(scheduledFor ? { post_at: scheduledFor } : {}) },
        ...(Array.isArray(r?.warnings) && r.warnings.length ? { warnings: r.warnings } : {}),
      });
    } catch (error) {
      const failure = asFail(error);
      if (failure) return failure;
      throw error;
    }
  },
});
