// Building blocks shared by the 12 layouts: element helpers, the theme context, header, footer, page frame.
// satori element trees are plain objects: {type, props:{style, children}}. No React.
import { IMAGE_SIZES } from '../types.mjs';
import { FONTS } from './fonts.mjs';
import { contrast, mix, readableOn } from './color.mjs';

/** @typedef {{type:string, props:Record<string, any>, key?:string}} El */
/** @typedef {import('../types.mjs').BrandConfig} BrandConfig */

/**
 * A flex box. Every element is display:flex because satori needs it for more than one child.
 * @param {Record<string, any>} style
 * @param {any} [children]
 * @param {string} [key]
 * @returns {El}
 */
export function h(style, children, key) {
  const kids = Array.isArray(children) ? children.flat().filter((c) => c !== false && c != null && c !== '') : children;
  return { type: 'div', key, props: { style: { display: 'flex', ...style }, children: kids } };
}

/** A box holding one run of text. @param {string} s @param {Record<string, any>} style @param {string} [key] @returns {El} */
export function t(s, style, key) {
  return h(style, String(s), key);
}

/**
 * @typedef {object} Colors
 * @property {string} bg
 * @property {string} fg
 * @property {string} accent        Fill color for shapes.
 * @property {string} accentText    Accent when it reads as text on bg, else fg.
 * @property {string} muted
 * @property {string} surface       A panel a little off the background.
 * @property {string} line          Hairlines.
 * @property {string} onAccent      Text that reads on a filled accent shape.
 * @property {string} soft          A light tint of the accent.
 * @property {string} paper         The brand background (for inverted pills).
 * @property {string} ink           The brand text color.
 */

/**
 * @typedef {object} Ctx
 * @property {number} W
 * @property {number} H
 * @property {string} sizeId
 * @property {number} k             Type scale. 1 for portrait and story, less for square, less again when auto-fit shrinks.
 * @property {boolean} story
 * @property {{left:number, top:number, width:number, height:number}} box  The safe area.
 * @property {Colors} c
 * @property {BrandConfig} brand
 * @property {number} index         0-based slide number.
 * @property {number} total
 * @property {boolean} hasNext
 * @property {string|null} logoUri
 * @property {number} logoRatio     Logo width divided by height.
 * @property {(n:number)=>number} fs   Scale a font size.
 * @property {(n:number)=>number} sp   Scale a gap.
 * @property {(size:number, extra?:Record<string, any>)=>Record<string, any>} head   Heading text style.
 * @property {(size:number, weight?:'regular'|'semi'|'bold', extra?:Record<string, any>)=>Record<string, any>} body  Body text style.
 * @property {number} headWidth    Average heading character width (em fraction) for sizing one-line text.
 * @property {(chars:number, widthPx:number, cap:number)=>number} fit  Base heading size (for head()) that keeps one line of this many characters inside widthPx.
 * @property {number} hs           The heading font's size multiplier (some faces look smaller or larger at the same number).
 * @property {(base:number)=>number} headPx  Final pixel size of a heading at this base size.
 * @property {string|null} photoUri  Prepared background photo for the photo-hero layout.
 * @property {number} avail         Height of the main area in pixels (safe area minus header, footer and padding).
 * @property {(kind:'head'|'body', s:string, base:number, widthPx:number, lh?:number)=>number} est  Estimated pixel height of wrapped text at a base size.
 * @property {(kind:'head'|'body', s:string, base:number, widthPx:number)=>number} lines  Estimated line count.
 * @property {(sizes:number[], fits:(size:number)=>boolean)=>number} pick  The first (largest) size that fits, else the last.
 */

/** Type scale per size. Square has less height, so everything is a little smaller. */
const BASE_SCALE = { portrait: 1, square: 0.84, story: 1 };

/** @param {number} n */
const r = (n) => Math.round(n);

/**
 * @param {object} o
 * @param {BrandConfig} o.brand
 * @param {keyof typeof IMAGE_SIZES} o.size
 * @param {'default'|'accent'|'photo'} [o.theme]
 * @param {number} [o.index]
 * @param {number} [o.total]
 * @param {number} [o.shrink]   Extra scale from auto-fit, 1 means none.
 * @param {string|null} [o.logoUri]
 * @param {number} [o.logoRatio]
 * @param {boolean} [o.footer]
 * @returns {Ctx}
 */
