// The "comparison" layout: two columns, a muted one and a highlighted one.
import { text, list, obj } from '../fields.mjs';
import { h, t } from '../ui.mjs';

const side = () => obj({ h: text(24), items: list(text(40), 1, 4) });

export const layout = {
  id: 'comparison',
  theme: 'default',
  fields: {
    title: text(60),
    left: side(),
    right: side(),
  },
  sample: {
    title: 'Posting daily or posting weekly',
    left: { h: 'Weekly', items: ['One big post', 'Slow to grow', 'Easy to keep up', 'Fewer chances to learn'] },
    right: { h: 'Daily', items: ['Small, simple posts', 'Faster feedback', 'Takes a routine', 'More chances to learn'] },
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const gapMid = fs(22);
    const colW = Math.floor((W - gapMid) / 2);
    const padL = fs(34);
    const padR = fs(28);
    const bullet = fs(30);
    const inner = colW - padL - padR;
    const titleSize = ctx.pick([88, 78, 68, 60, 52], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(38);
    /** @param {number} s */
    const colHeight = (s) => {
      const headSize = Math.round(s * 1.4);
      /** @param {{h:string, items:string[]}} side */
      const one = (side) =>
        fs(40) + fs(36) + ctx.est('head', side.h, headSize, inner) + sp(26) + side.items.reduce((a, it) => a + ctx.est('body', it, s, inner - bullet, 1.22) + fs(22) + 2 + fs(14), 0);
      return Math.max(one(f.left), one(f.right));
    };
    const size = ctx.pick([42, 39, 36, 33, 30, 28], (s) => titleH + colHeight(s) <= ctx.avail);
    const headSize = Math.round(size * 1.4);
    /** @param {{h:string, items:string[]}} s @param {boolean} hot */
    const column = (s, hot) =>
      h(
        {
          flexDirection: 'column',
          width: colW - padL - padR,
          flexShrink: 0,
          background: hot ? c.accent : c.surface,
          borderRadius: fs(36),
          paddingTop: fs(40),
          paddingBottom: fs(36),
          paddingLeft: padL,
          paddingRight: padR,
        },
        [
          t(s.h, ctx.head(headSize, { color: hot ? c.onAccent : c.muted, lineHeight: 1.05, marginBottom: sp(26) })),
          ...s.items.map((item, i) =>
            h(
              {
                alignItems: 'flex-start',
                paddingTop: fs(22),
                borderTop: `2px solid ${hot ? 'rgba(255,255,255,0.3)' : c.line}`,
                marginTop: i === 0 ? 0 : fs(14),
              },
              [
                h({
                  width: fs(14),
                  height: fs(14),
                  flexShrink: 0,
                  borderRadius: fs(14),
                  marginTop: Math.round(size * 0.38 * ctx.k),
                  marginRight: fs(16),
                  background: hot ? c.onAccent : 'transparent',
                  border: `3px solid ${hot ? c.onAccent : c.muted}`,
                }),
                t(item, ctx.body(size, hot ? 'semi' : 'regular', { color: hot ? c.onAccent : c.fg, lineHeight: 1.22, flexShrink: 1 })),
              ],
            ),
          ),
        ],
      );
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(38) })),
        h({ alignItems: 'stretch' }, [column(f.left, false), h({ width: gapMid, flexShrink: 0 }), column(f.right, true)]),
      ],
    };
  },
};
