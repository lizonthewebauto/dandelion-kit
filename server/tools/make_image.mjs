import { createProject, deleteProject } from '../store/project.mjs';
import { brandInput, layoutHelp, renderIntoProject, sizeInput, slideInput } from '../lib/carousel.mjs';
import { defineTool, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'make_image',
  title: 'Make an image',
  description:
    `Render one JPEG image from a layout and its fields. It is a carousel with a single slide. Same layouts, limits and brand rules as make_carousel. Always follow with offer_post so the person can post it.

Layouts and their fields:
${layoutHelp()}`,
  input: {
    layout: slideInput.shape.layout,
    fields: slideInput.shape.fields,
    title: z.string().optional().describe('A name for the image. Defaults to the title field.'),
    brand: brandInput,
    size: sizeInput,
    allow_overflow: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(args) {
    const title = args.title ?? (typeof args.fields.title === 'string' ? args.fields.title : `${args.layout} image`);
    const project = await createProject({ type: 'carousel', title });
    try {
      const data = await renderIntoProject(
        project.id,
        { title, slides: [{ layout: /** @type {any} */ (args.layout), fields: args.fields }] },
        { brand: args.brand, size: args.size, allowOverflow: args.allow_overflow },
      );
      return { data };
    } catch (error) {
      await deleteProject(project.id).catch(() => {});
      throw error;
    }
  },
});
