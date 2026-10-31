// The "steps" layout: a title and up to five steps joined by a line, each with a number.
import { text, list, obj } from '../fields.mjs';
import { h, t } from '../ui.mjs';

export const layout = {
  id: 'steps',
  theme: 'default',
  fields: {
    title: text(60),
    steps: list(obj({ n: text(3, { optional: true }), text: text(70) }), 1, 5),
  },
  sample: {
    title: 'Turn one idea into a week of posts',
    steps: [
      { n: '1', text: 'Write the idea in one plain sentence' },
      { n: '2', text: 'Pull out three small points that back it up' },
      { n: '3', text: 'Turn each point into its own short post' },
      { n: '4', text: 'Add one question to invite replies' },
      { n: '5', text: 'Schedule the set and walk away' },
    ],
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const W = ctx.box.width;
    /** @type {{n?: string, text: string}[]} */
    const steps = f.steps;
    const count = steps.length;
    const titleSize = ctx.pick([92, 82, 72, 64, 56, 50], (s) => ctx.lines('head', f.title, s, W) <= 2);
    const titleH = ctx.est('head', f.title, titleSize, W) + sp(38);
    /** @param {number} s */
    const geometry = (s) => {
      const dot = fs(Math.round(s * 1.7));
      const gap = sp(Math.round(s * 0.6));
      const textW = W - dot - fs(32);
      const rows = steps.map((st, i) => Math.max(dot, ctx.est('body', st.text, s, textW, 1.2)) + (i === count - 1 ? 0 : gap));
      return { dot, gap, total: rows.reduce((a, b) => a + b, 0) };
    };
    const size = ctx.pick([48, 44, 41, 38, 35, 32, 29], (s) => titleH + geometry(s).total <= ctx.avail);
    const { dot, gap } = geometry(size);
    return {
      main: [
        t(f.title, ctx.head(titleSize, { marginBottom: sp(38) })),
        h(
          { flexDirection: 'column' },
          steps.map((s, i) => {
            const last = i === count - 1;
            return h({ alignItems: 'stretch' }, [
              // Left rail: the numbered dot, then a line down to the next dot.
              h({ flexDirection: 'column', alignItems: 'center', width: dot, flexShrink: 0, marginRight: fs(32) }, [
                h(
                  {
                    width: dot - 2 * fs(5),
                    height: dot - 2 * fs(5),
                    flexShrink: 0,
                    borderRadius: dot,
                    background: i === 0 ? c.accent : c.bg,
                    border: `${fs(5)}px solid ${c.accent}`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  t(s.n || String(i + 1), ctx.body(Math.round(size * ((s.n || '1').length > 2 ? 0.45 : (s.n || '1').length > 1 ? 0.62 : 0.85)), 'bold', { color: i === 0 ? c.onAccent : c.accentText, lineHeight: 1 })),
                ),
                last ? null : h({ width: 4, flexGrow: 1, marginTop: 6, marginBottom: 6, background: c.line }),
              ]),
              h({ flexDirection: 'column', justifyContent: 'center', minHeight: dot, flexGrow: 1, flexShrink: 1, paddingBottom: last ? 0 : gap }, [
                t(s.text, ctx.body(size, 'semi', { lineHeight: 1.2 })),
              ]),
            ]);
          }),
        ),
      ],
    };
  },
};
