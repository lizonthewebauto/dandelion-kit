// The "cover" layout: kicker, big title, one supporting line.
import { text } from '../fields.mjs';
import { h, t, label } from '../ui.mjs';

export const layout = {
  id: 'cover',
  theme: 'default',
  fields: {
    kicker: text(30, { optional: true }),
    title: text(60),
    subtitle: text(90, { optional: true }),
  },
  sample: {
    kicker: 'Quick guide',
    title: 'How to write posts people actually save',
    subtitle: 'Five small habits that make every post easier to write.',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const subH = f.subtitle ? ctx.est('body', f.subtitle, 42, fs(800)) + sp(48) : 0;
    const kickH = f.kicker ? fs(40) + sp(40) : 0;
    const room = ctx.avail - subH - kickH;
    const size = ctx.pick([210, 186, 164, 146, 130, 116, 104, 92], (s) => ctx.est('head', f.title, s, W) <= room * 0.9 && ctx.lines('head', f.title, s, W) <= 4);
    return {
      main: [
        f.kicker
          ? h({ alignItems: 'center', marginBottom: sp(40) }, [
              h({ width: fs(64), height: fs(8), borderRadius: fs(4), background: c.accent, marginRight: fs(22) }),
              label(ctx, f.kicker, { fontSize: fs(28), letterSpacing: fs(6) }),
            ])
          : null,
        t(f.title, ctx.head(size)),
        f.subtitle
          ? h({ marginTop: sp(48), paddingLeft: fs(28), borderLeft: `${fs(8)}px solid ${c.accent}` }, [
              t(f.subtitle, ctx.body(42, 'regular', { color: c.muted, lineHeight: 1.3, maxWidth: fs(800) })),
            ])
          : null,
      ],
    };
  },
};
