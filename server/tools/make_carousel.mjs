import { createProject, deleteProject } from '../store/project.mjs';
import { brandInput, layoutHelp, renderIntoProject, sizeInput, slideInput } from '../lib/carousel.mjs';
import { defineTool, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'make_carousel',
  title: 'Make a carousel',
  description:
    `Render a carousel as JPEG slides (1080 by 1350 by default) from a layout and fields for each slide. Layouts: cover, list, steps, stat, comparison, quote, checklist, myth-fact, before-after, cta, photo-hero, framework. Text that is over a layout's limit is refused with the field name and the limit (nothing is cut silently); set allow_overflow to shrink the text instead. Uses brand.json if present. Always follow with offer_post so the person can post it.

Layouts and their fields:
${layoutHelp()}`,
  input: {
    title: z.string().min(1).describe('A name for the carousel.'),
    slides: z.array(slideInput).min(1).max(20),
    brand: brandInput,
    size: sizeInput,
    allow_overflow: z.boolean().optional().describe('Shrink text that is over the limit instead of refusing.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args, ctx) {
    ctx.progress(0.1, 'Drawing the slides');
    const project = await createProject({ type: 'carousel', title: args.title });
    try {
      const data = await renderIntoProject(
        project.id,
        { title: args.title, slides: /** @type {any} */ (args.slides) },
        { brand: args.brand, size: args.size, allowOverflow: args.allow_overflow },
      );
      return { data };
    } catch (error) {
      // A failed first render leaves nothing worth keeping.
      await deleteProject(project.id).catch(() => {});
      throw error;
    }
  },
});
