// The "quote" layout: a big pull quote and who said it.
import { text } from '../fields.mjs';
import { h, t, label } from '../ui.mjs';

export const layout = {
  id: 'quote',
  theme: 'default',
  fields: {
    quote: text(140),
    who: text(40, { optional: true }),
  },
  sample: {
    quote: 'Make one useful thing every day and the audience takes care of itself.',
    who: 'Maya Alvarez, Founder',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const markH = fs(190);
    const whoH = f.who ? fs(40) + sp(52) : 0;
    const size = ctx.pick([112, 100, 90, 80, 72, 64, 58], (s) => ctx.est('head', f.quote, s, W, 1.14) + markH + whoH + sp(8) <= ctx.avail);
    return {
      main: [
        t('“', ctx.head(400, { color: c.accent, lineHeight: 0.8, height: markH, fontWeight: 600 })),
        t(f.quote, ctx.head(size, { fontWeight: 400, lineHeight: 1.14, letterSpacing: -fs(1.5), marginTop: sp(8) })),
        f.who
          ? h({ alignItems: 'center', marginTop: sp(52) }, [
              h({ width: fs(64), height: fs(6), borderRadius: fs(3), background: c.accent, marginRight: fs(22) }),
              label(ctx, f.who, { color: c.fg, fontSize: fs(26), letterSpacing: fs(3.5) }),
            ])
          : null,
      ],
    };
  },
};
