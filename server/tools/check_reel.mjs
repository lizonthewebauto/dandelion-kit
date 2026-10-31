import { requireProject, updateProject } from '../store/project.mjs';
import { previewData, renderFunction, renderKeys } from '../lib/preview.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'check_reel',
  title: 'Check the reel',
  description:
    'Run the quality checks on a finished reel file: format, length, loudness, loudest peak, dark ending, captions inside the safe area, movement in the first 2 seconds, long still stretches, and the hook text. Defaults to the final render, then the draft. Each check says pass, warn or stop with the measured number and what to change.',
  input: {
    project_id: z.string(),
    file: z.string().optional().describe('A render file from this project. Defaults to the newest final.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const project = await requireProject(args.project_id);
    if (!project.shot_plan) return fail('There is no shot plan yet, so there is nothing to check against. Run plan_shots first.');
    const keys = renderKeys(project);
    if (!keys.length) return fail('There is no finished render yet. Build a draft first with render_reel.');
    const renders = /** @type {Record<string, any>} */ (project.renders);
    const key = args.file
      ? keys.find((k) => renders[k].file === args.file)
      : keys.includes('final')
        ? 'final'
        : keys.includes('draft')
          ? 'draft'
          : keys[0];
    if (!key) return fail(`That file is not one of this project's renders. Known files: ${keys.map((k) => renders[k].file).join(', ')}.`);
    const checkReel = await renderFunction('checks', 'checkReel', 'The quality checks');
    const checks = await checkReel({ file: renders[key].file, plan: project.shot_plan, quality: renders[key].quality });
    await updateProject(project.id, (p) => {
      if (p.renders?.[key]) p.renders[key] = { ...p.renders[key], checks };
    });
    return ok(await previewData(project.id, key));
  },
});
