import { requireProject } from '../store/project.mjs';
import { projectCardData, ensurePoster } from '../lib/data.mjs';
import { transcribeJob } from '../lib/jobs.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'get_project',
  title: 'Project status',
  description:
    'Where a reel project stands: length, whether the words are ready, the rough cut, the look, the shot plan, and the draft and final renders. Also tells you the next step.',
  input: { project_id: z.string().describe('The id from open_video, for example p_3fa91c07.') },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const project = await requireProject(args.project_id);
    if (project.type === 'video') await ensurePoster(project.id);
    const fresh = await requireProject(project.id);
    const job = transcribeJob(project.id);
    return ok(
      projectCardData(fresh, {
        transcript_error: job?.error,
        transcribing: fresh.transcript_ready || !job || job.done ? undefined : job.progress,
      }),
    );
  },
});
