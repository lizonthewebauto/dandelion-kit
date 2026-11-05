import { defineTool, ok, z } from '../lib/kit.mjs';
import { listStyles, readStyle, defaultStyle } from '../../core/style/store.mjs';
export const tool = defineTool({
  name: 'list_styles', title: 'Your saved styles',
  description: 'List saved style names, what was borrowed and which is the default. Give a name to read the full style. Samples stay on this computer.',
  input: { name: z.string().optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run({ name }) {
    if (name) { const style = await readStyle(name); return ok({ style }, JSON.stringify(style, null, 2)); }
    const all = await listStyles(); const current = await defaultStyle();
    const styles = all.map(s => ({ name: s.name, slug: s.slug, is_default: s.slug === current?.slug, liked: s.liked ?? [], summary: [s.brand?.colors ? 'brand colors' : '', s.brand?.fonts ? Object.values(s.brand.fonts).join(' and ') : '', s.brand?.logo ? 'saved logo' : '', s.carousel ? 'image feel' : '', s.video?.rough_cut ? `${s.video.rough_cut} video` : s.video ? 'video style' : ''].filter(Boolean).join(', ') || 'default choices' }));
    return ok({ styles }, styles.length ? styles.map(s => `${s.name}${s.is_default ? ' (default)' : ''}: ${s.summary}. Borrowed: ${s.liked.join(', ') || 'not labelled'}.`).join('\n') : 'No saved styles yet. Give me a sample to start.');
  },
});