export function makeContext({ brand, size, theme = 'default', index = 0, total = 1, shrink = 1, logoUri = null, logoRatio = 1, footer = true }) {
  const { width: W, height: H, id: sizeId } = IMAGE_SIZES[size];
  const k = BASE_SCALE[size] * shrink;
  const story = size === 'story';
  const box = { left: r(W * 0.06), top: r(H * 0.1), width: W - 2 * r(W * 0.06), height: H - 2 * r(H * 0.1) };

  const { bg, fg, accent, muted } = brand.colors;
  const onAccent = readableOn(accent, [bg, fg, '#FFFFFF']);
  /** @type {Colors} */
  let c;
  if (theme === 'accent') {
    c = {
      bg: accent,
      fg: onAccent,
      accent: onAccent,
      accentText: onAccent,
      muted: mix(onAccent, accent, 0.3),
      surface: mix(accent, onAccent, 0.1),
      line: mix(accent, onAccent, 0.3),
      onAccent: accent,
      soft: mix(accent, onAccent, 0.16),
      paper: bg,
      ink: fg,
    };
  } else if (theme === 'photo') {
    c = {
      bg: '#101010',
      fg: '#FFFFFF',
      accent,
      accentText: contrast(accent, '#101010') >= 3 ? accent : '#FFFFFF',
      muted: '#E4DFD3',
      surface: '#1B1B1B',
      line: '#FFFFFF',
      onAccent,
      soft: mix('#101010', accent, 0.2),
      paper: bg,
      ink: fg,
    };
  } else {
    c = {
      bg,
      fg,
      accent,
      accentText: contrast(accent, bg) >= 3 ? accent : fg,
      muted,
      surface: mix(bg, fg, 0.06),
      line: mix(bg, fg, 0.16),
      onAccent,
      soft: mix(bg, accent, 0.14),
      paper: bg,
      ink: fg,
    };
  }

  const hf = FONTS[brand.fonts.heading];
  const bf = FONTS[brand.fonts.body];
  const headFamily = `${brand.fonts.heading}, Inter`;
  const bodyFamily = `${brand.fonts.body}, Inter`;
  const headWeight = hf.files.some((f) => f.weight === 600) ? 600 : 400;
  const WEIGHTS = { regular: 400, semi: 600, bold: 800 };

  /** @type {Ctx} */
  const ctx = {
    W,
    H,
    sizeId,
    k,
    story,
    box,
    c,
    brand,
    index,
    total,
    hasNext: index < total - 1,
    logoUri,
    logoRatio,
    fs: (n) => r(n * k),
    sp: (n) => r(n * k * (story ? 1.18 : 1)),
    head: (sz, extra = {}) => ({
      fontFamily: headFamily,
      fontWeight: headWeight,
      fontSize: r(sz * hf.size * k),
      lineHeight: hf.lineHeight,
      letterSpacing: Math.round(sz * hf.size * k * hf.tracking * 10) / 10,
      textTransform: hf.upper ? 'uppercase' : 'none',
      textWrap: 'balance',
      color: c.fg,
      ...extra,
    }),
    body: (sz, weight = 'regular', extra = {}) => ({
      fontFamily: bodyFamily,
      fontWeight: bf.files.length > 1 ? WEIGHTS[weight] : 400,
      fontSize: r(sz * bf.size * k),
      lineHeight: 1.28,
      color: c.fg,
      ...extra,
    }),
    headWidth: hf.width,
    fit: (chars, widthPx, cap) => Math.floor(Math.min(cap, widthPx / (Math.max(1, chars) * hf.width * 1.12 * hf.size * k))),
    hs: hf.size,
    headPx: (base) => r(base * hf.size * k),
    photoUri: null,
    avail: 0,
    est: () => 0,
    lines: () => 1,
    pick: (sizes, fits) => sizes.find((x) => fits(x)) ?? sizes[sizes.length - 1],
  };
  const px = (kind, base) => (kind === 'head' ? base * hf.size * k : base * bf.size * k);
  const cw = (kind) => (kind === 'head' ? hf.width : bf.width) * 1.06;
  ctx.lines = (kind, str, base, widthPx) => wrapCount(str, px(kind, base), cw(kind), widthPx);
  ctx.est = (kind, str, base, widthPx, lh) =>
    Math.ceil(ctx.lines(kind, str, base, widthPx) * px(kind, base) * (lh ?? (kind === 'head' ? hf.lineHeight : 1.28)));
  ctx.avail = box.height - ctx.fs(44) - (footer ? ctx.fs(64) : 0) - ctx.sp(14) - ctx.sp(18) - Math.round(box.height * 0.025);
  return ctx;
}

/**
 * Count the lines a run of words takes, by a width estimate per character.
 * @param {string} str @param {number} px @param {number} charW @param {number} widthPx
 */
