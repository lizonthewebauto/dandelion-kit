import { defineTool, ok, z } from '../lib/kit.mjs';
import { saveStyle, removeStyle } from '../../core/style/store.mjs';
import { styleSchema } from '../../core/style/schema.mjs';
export const tool = defineTool({
  name: 'save_style', title: 'Save a style',
  description: 'Save a named style from the parts the person likes. Partial styles work. Samples stay on this computer. Ask what they like and what to call it before saving.',
  input: { name: z.string().trim().min(1).max(40), style: styleSchema.optional(), liked: z.array(z.enum(['colors','fonts','feel','captions','pacing','opening'])).optional(), notes: z.string().max(400).optional(), make_default: z.boolean().optional(), remove: z.boolean().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    if (args.remove) { await removeStyle(args.name); return ok({ removed: true }, `Removed style ${args.name}.`); }
    if (!args.style) throw new Error('The style needs at least one part: brand, carousel or video.');
    const saved = await saveStyle(args.name, args.style, args);
    return ok(saved, `${saved.replaced ? 'Replaced' : 'Saved'} style ${saved.style.name}.${saved.is_default ? ' This is your default style.' : ''}\nFile: ${saved.file}`);
  },
});
