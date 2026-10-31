// The "photo-hero" layout: a full-bleed photo, a dark fade, the title low in the safe area.
// "overlay" is one short supporting line written over the photo, under the title.
import { text, path } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'photo-hero',
  theme: 'photo',
  needsImage: true,
  fields: {
    image: path(),
    title: text(70),
    overlay: text(80, { optional: true }),
  },
  sample: {
    image: '',
    title: 'The desk setup that made writing easy',
    overlay: 'Plain, bright and quiet.',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp, W, H } = ctx;
    const inner = ctx.box.width;
    const overH = f.overlay ? ctx.est('body', f.overlay, 42, inner) + sp(26) : 0;
    const size = ctx.pick([150, 132, 118, 104, 92, 82], (s) => ctx.lines('head', f.title, s, inner) <= 3 && ctx.est('head', f.title, s, inner) + overH + sp(34) + fs(9) <= ctx.avail * 0.7);
    /** @type {any[]} */
    const bleed = [];
    if (ctx.photoUri) {
      bleed.push({ type: 'img', key: 'bleed-photo', props: { src: ctx.photoUri, width: W, height: H, style: { position: 'absolute', left: 0, top: 0, width: W, height: H } } });
    }
    bleed.push(
      h(
        { position: 'absolute', left: 0, bottom: 0, width: W, height: Math.round(H * 0.7), backgroundImage: 'linear-gradient(to top, rgba(8,8,8,0.92), rgba(8,8,8,0.62) 50%, rgba(8,8,8,0))' },
        undefined,
        'bleed-scrim-bottom',
      ),
      h(
        { position: 'absolute', left: 0, top: 0, width: W, height: Math.round(H * 0.2), backgroundImage: 'linear-gradient(to bottom, rgba(8,8,8,0.55), rgba(8,8,8,0))' },
        undefined,
        'bleed-scrim-top',
      ),
    );
    return {
      align: 'end',
      bleed,
      main: [
        h({ width: fs(72), height: fs(9), borderRadius: fs(5), background: c.accent, marginBottom: sp(34) }),
        t(f.title, ctx.head(size, { color: '#FFFFFF', lineHeight: 1.03 })),
        f.overlay ? t(f.overlay, ctx.body(42, 'regular', { color: '#E9E4D8', marginTop: sp(26), lineHeight: 1.28 })) : null,
      ],
    };
  },
};