export function wrapCount(str, px, charW, widthPx) {
  const space = px * charW * 0.55;
  let lines = 1;
  let x = 0;
  for (const word of str.split(/s+/).filter(Boolean)) {
    const w = word.length * px * charW;
    if (x === 0) x = w;
    else if (x + space + w <= widthPx) x += space + w;
    else {
      lines++;
      x = w;
    }
    while (x > widthPx) {
      lines++;
      x -= widthPx;
    }
  }
  return lines;
}

/** Small uppercase label text (kickers, tags, column heads). @param {Ctx} ctx @param {string} s @param {Record<string, any>} [extra] */
export function label(ctx, s, extra = {}) {
  return t(s, {
    fontFamily: `${ctx.brand.fonts.body}, Inter`,
    fontWeight: FONTS[ctx.brand.fonts.body].files.length > 1 ? 800 : 400,
    fontSize: ctx.fs(24),
    letterSpacing: ctx.fs(4.5),
    textTransform: 'uppercase',
    color: ctx.c.accentText,
    ...extra,
  });
}

/** @param {Ctx} ctx */
function header(ctx) {
  const mark = ctx.logoUri
    ? { type: 'img', props: { src: ctx.logoUri, width: Math.round(ctx.fs(40) * ctx.logoRatio), height: ctx.fs(40), style: { width: Math.round(ctx.fs(40) * ctx.logoRatio), height: ctx.fs(40), marginRight: ctx.fs(16) } } }
    : h({ width: ctx.fs(16), height: ctx.fs(16), borderRadius: ctx.fs(5), background: ctx.c.accent, marginRight: ctx.fs(14) });
  return h({ alignItems: 'center', height: ctx.fs(44), flexShrink: 0 }, [
    mark,
    t(ctx.brand.name, {
      fontFamily: `${ctx.brand.fonts.body}, Inter`,
      fontWeight: FONTS[ctx.brand.fonts.body].files.length > 1 ? 800 : 400,
      fontSize: ctx.fs(22),
      letterSpacing: ctx.fs(4),
      textTransform: 'uppercase',
      color: ctx.c.fg,
    }),
  ]);
}

/** @param {Ctx} ctx */
function footer(ctx) {
  const arrow = ctx.hasNext
    ? t('→', {
        fontFamily: 'Inter',
        fontWeight: 600,
        fontSize: ctx.fs(44),
        lineHeight: 1,
        color: ctx.c.accentText,
      })
    : null;
  return h(
    {
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: 0,
      height: ctx.fs(64),
      borderTop: `2px solid ${mixLine(ctx)}`,
    },
    [
      t(ctx.brand.handle, {
        fontFamily: `${ctx.brand.fonts.body}, Inter`,
        fontWeight: FONTS[ctx.brand.fonts.body].files.length > 1 ? 600 : 400,
        fontSize: ctx.fs(26),
        color: ctx.c.muted,
      }),
      arrow,
    ],
  );
}

/** Photo slides draw their rule in translucent white. @param {Ctx} ctx */
function mixLine(ctx) {
  return ctx.c.line === '#FFFFFF' ? 'rgba(255,255,255,0.35)' : ctx.c.line;
}

/**
 * The full page: background, optional full-bleed layers, then header, main and footer inside the safe area.
 * Elements keyed "bleed" are allowed outside the safe area. Main content must stay inside it.
 * @param {Ctx} ctx
 * @param {any} main        One element or an array of them.
 * @param {El[]} [bleed]
 * @param {{footer?: boolean, align?: 'center'|'end'}} [opts]
 * @returns {El}
 */
export function page(ctx, main, bleed = [], opts = {}) {
  const { box } = ctx;
  return {
    type: 'div',
    key: 'bleed-root',
    props: {
      style: {
        display: 'flex',
        position: 'relative',
        width: ctx.W,
        height: ctx.H,
        background: ctx.c.bg,
        fontFamily: `${ctx.brand.fonts.body}, Inter`,
      },
      children: [
        ...bleed,
        {
          type: 'div',
          key: 'frame',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              position: 'absolute',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            },
            children: [
              header(ctx),
              h(
                { flexDirection: 'column', flexGrow: 1, flexShrink: 0, justifyContent: opts.align === 'end' ? 'flex-end' : 'center', paddingTop: ctx.sp(14), paddingBottom: opts.align === 'end' ? ctx.sp(46) : ctx.sp(18) },
                main,
                'main',
              ),
              opts.footer === false ? null : footer(ctx),
            ],
          },
        },
      ],
    },
  };
}
