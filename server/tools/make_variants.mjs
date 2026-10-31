import { requireProject, updateProject } from '../store/project.mjs';
import { previewData, renderFunction } from '../lib/preview.mjs';
import { defineTool, fail, ok, progressAdapter, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'make_variants',
  title: 'Make variants',
  description:
    'Make 2 to 4 variants of the same speech that differ in at least two creative choices: the hook text, how it opens (hook card or straight in), the caption style, and the pace. The words are never reordered or retimed. Each variant is built at final quality and checked. This takes a few minutes.',
  input: {
    project_id: z.string(),
    count: z.number().int().min(2).max(4).default(2),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args, ctx) {
    const project = await requireProject(args.project_id);
    if (!project.shot_plan) return fail('There is no shot plan yet. Run plan_shots first.');
    const makeVariants = await renderFunction('variants', 'makeVariants', 'Variants');
    ctx.progress(0.05, 'Making variants');
    const results = /** @type {import('../../core/types.mjs').RenderResult[]} */ (await makeVariants({ projectId: project.id, count: args.count, onProgress: progressAdapter(ctx), signal: ctx.signal }));
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
