import { requireProject, updateProject } from '../store/project.mjs';
import { previewData, renderFunction } from '../lib/preview.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';
import { planKey, runInBackground } from '../lib/render-jobs.mjs';

export const tool = defineTool({
  name: 'make_variants',
  title: 'Make variants',
  description:
    'Make 2 to 4 variants of the same speech that differ in at least two creative choices: the hook text, how it opens (hook card or straight in), the caption style, and the pace. The words are never reordered or retimed. Each variant is built at final quality and checked. This takes a few minutes and runs in the background. If it is not done in about 40 seconds the answer says it is still building: call make_variants again with the same arguments (it does not start a second build) or call get_project to see when it is done.',
  input: {
    project_id: z.string(),
    count: z.number().int().min(2).max(4).default(2),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args, ctx) {
    const project = await requireProject(args.project_id);
    if (!project.shot_plan) return fail('There is no shot plan yet. Run plan_shots first.');
    const makeVariants = await renderFunction('variants', 'makeVariants', 'Variants');
    return runInBackground({
      key: `${project.id}:make_variants:${args.count}:${planKey(project.shot_plan)}`,
      projectId: project.id,
      tool: 'make_variants',
      quality: 'final',
      extra: { count: args.count },
      ctx,
      async start(report) {
        report(0.01, 'Making variants');
        // The build is not tied to this call's signal: a host that stops waiting must not stop the build.
        // makeVariants reports one overall number from 0 to 1.
        const results = /** @type {import('../../core/types.mjs').RenderResult[]} */ (
          await makeVariants({ projectId: project.id, count: args.count, onProgress: (/** @type {string} */ _stage, /** @type {number} */ f, /** @type {string|undefined} */ msg) => report(f, msg) })
        );
        const keys = results.map((r, i) => r.variant_id ?? `v${i + 1}`);
        // The render code records its own results. Fill in any it did not.
        await updateProject(project.id, (p) => {
          const renders = { ...(p.renders ?? {}) };
          results.forEach((r, i) => {
            if (!renders[keys[i]]) renders[keys[i]] = { ...r, variant_id: keys[i] };
          });
          p.renders = renders;
        });
        return ok(await previewData(project.id, keys[0]));
      },
    });
  },
});
