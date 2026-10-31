import { CAPTION_THEMES, LOOK_IDS } from '../../core/types.mjs';
import { DEFAULT_LOOK_ID, getLook, listLooks } from '../../core/edit/looks.mjs';
import * as log from '../../core/util/log.mjs';
import { requireProject, updateProject } from '../store/project.mjs';
import { renderFunction } from '../lib/preview.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

/** The look fields a picker card shows. @param {import('../../core/types.mjs').Look} l */
function lookCard(l) {
  return {
    id: l.id,
    name: l.name,
    summary: l.summary,
    caption_theme: l.caption_theme,
    camera_aggression: l.camera_aggression,
    cut_every_ms_min: l.cut_every_ms_min,
    cut_every_ms_max: l.cut_every_ms_max,
    sfx_per_minute: l.sfx_per_minute,
    grade: l.grade,
    accent: l.accent,
  };
}

export const tool = defineTool({
  name: 'pick_look',
  title: 'Pick a look',
  description:
    'Show the five looks (karaoke-clean, bold-value, minimal-educator, editorial-luxe, storytime-energy) with a caption sample picture from this video. Call with no look to show them. Call with look (and optionally caption_theme and accent) to choose one. Choosing a different look clears the shot plan, because the plan depends on it.',
  input: {
    project_id: z.string(),
    look: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (LOOK_IDS))).optional(),
    caption_theme: z.enum(/** @type {[string, ...string[]]} */ (/** @type {unknown} */ (CAPTION_THEMES))).optional().describe('One of eight caption styles. Defaults to the look\'s own.'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a color like #FFD93D.').optional().describe('Accent color for highlighted words, "#RRGGBB".'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    let project = await requireProject(args.project_id);
    if (project.type !== 'video') return fail('Looks are for video projects.');
    const choosing = Boolean(args.look || args.caption_theme || args.accent);
    if (choosing) {
      const baseId = args.look ?? project.look_id ?? DEFAULT_LOOK_ID;
      const switching = Boolean(args.look) && args.look !== project.look_id;
      const look = getLook(baseId, {
        caption_theme: args.caption_theme ?? (switching ? undefined : project.caption_theme),
        accent: args.accent ?? (switching ? undefined : project.accent),
      });
      ({ project } = await updateProject(args.project_id, (p) => {
        const same = p.look_id === look.id && p.caption_theme === look.caption_theme && p.accent === look.accent;
        p.look_id = look.id;
        p.caption_theme = look.caption_theme;
        p.accent = look.accent;
        p.cut_applied = p.cut_applied || Boolean(p.cut);
        if (!same) delete p.shot_plan;
      }));
    }
    const defaults = getLook(project.look_id ?? DEFAULT_LOOK_ID, {
      caption_theme: project.caption_theme,
      accent: project.accent,
    });
    const current = { look_id: defaults.id, caption_theme: defaults.caption_theme, accent: defaults.accent };

    const looks = [];
    let samples = true;
    let done = 0;
    for (const l of listLooks()) {
      const card = /** @type {Record<string, any>} */ (lookCard(l));
      if (samples) {
        try {
          const makeSample = await renderFunction('render', 'renderLookSample', 'The caption sample pictures');
          const captionTheme = l.id === current.look_id ? current.caption_theme : l.caption_theme;
          const id = await makeSample({ projectId: project.id, look: l.id, captionTheme });
          if (typeof id === 'string' && id) card.sample_asset_id = id;
        } catch (error) {
          samples = false;
          log.warn('Look samples are off for this call:', error);
        }
      }
      ctx.progress(++done / 5, `Look ${l.name}`);
      looks.push(card);
    }
    return ok({ project_id: project.id, current, looks, ...(samples ? {} : { samples_unavailable: true }) });
  },
});
