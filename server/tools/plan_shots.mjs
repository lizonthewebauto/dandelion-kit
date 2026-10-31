import { DEFAULT_LOOK_ID, getLook } from '../../core/edit/looks.mjs';
import { roughCut } from '../../core/edit/roughcut.mjs';
import { planShots } from '../../core/edit/shotplan.mjs';
import * as log from '../../core/util/log.mjs';
import { requireProject, updateProject } from '../store/project.mjs';
import { shotPlanData } from '../lib/data.mjs';
import { ensureTranscript } from '../lib/jobs.mjs';
import { renderFunction } from '../lib/preview.mjs';
import { defineTool, ok, progressAdapter, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'plan_shots',
  title: 'Plan the shots',
  description:
    'Build the shot plan from the words, the rough cut and the look: the hook (scored choices), each beat with how it is shown (face, punch-in, hold-wide, text-emphasis, hook-card, cta-end), caption cues, camera moves and sound cues. Nothing is rendered. Show the plan to the person and get a yes before building. Pass hook_text to use your own on-screen hook (9 words at most, no dashes); a weak one is refused with the reasons.',
  input: {
    project_id: z.string(),
    hook_text: z.string().optional().describe('Your own on-screen hook for the first 2 seconds.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    const ready = await ensureTranscript(args.project_id, { onProgress: ctx.progress });
    const transcript = /** @type {import('../../core/types.mjs').Transcript} */ (ready.transcript);
    const cut = ready.cut ?? roughCut(transcript, { preset: 'standard', duration_ms: ready.media?.duration_ms });
    const look = getLook(ready.look_id ?? DEFAULT_LOOK_ID, { caption_theme: ready.caption_theme, accent: ready.accent });
    ctx.progress(0.2, 'Planning the shots');
    const plan = planShots(transcript, cut, look, { hook_text: args.hook_text, seed: ready.id });
    await updateProject(ready.id, (p) => {
      p.cut = cut;
      p.cut_applied = true;
      p.look_id = look.id;
      p.caption_theme = look.caption_theme;
      p.accent = look.accent;
      p.shot_plan = plan;
    });
    // Captions sit below the chin. This looks for the face once, then writes the anchor into the saved plan.
    ctx.progress(0.5, 'Finding where captions sit');
    try {
      const captionAnchor = await renderFunction('facezone', 'captionAnchor', 'The caption placement');
      await captionAnchor({ projectId: ready.id, onProgress: progressAdapter(ctx) });
    } catch (error) {
      log.warn('Caption placement fell back to the default height:', error);
    }
    return ok(shotPlanData(await requireProject(ready.id)));
  },
});
