// The "checklist" layout: a title and up to seven ticked lines.
import { text, list } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'checklist',
  theme: 'default',
  fields: {
    title: text(60),
    items: list(text(44), 1, 7),
  },
  sample: {
    title: 'Before you hit post',
    items: [
      'The first line makes people stop',
      'One idea, nothing extra',
      'No long words or jargon',
      'A clear next step at the end',
      'The image is sharp and readable',
      'Tags and links are in place',
      'You read it out loud once',
    ],
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    /** @type {string[]} */
    const items = f.items;
    const titleSize = ctx.pick([92, 82, 72, 64, 56, 50], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(38);
    /** @param {number} s */
    const geometry = (s) => {
      const box = fs(Math.round(s * 1.35));
      const gap = sp(Math.round(s * 0.5));
      const textW = W - box - fs(28);
      const rows = items.map((it, i) => Math.max(box, ctx.est('body', it, s, textW, 1.2)) + (i === 0 ? 0 : gap));
      return { box, gap, total: rows.reduce((a, b) => a + b, 0) };
    };
    const size = ctx.pick([48, 44, 41, 38, 35, 32, 29], (s) => titleH + geometry(s).total <= ctx.avail);
    const { box, gap } = geometry(size);
    const stroke = Math.max(4, Math.round(box * 0.11));
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(38) })),
        h(
          { flexDirection: 'column' },
          items.map((item, i) =>
            h({ alignItems: 'center', marginTop: i === 0 ? 0 : gap }, [
              h(
                {
                  width: box,
                  height: box,
                  flexShrink: 0,
                  borderRadius: Math.round(box * 0.28),
                  background: c.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: fs(28),
                },
                // A tick drawn from two borders, so it does not depend on a font glyph.
                h({
                  width: Math.round(box * 0.26),
                  height: Math.round(box * 0.5),
                  borderRight: `${stroke}px solid ${c.onAccent}`,
                  borderBottom: `${stroke}px solid ${c.onAccent}`,
                  transform: 'rotate(45deg)',
                  marginTop: -Math.round(box * 0.08),
                }),
              ),
              t(item, ctx.body(size, 'semi', { flexGrow: 1, flexShrink: 1, lineHeight: 1.2 })),
            ]),
          ),
        ),
      ],
    };
  },
};
