import { applyChoices } from '../../core/edit/roughcut.mjs';
import { requireProject, updateProject } from '../store/project.mjs';
import { cutData } from '../lib/data.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'update_cut',
  title: 'Change the rough cut',
  description:
    'Used by the rough cut card. Keep some of the removed pieces (keep_ids) or take them out again (drop_ids), then rebuild the cut. Ids come from rough_cut, for example r3.',
  input: {
    project_id: z.string(),
    keep_ids: z.array(z.string()).default([]).describe('Pieces to put back in the reel.'),
    drop_ids: z.array(z.string()).default([]).describe('Pieces to take out.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const current = await requireProject(args.project_id);
    if (!current.cut || !current.transcript) return fail('There is no rough cut yet. Run rough_cut first.');
    const known = new Set(current.cut.removed.map((r) => r.id));
    const unknown = [...args.keep_ids, ...args.drop_ids].filter((id) => !known.has(id));
    if (unknown.length) return fail(`This cut has no piece called ${unknown.join(', ')}.`);
    const { project } = await updateProject(args.project_id, (p) => {
      const cut = /** @type {NonNullable<typeof p.cut>} */ (p.cut);
      p.cut = applyChoices(/** @type {any} */ (p.transcript), cut, { keep_ids: args.keep_ids, drop_ids: args.drop_ids }, { duration_ms: cut.before_ms });
      p.cut_applied = true;
      delete p.shot_plan;
    });
    return ok(cutData(project));
  },
});
