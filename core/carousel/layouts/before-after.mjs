// The "before-after" layout: two tall cards side by side with an arrow between them.
import { text } from '../fields.mjs';
import { h, t, label } from '../ui.mjs';

export const layout = {
  id: 'before-after',
  theme: 'default',
  fields: {
    title: text(50),
    before: text(100),
    after: text(100),
  },
  sample: {
    title: 'Fix a weak opening line',
    before: 'Here are some thoughts I have been having about writing better posts.',
    after: 'Most posts lose people in the first line. Here is how to fix yours.',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const gapMid = fs(44);
    const colW = Math.floor((W - gapMid) / 2);
    const padL = fs(40);
    const padR = fs(40);
    const inner = colW - padL - padR;
    const titleSize = ctx.pick([88, 78, 68, 60, 52], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(44);
    const cardChrome = fs(44) + fs(52) + fs(26) + sp(28);
    const size = ctx.pick([46, 42, 38, 35, 32, 29], (s) =>
      titleH + cardChrome + Math.max(ctx.est('head', f.before, s, inner, 1.16), ctx.est('head', f.after, s, inner, 1.16)) <= ctx.avail,
    );
    /** @param {string} tag @param {string} body @param {boolean} hot */
    const card = (tag, body, hot) =>
      h(
        {
          flexDirection: 'column',
          width: colW - padL - padR - fs(10),
          flexShrink: 0,
          background: hot ? c.accent : c.surface,
          borderRadius: fs(40),
          paddingTop: fs(44),
          paddingBottom: fs(52),
          paddingLeft: hot ? padL + fs(10) : padL,
          paddingRight: hot ? padR : padR + fs(10),
        },
        [
          label(ctx, tag, { color: hot ? c.onAccent : c.muted, fontSize: fs(26), marginBottom: sp(28) }),
          t(body, ctx.head(size, { fontWeight: hot ? 600 : 400, color: hot ? c.onAccent : c.fg, lineHeight: 1.16 })),
        ],
      );
    const chip = fs(88);
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(44) })),
        h({ position: 'relative', alignItems: 'stretch' }, [
          card('Before', f.before, false),
          h({ width: gapMid, flexShrink: 0 }),
          card('After', f.after, true),
          h(
            {
              position: 'absolute',
              left: Math.round(colW + gapMid / 2 - chip / 2),
              top: fs(44),
              width: chip - 2 * fs(5),
              height: chip - 2 * fs(5),
              borderRadius: chip,
              background: c.bg,
              border: `${fs(5)}px solid ${c.fg}`,
              alignItems: 'center',
              justifyContent: 'center',
            },
            t('→', { fontFamily: 'Inter', fontWeight: 800, fontSize: fs(46), lineHeight: 1, color: c.fg, marginTop: -fs(3) }),
          ),
        ]),
      ],
    };
  },
};
