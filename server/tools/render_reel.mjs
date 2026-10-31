import { requireProject } from '../store/project.mjs';
import { previewData, renderFunction } from '../lib/preview.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';
import { planKey, runInBackground, stageProgress } from '../lib/render-jobs.mjs';

export const tool = defineTool({
  name: 'render_reel',
  title: 'Build the reel',
  description:
    'Build the reel once from the shot plan. quality "draft" is a small 540 by 960 preview that takes under a minute; "final" is 1080 by 1920 at 30 fps and takes a few minutes. Both run the checks on the finished file. Build a draft first, look at it, then build the final only after the person says yes. Needs a shot plan (plan_shots). The build runs in the background. If it is not done in about 40 seconds the answer says it is still building: call render_reel again with the same arguments (it does not start a second build) or call get_project to see when it is done.',
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
    return runInBackground({
      key: `${project.id}:render_reel:${args.quality}:${planKey(project.shot_plan)}`,
      projectId: project.id,
      tool: 'render_reel',
      quality: args.quality,
      ctx,
      async start(report) {
        // The build is not tied to this call's signal: a host that stops waiting must not stop the build.
        await renderReel({ projectId: project.id, quality: args.quality, onProgress: stageProgress(report) });
        return ok(await previewData(project.id, args.quality));
      },
    });
  },
});
