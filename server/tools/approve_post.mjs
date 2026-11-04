import { approveJob, getJob, invalidateState } from '../dandelion/client.mjs';
import { kitJobStatus } from '../dandelion/ids.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

const FORCE_HINT = /\s*To post it anyway,[^.]*force: ?true\.?/i;

/**
 * Dandelion's stop message tells a caller to "send force: true", which means nothing to a person reading the card.
 * @param {import('../lib/kit.mjs').ToolOutcome} failure
 */
function stoppedInPlainWords(failure) {
  if (!failure.text || !FORCE_HINT.test(failure.text)) return failure;
  const reason = failure.text.replace(FORCE_HINT, '').trim();
  return { ...failure, text: `${reason} Nothing went out. To post it anyway, the person has to see this and say yes (force true).`, data: { ...failure.data, error: 'post_stopped' } };
}

export const tool = defineTool({
  name: 'approve_post',
  title: 'Approve a post',
  description:
    'Approve one waiting Dandelion post so it goes out now, or at post_at (an ISO time) if given. This publishes to a real social account. Only call it after the person has clearly said yes to this exact post. If Dandelion stops it, show the person the reason and only then, if they still want it, call again with force true.',
  input: {
    job_id: z.string().describe('The post (job) id from the card or send_to_dandelion.'),
    post_at: z.string().optional().describe('ISO time to schedule it. Leave out to post now.'),
    force: z.boolean().optional().describe('Post even though Dandelion stopped it. Only after the person has seen the reason and said yes.'),
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
      const current = await getJob(args.job_id).catch(() => null);
      if (current?.status === 'queued' || current?.status === 'processing') {
        return fail('Dandelion is still getting this post ready, so it cannot be approved yet and your words may not be saved. Call send_to_dandelion again with the same arguments, then approve it.');
      }
      const r = await approveJob(args.job_id, postAt, args.force);
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
      if (failure) return stoppedInPlainWords(failure);
      throw error;
    }
  },
});
