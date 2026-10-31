// The "stat" layout: one huge number with a label and a note.
import { text } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'stat',
  theme: 'default',
  fields: {
    number: text(8),
    label: text(60),
    note: text(120, { optional: true }),
  },
  sample: {
    number: '73%',
    label: 'of people save posts that teach one clear thing',
    note: 'Keep each post to a single idea and say it in plain words.',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    const panelPad = fs(56);
    const numSize = ctx.fit(f.number.length, W - 2 * panelPad, (ctx.story ? 400 : 340) / ctx.hs);
    const noteH = f.note ? ctx.est('body', f.note, 38, fs(840)) + sp(28) : 0;
    const panelH = Math.round(ctx.headPx(numSize) * 1.04) + fs(100) + sp(48);
    const labelSize = ctx.pick([76, 68, 60, 54, 48], (s) => ctx.est('head', f.label, s, W) + noteH + panelH <= ctx.avail && ctx.lines('head', f.label, s, W) <= 3);
    return {
      main: [
        h(
          {
            flexDirection: 'column',
            background: c.soft,
            borderRadius: fs(44),
            paddingTop: fs(44),
            paddingBottom: fs(56),
            paddingLeft: panelPad,
            paddingRight: panelPad,
            marginBottom: sp(48),
          },
          t(f.number, ctx.head(numSize, { color: c.accentText, lineHeight: 1.02, letterSpacing: -fs(4) })),
        ),
        t(f.label, ctx.head(labelSize, { lineHeight: 1.08 })),
        f.note ? t(f.note, ctx.body(38, 'regular', { color: c.muted, marginTop: sp(28), lineHeight: 1.3, maxWidth: fs(840) })) : null,
      ],
    };
  },
};
