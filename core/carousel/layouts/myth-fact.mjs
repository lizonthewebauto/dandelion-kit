// The "myth-fact" layout: a struck-through myth over a bold fact.
import { text } from '../fields.mjs';
import { h, t, label } from '../ui.mjs';

export const layout = {
  id: 'myth-fact',
  theme: 'default',
  fields: {
    myth: text(110),
    fact: text(130),
  },
  sample: {
    myth: 'You have to post ten times a day to grow.',
    fact: 'Steady, useful posts beat a flood of rushed ones. Three good posts a week is plenty to start.',
  },
  /** @param {Record<string, any>} f @param {import('../ui.mjs').Ctx} ctx */
  render(f, ctx) {
    const { c, fs, sp } = ctx;
    const pad = fs(52);
    const inner = ctx.box.width - 2 * pad;
    const chrome = fs(44) + fs(48) + fs(40) + sp(22);
    const factSize = ctx.pick([84, 76, 68, 60, 54, 48, 44, 40], (s) => {
      const mythS = Math.round(s * 0.8);
      return 2 * chrome + sp(24) + ctx.est('head', f.myth, mythS, inner, 1.12) + ctx.est('head', f.fact, s, inner, 1.1) <= ctx.avail;
    });
    const mythSize = Math.round(factSize * 0.8);
    return {
      main: [
        h({ flexDirection: 'column', background: c.surface, borderRadius: fs(40), padding: pad, paddingTop: fs(44), paddingBottom: fs(48) }, [
          h({ alignItems: 'center', marginBottom: sp(22) }, [
            h(
              { width: fs(40), height: fs(40), borderRadius: fs(40), border: `4px solid ${c.muted}`, alignItems: 'center', justifyContent: 'center', marginRight: fs(16) },
              t('×', ctx.body(30, 'bold', { color: c.muted, lineHeight: 1, marginTop: -fs(2) })),
            ),
            label(ctx, 'Myth', { color: c.muted, fontSize: fs(28) }),
          ]),
          t(f.myth, ctx.head(mythSize, { fontWeight: 400, color: c.muted, textDecoration: 'line-through', lineHeight: 1.12 })),
        ]),
        h({ flexDirection: 'column', background: c.accent, borderRadius: fs(40), padding: pad, paddingTop: fs(44), paddingBottom: fs(48), marginTop: sp(24) }, [
          h({ alignItems: 'center', marginBottom: sp(22) }, [
            h({ width: fs(40), height: fs(40), borderRadius: fs(40), background: c.onAccent, marginRight: fs(16) }),
            label(ctx, 'Fact', { color: c.onAccent, fontSize: fs(28) }),
          ]),
          t(f.fact, ctx.head(factSize, { color: c.onAccent, lineHeight: 1.1 })),
        ]),
      ],
    };
  },
};
