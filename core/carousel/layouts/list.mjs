// The "list" layout: a title and up to six numbered lines.
import { text, list } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'list',
  theme: 'default',
  fields: {
    title: text(60),
    items: list(text(48), 1, 6),
  },
  sample: {
    title: 'Six habits of steady posters',
    items: [
      'Write one idea per post',
      'Save the good ones as drafts',
      'Post at the same time each day',
      'Reply to every comment early',
      'Reuse what already worked',
      'Stop when the idea is done',
    ],
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    /** @type {string[]} */
    const items = f.items;
    const titleSize = ctx.pick([96, 86, 76, 66, 58, 52], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(34);
    /** @param {number} s */
    const geometry = (s) => {
      const badge = fs(Math.round(s * 1.45));
      const pad = sp(Math.round(s * 0.42));
      const textW = W - badge - fs(28);
      const rows = items.map((it) => Math.max(badge, ctx.est('body', it, s, textW, 1.2)) + 2 * pad + 2);
      return { badge, pad, total: rows.reduce((a, b) => a + b, 0) };
    };
    const size = ctx.pick([54, 50, 46, 42, 38, 35, 32, 29], (s) => titleH + geometry(s).total <= ctx.avail);
    const { badge, pad } = geometry(size);
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(34) })),
        h(
          { flexDirection: 'column', borderTop: `2px solid ${c.line}` },
          items.map((item, i) =>
            h({ alignItems: 'center', paddingTop: pad, paddingBottom: pad, borderBottom: i === items.length - 1 ? 'none' : `2px solid ${c.line}` }, [
              h(
                {
                  width: badge,
                  height: badge,
                  flexShrink: 0,
                  borderRadius: badge,
                  background: c.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: fs(28),
                },
                t(String(i + 1), ctx.body(Math.round(size * 0.82), 'bold', { color: c.onAccent, lineHeight: 1 })),
              ),
              t(item, ctx.body(size, 'semi', { flexGrow: 1, flexShrink: 1, lineHeight: 1.2 })),
            ]),
          ),
        ),
      ],
    };
  },
};
