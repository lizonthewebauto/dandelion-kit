import { DEFAULT_CAROUSEL_TOKENS } from '../../core/carousel/ui.mjs';
import { requireProject } from '../store/project.mjs';
import { layoutHelp, renderIntoProject, sizeInput, slideInput } from '../lib/carousel.mjs';
import { defineTool, fail, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'update_slides',
  title: 'Change the slides',
  description:
    `Used by the carousel card. Replace the slides (layout and fields for each) and render them again with the same brand. Over-limit text is refused with the field name and limit.

Layouts and their fields:
${layoutHelp()}`,
  input: {
    project_id: z.string(),
    style: z.string().optional().describe('Use a saved style. Leave out to keep this project style.'),
    slides: z.array(slideInput).min(1).max(20),
    size: sizeInput,
    allow_overflow: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args) {
    const project = await requireProject(args.project_id);
    if (project.type !== 'carousel' || !project.carousel) return fail('This project is not a carousel or image.');
    const data = await renderIntoProject(
      project.id,
      { title: project.carousel.title, slides: /** @type {any} */ (args.slides) },
      { ...(args.style ? { style: args.style } : { brand: project.carousel.brand, tokens: project.carousel_tokens ?? DEFAULT_CAROUSEL_TOKENS, style_name: project.style_name }), size: args.size ?? project.carousel.size, allowOverflow: args.allow_overflow },
    );
    return { data };
  },
});
