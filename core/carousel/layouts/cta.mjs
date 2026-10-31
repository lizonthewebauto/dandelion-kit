// The "cta" layout: the closing slide on the accent color, with a pill to follow.
import { text } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'cta',
  theme: 'accent',
  chrome: { footer: false },
  fields: {
    title: text(60),
    line: text(100, { optional: true }),
    handle: text(30, { optional: true }),
  },
  sample: {
    title: 'Want more posts like this?',
    line: 'Follow along. New ideas land every week.',
    handle: '@yourhandle',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const handle = f.handle || ctx.brand.handle;
    const lineH = f.line ? ctx.est('body', f.line, 46, fs(840)) + sp(40) : 0;
    const pillH = fs(110) + sp(64);
    const size = ctx.pick([190, 168, 148, 130, 116, 104, 92], (s) => ctx.est('head', f.title, s, W) + lineH + pillH <= ctx.avail * 0.95 && ctx.lines('head', f.title, s, W) <= 4);
    return {
      main: [
        t(f.title, ctx.head(size)),
        f.line ? t(f.line, ctx.body(46, 'regular', { color: c.fg, marginTop: sp(40), lineHeight: 1.28, maxWidth: fs(840) })) : null,
        h(
          { marginTop: sp(64) },
          h({ alignItems: 'center', background: c.paper, borderRadius: fs(100), paddingLeft: fs(52), paddingRight: fs(24), paddingTop: fs(24), paddingBottom: fs(24) }, [
            t(handle, ctx.body(42, 'bold', { color: c.ink, lineHeight: 1, marginRight: fs(30) })),
            h(
              { width: fs(66), height: fs(66), borderRadius: fs(66), background: c.ink, alignItems: 'center', justifyContent: 'center' },
              t('→', { fontFamily: 'Inter', fontWeight: 800, fontSize: fs(38), lineHeight: 1, color: c.paper, marginTop: -fs(3) }),
            ),
          ]),
        ),
      ],
    };
  },
};
