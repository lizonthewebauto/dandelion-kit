// The "framework" layout: a title and two to four labelled cells in a grid.
import { text, list, obj } from '../fields.mjs';
import { h, t, label } from '../ui.mjs';

export const layout = {
  id: 'framework',
  theme: 'default',
  fields: {
    title: text(60),
    cells: list(obj({ h: text(24), text: text(80) }), 2, 4),
  },
  sample: {
    title: 'The four parts of a post that works',
    cells: [
      { h: 'Hook', text: 'One line that earns the next three seconds.' },
      { h: 'Value', text: 'One idea the reader can use right away.' },
      { h: 'Proof', text: 'A small example, number or story.' },
      { h: 'Ask', text: 'A single clear step to take next.' },
    ],
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    /** @type {{h:string, text:string}[]} */
    const cells = f.cells;
    const gap = fs(20);
    const colW = Math.floor((W - gap) / 2);
    const padX = fs(36);
    const titleSize = ctx.pick([88, 78, 68, 60, 52], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(36);
    const rows = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
    /** @param {number} s @param {boolean} wide */
    const cellH = (s, wide, cell) => {
      const inner = (wide ? W : colW) - 2 * padX;
      return fs(32) + fs(40) + ctx.est('head', cell.h, Math.round(s * 1.45), inner, 1.06) + fs(14) + ctx.est('body', cell.text, s, inner, 1.26) + fs(36);
    };
    /** @param {number} s */
    const total = (s) =>
      rows.reduce((a, row, ri) => a + Math.max(...row.map((cell) => cellH(s, row.length === 1, cell))) + (ri === 0 ? 0 : gap), 0);
    const size = ctx.pick([38, 35, 33, 31, 29, 27], (s) => titleH + total(s) <= ctx.avail);
    /** @param {{h:string, text:string}} cell @param {number} i @param {boolean} wide */
    const card = (cell, i, wide) =>
      h(
        {
          flexDirection: 'column',
          width: (wide ? W : colW) - 2 * padX,
          flexShrink: 0,
          background: i === 0 ? c.accent : c.surface,
          borderRadius: fs(34),
          paddingTop: fs(32),
          paddingBottom: fs(36),
          paddingLeft: padX,
          paddingRight: padX,
        },
        [
          label(ctx, String(i + 1).padStart(2, '0'), { color: i === 0 ? c.onAccent : c.accentText, fontSize: fs(24), marginBottom: fs(16) }),
          t(cell.h, ctx.head(Math.round(size * 1.45), { color: i === 0 ? c.onAccent : c.fg, lineHeight: 1.06 })),
          t(cell.text, ctx.body(size, 'regular', { color: i === 0 ? c.onAccent : c.muted, marginTop: fs(14), lineHeight: 1.26 })),
        ],
      );
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(36) })),
        h(
          { flexDirection: 'column' },
          rows.map((row, ri) =>
            h({ alignItems: 'stretch', marginTop: ri === 0 ? 0 : gap }, [
              card(row[0], ri * 2, row.length === 1),
              row[1] ? h({ width: gap, flexShrink: 0 }) : null,
              row[1] ? card(row[1], ri * 2 + 1, false) : null,
            ]),
          ),
        ),
      ],
    };
  },
};
