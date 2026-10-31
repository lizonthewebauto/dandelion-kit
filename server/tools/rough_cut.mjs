import { ROUGH_CUT_PRESET_IDS, roughCut } from '../../core/edit/roughcut.mjs';
import { updateProject } from '../store/project.mjs';
import { cutData } from '../lib/data.mjs';
import { ensureTranscript } from '../lib/jobs.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'rough_cut',
  title: 'Rough cut',
  description:
    'Plan a breath-safe rough cut: take out ums, stutters, restarts and long pauses, keeping a little air around every cut so no word is clipped. Nothing is rendered. Returns every piece it would remove so the person can keep any of them (update_cut). Waits for the speech to finish if it is still being read. Presets: gentle, standard (default), punchy.',
  input: {
    project_id: z.string(),
    preset: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (ROUGH_CUT_PRESET_IDS))).optional().describe('How tight to cut. Default standard.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    const ready = await ensureTranscript(args.project_id, { onProgress: ctx.progress });
    const transcript = /** @type {import('../../core/types.mjs').Transcript} */ (ready.transcript);
    const { project } = await updateProject(args.project_id, (p) => {
      p.cut = roughCut(transcript, {
        preset: /** @type {any} */ (args.preset ?? p.cut?.preset ?? 'standard'),
        duration_ms: p.media?.duration_ms,
      });
      p.cut_applied = true;
      // A new cut moves every time in the plan, so the old plan and its renders no longer match.
      delete p.shot_plan;
    });
    return ok(cutData(project));
  },
});
