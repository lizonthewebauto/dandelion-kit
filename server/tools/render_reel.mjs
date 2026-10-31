import { requireProject } from '../store/project.mjs';
import { previewData, renderFunction } from '../lib/preview.mjs';
import { defineTool, fail, ok, progressAdapter, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'render_reel',
  title: 'Build the reel',
  description:
    'Build the reel once from the shot plan. quality "draft" is a small 540 by 960 preview that takes under a minute; "final" is 1080 by 1920 at 30 fps and takes a few minutes. Both run the checks on the finished file. Build a draft first, look at it, then build the final only after the person says yes. Needs a shot plan (plan_shots).',
  input: {
    project_id: z.string(),
    quality: z.enum(['draft', 'final']).default('draft'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    const project = await requireProject(args.project_id);
    if (project.type !== 'video') return fail('Only video projects can be built into a reel.');
    if (!project.shot_plan) return fail('There is no shot plan yet. Run plan_shots first.');
    const renderReel = await renderFunction('render', 'renderReel', 'The video builder');
    await renderReel({ projectId: project.id, quality: args.quality, onProgress: progressAdapter(ctx), signal: ctx.signal });
    return ok(await previewData(project.id, args.quality));
  },
});
