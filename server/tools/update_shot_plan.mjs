import { editShotPlan } from '../../core/edit/shotplan.mjs';
import { TREATMENTS } from '../../core/types.mjs';
import { requireProject, updateProject } from '../store/project.mjs';
import { shotPlanData } from '../lib/data.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'update_shot_plan',
  title: 'Edit the shot plan',
  description:
    'Used by the shot plan card. Change how a beat is shown (treatment), its on-screen text (text), or the hook (hook_text). Camera and sound are rebuilt from the new beats; the speech and captions are not touched. A hook that breaks a rule is refused with the reasons.',
  input: {
    project_id: z.string(),
    beats: z
      .array(
        z.object({
          id: z.string(),
          treatment: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (TREATMENTS))).optional(),
          text: z.string().optional().describe('On-screen text for the beat. Empty clears it.'),
          screen_text: z.string().optional().describe('Same as text.'),
        }),
      )
      .default([]),
    hook_text: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const current = await requireProject(args.project_id);
    if (!current.shot_plan || !current.cut || !current.transcript) return fail('There is no shot plan yet. Run plan_shots first.');
    const edits = {
      beats: args.beats.map((b) => ({
        id: b.id,
        ...(b.treatment !== undefined ? { treatment: b.treatment } : {}),
        ...(b.text !== undefined || b.screen_text !== undefined ? { screen_text: b.text ?? b.screen_text } : {}),
      })),
      ...(args.hook_text !== undefined ? { hook_text: args.hook_text } : {}),
    };
    const next = editShotPlan(current.transcript, current.cut, current.shot_plan, edits);
    const { project } = await updateProject(args.project_id, (p) => {
      p.shot_plan = next;
    });
    return ok(shotPlanData(project));
  },
});
