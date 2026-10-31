// ShotPlan captions to an .ass file, eight caption themes, plus the hook card and on-screen text.
// The file is drawn by libass inside ffmpeg. Everything is placed with \pos so the caption block sits under the chin.
// Text widths come from the real font files, so a line that would run outside the safe zone is shrunk before it is drawn.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_CARD_MS, HOOK_ZONE } from '../edit/shotplan.mjs';
import { loadFontFace } from './fontmetrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_FONTS = join(HERE, '..', '..', 'assets', 'fonts');
const RENDER_FONTS = join(HERE, 'fonts');

export const PLAY = Object.freeze({ width: 1080, height: 1920 });

/** The area text may use in the 1080x1920 frame. Platform buttons and bars sit outside it. */
export const SAFE_ZONE = Object.freeze({ x_min: 90, x_max: 940, y_min: 270, y_max: 1450 });

/** Widest a caption line may be. Centered on the frame it stays inside SAFE_ZONE. */
export const MAX_TEXT_WIDTH =
  2 * Math.min(PLAY.width / 2 - SAFE_ZONE.x_min, SAFE_ZONE.x_max - PLAY.width / 2);

/** Fonts the themes use. `file` is what ffmpeg is given to find the family by name. */
export const FONT_FILES = Object.freeze({
  montserrat: { family: 'Montserrat ExtraBold', file: join(RENDER_FONTS, 'Montserrat-ExtraBold.ttf') },
  anton: { family: 'Anton', file: join(ASSET_FONTS, 'Anton-Regular.ttf') },
  inter: { family: 'Inter SemiBold', file: join(RENDER_FONTS, 'Inter-SemiBold.ttf') },
  serif: { family: 'Instrument Serif', file: join(ASSET_FONTS, 'InstrumentSerif-Regular.ttf') },
  mono: { family: 'IBM Plex Mono', file: join(ASSET_FONTS, 'IBMPlexMono-Regular.ttf') },
});

/**
 * @typedef {object} ThemeStyle
 * @property {keyof typeof FONT_FILES} font
 * @property {number} size            Font size in frame pixels (48 to 75 for body text, larger for single words).
 * @property {number} outline         Stroke width, or box padding when `box` is set.
 * @property {number} shadow
 * @property {'karaoke'|'pill'|'one'|'phrase'} mode
 * @property {number} lines           Most lines a cue may use.
 * @property {boolean} [upper]
 * @property {boolean} [box]          Draw a solid box behind the line.
 * @property {number} [box_alpha]     0 opaque to 255 clear.
 * @property {string} [text]          Text color, "#RRGGBB".
 * @property {string} [stroke]        Outline color.
 * @property {number} [spacing]       Letter spacing in pixels.
 */

/** @type {Readonly<Record<string, ThemeStyle>>} */
export const THEME_STYLES = Object.freeze({
  'karaoke-highlight': { font: 'montserrat', size: 66, outline: 5, shadow: 2, mode: 'karaoke', lines: 1 },
  'karaoke-pill': { font: 'montserrat', size: 62, outline: 4, shadow: 0, mode: 'pill', lines: 1 },
  'one-word-pop': { font: 'montserrat', size: 112, outline: 7, shadow: 3, mode: 'one', lines: 1 },
  'bold-stroke': {
    font: 'anton',
    size: 86,
    outline: 7,
    shadow: 0,
    mode: 'karaoke',
    lines: 1,
    upper: true,
    spacing: 1,
  },
  'clean-minimal': { font: 'inter', size: 56, outline: 3, shadow: 2, mode: 'phrase', lines: 2 },
  'editorial-serif': { font: 'serif', size: 68, outline: 2, shadow: 3, mode: 'phrase', lines: 2 },
  'box-caption': {
    font: 'inter',
    size: 54,
    outline: 16,
    shadow: 0,
    mode: 'phrase',
    lines: 2,
    box: true,
    box_alpha: 70,
    stroke: '#000000',
  },
  'mono-terminal': {
    font: 'mono',
    size: 50,
    outline: 16,
    shadow: 0,
    mode: 'phrase',
    lines: 2,
    box: true,
    box_alpha: 40,
    stroke: '#0B1410',
    text: '#D7FFE0',
  },
});

export const HOOK_STYLE = Object.freeze({
  font: /** @type {const} */ ('anton'),
  max_size: 108,
  min_size: 64,
  max_lines: 3,
  padding: 20,
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * "#RRGGBB" to the ASS color "&HAABBGGRR".
 * @param {string} hex
 * @param {number} [alpha]  0 opaque to 255 clear.
 */
export function assColor(hex, alpha = 0) {
  const h = hex.replace('#', '').toUpperCase();
  const a = alpha.toString(16).toUpperCase().padStart(2, '0');
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

/** The inline-tag form "&HBBGGRR&". @param {string} hex */
function tagColor(hex) {
  const h = hex.replace('#', '').toUpperCase();
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

/** H:MM:SS.cc @param {number} ms */
export function formatAssTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Remove characters that ASS reads as commands. @param {string} text */
const clean = (text) => text.replace(/[{}\\]/g, '').replace(/[\r\n]+/g, ' ');

/** Words of a caption, without trailing . , ; : (a caption does not need them). @param {string} word */
const tidy = (word) => clean(word).replace(/[.,;:]+$/u, '');

/** Black or white, whichever reads better on this color. @param {string} hex */
export function readableOn(hex) {
  const h = hex.replace('#', '');
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16));
  return lum > 0.35 ? '#111111' : '#FFFFFF';
}

/**
 * Width of one line, with its outline.
 * @param {ThemeStyle} style
 * @param {string} text
 * @param {number} size
 */
function lineWidth(style, text, size) {
  const face = loadFontFace(FONT_FILES[style.font].file);
  return face.width(style.upper ? text.toUpperCase() : text, size, style.spacing ?? 0) + 2 * style.outline;
}

/**
 * Split words into at most `maxLines` lines with the widest line as narrow as possible.
 * @param {string[]} words
 * @param {(line: string) => number} widthOf
 * @param {number} maxLines
 * @returns {string[]}
 */
export function balanceLines(words, widthOf, maxLines) {
  const whole = words.join(' ');
  if (maxLines <= 1 || words.length < 2) return [whole];
  if (widthOf(whole) <= MAX_TEXT_WIDTH) return [whole];
  let best = [whole];
  let bestWidth = Infinity;
  for (let cut = 1; cut < words.length; cut++) {
    const a = words.slice(0, cut).join(' ');
    const b = words.slice(cut).join(' ');
    const w = Math.max(widthOf(a), widthOf(b));
    if (w < bestWidth) {
      bestWidth = w;
      best = [a, b];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Layout of one cue
// ---------------------------------------------------------------------------

/**
 * Size, lines and top position for one cue.
 * @param {ThemeStyle} style
 * @param {string[]} words    Words already tidied.
 * @param {number} anchorY    Where the block would like to start.
 * @returns {{size: number, lines: string[], top: number, height: number, width: number}}
 */
export function layoutCue(style, words, anchorY) {
  const face = loadFontFace(FONT_FILES[style.font].file);
  let size = style.size;
  let lines = balanceLines(words, (l) => lineWidth(style, l, size), style.lines);
  let width = Math.max(...lines.map((l) => lineWidth(style, l, size)));
  if (width > MAX_TEXT_WIDTH) {
    // Shrink to fit, but never below 70% of the theme size; past that the line is split instead.
    const ratio = MAX_TEXT_WIDTH / width;
    size = Math.max(Math.floor(style.size * 0.7), Math.floor(size * ratio));
    lines = balanceLines(words, (l) => lineWidth(style, l, size), style.lines);
    width = Math.max(...lines.map((l) => lineWidth(style, l, size)));
  }
  const lineH = face.line_height(size);
  const pad = style.box ? style.outline : 0;
  const height = lines.length * lineH + 2 * pad;
  const top = Math.round(Math.max(SAFE_ZONE.y_min + pad, Math.min(anchorY, SAFE_ZONE.y_max - height)));
  return { size, lines, top, height, width };
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AssOptions
 * @property {'draft'|'final'} [quality]   A draft gets a small "DRAFT" stamp in a corner.
 * @property {{x:number,y:number}|null} [anchor]  Overrides plan.caption_anchor.
 * @property {number} [fallback_y]
 * @property {boolean} [captions]          Set false to leave captions out (hook and screen text only).
 */

/**
 * Style rows for the header.
 * @param {string} name
 * @param {string} family
 * @param {number} size
 * @param {{primary: string, outline: string, back: string, border: 1|3, bord: number, shadow: number, spacing?: number, back_alpha?: number, outline_alpha?: number}} s
 */
function styleRow(name, family, size, s) {
  const outlineAlpha = s.outline_alpha ?? 0;
  return `Style: ${name},${family},${size},${assColor(s.primary)},${assColor(s.primary)},${assColor(s.outline, outlineAlpha)},${assColor(s.back, s.back_alpha ?? 128)},0,0,0,0,100,100,${s.spacing ?? 0},0,${s.border},${s.bord},${s.shadow},8,0,0,0,1`;
}

/**
 * Build the .ass text for a plan.
 * @param {import('../types.mjs').ShotPlan} plan
 * @param {AssOptions} [options]
 * @returns {{text: string, layout: {theme: string, anchor_y: number, top_min: number, bottom_max: number, widest: number, cues: number, hook?: {text: string, size: number, top: number, bottom: number, lines: string[]}}}}
 */
export function buildAss(plan, options = {}) {
  const theme = plan.caption_theme;
  const style = THEME_STYLES[theme];
  if (!style) throw new Error(`Unknown caption theme "${theme}".`);
  const accent = plan.accent || '#FFD93D';
  const anchorY =
    options.anchor?.y ?? plan.caption_anchor?.y ?? options.fallback_y ?? Math.round(0.72 * PLAY.height);
  const font = FONT_FILES[style.font];
  const textColor = style.text ?? '#FFFFFF';
  const strokeColor = style.stroke ?? '#000000';
  const emphasis = new Set(plan.beats.flatMap((b) => b.emphasis_words));

  /** @type {string[]} */
  const styles = [];
  const themeStyleName = 'Cap';
  styles.push(
    styleRow(themeStyleName, font.family, style.size, {
      primary: textColor,
      outline: strokeColor,
      back: '#000000',
      border: style.box ? 3 : 1,
      bord: style.outline,
      shadow: style.shadow,
      spacing: style.spacing,
      back_alpha: style.box ? (style.box_alpha ?? 80) : 140,
      outline_alpha: style.box ? (style.box_alpha ?? 80) : 0,
    }),
  );
  if (style.mode === 'pill') {
    styles.push(
      styleRow('Pill', font.family, style.size, {
        primary: readableOn(accent),
        outline: accent,
        back: '#000000',
        border: 3,
        bord: 14,
        shadow: 0,
        spacing: style.spacing,
      }),
    );
  }
  const hookFont = FONT_FILES[HOOK_STYLE.font];
  const hookInk = readableOn(accent);
  styles.push(
    styleRow('Hook', hookFont.family, HOOK_STYLE.max_size, {
      primary: hookInk,
      outline: accent,
      back: '#000000',
      border: 3,
      bord: HOOK_STYLE.padding,
      shadow: 0,
      back_alpha: 255,
    }),
  );
  styles.push(
    styleRow('Stamp', FONT_FILES.inter.family, 40, {
      primary: '#FFFFFF',
      outline: '#000000',
      back: '#000000',
      border: 1,
      bord: 3,
      shadow: 0,
    }),
  );

  /** @type {string[]} */
  const events = [];
  const ev = (layer, start, end, name, text) =>
    events.push(`Dialogue: ${layer},${formatAssTime(start)},${formatAssTime(end)},${name},,0,0,0,,${text}`);

  const layout = { theme, anchor_y: anchorY, top_min: Infinity, bottom_max: 0, widest: 0, cues: 0 };
  /** @type {{text: string, size: number, top: number, bottom: number, lines: string[]} | undefined} */
  let hookLayout;

  // Captions
  if (options.captions !== false) {
    for (const cue of plan.captions) {
      const raw = cue.text.split(/\s+/).filter(Boolean);
      const idx = cue.word_indexes.length === raw.length ? cue.word_indexes : raw.map(() => -1);
      const words = raw.map(tidy);
      if (words.every((w) => w === '')) continue;
      const lay = layoutCue(
        style,
        words.map((w) => w || ' '),
        anchorY,
      );
      const pos = `{\\an8\\pos(${PLAY.width / 2},${lay.top})\\q2${lay.size !== style.size ? `\\fs${lay.size}` : ''}`;
      const up = (t) => (style.upper ? t.toUpperCase() : t);
      layout.cues += 1;
      layout.top_min = Math.min(layout.top_min, lay.top);
      layout.bottom_max = Math.max(layout.bottom_max, lay.top + lay.height);
      layout.widest = Math.max(layout.widest, lay.width);

      /** Build lines with per-word color. @param {(wordPos: number) => string} colorFor */
      const body = (colorFor) => {
        let k = 0;
        return lay.lines
          .map((line) =>
            line
              .split(' ')
              .map((w) => {
                const color = colorFor(k);
                k += 1;
                return `{\\1c${tagColor(color)}}${up(clean(w))}`;
              })
              .join(' '),
          )
          .join('\\N');
      };

      if (style.mode === 'karaoke') {
        const active = cue.active_word ?? -1;
        ev(
          0,
          cue.start_ms,
          cue.end_ms,
          themeStyleName,
          `${pos}}${body((k) => (k === active ? accent : textColor))}`,
        );
      } else if (style.mode === 'pill') {
        const active = cue.active_word ?? -1;
        ev(0, cue.start_ms, cue.end_ms, themeStyleName, `${pos}}${body(() => textColor)}`);
        if (active >= 0) {
          // Second layer: only the active word shows, on a box in the accent color.
          let k = 0;
          const hidden = '{\\alpha&HFF&\\3a&HFF&\\4a&HFF&}';
          const shown = '{\\alpha&H00&\\3a&H00&}';
          const text = lay.lines
            .map((line) =>
              line
                .split(' ')
                .map((w) => {
                  const on = k === active;
                  k += 1;
                  return `${on ? shown : hidden}${clean(w)}`;
                })
                .join(`${hidden} `),
            )
            .join('\\N');
          ev(1, cue.start_ms, cue.end_ms, 'Pill', `${pos}}${text}`);
        }
      } else if (style.mode === 'one') {
        const wordColor = idx[0] >= 0 && emphasis.has(idx[0]) ? accent : textColor;
        const pop = '\\fscx82\\fscy82\\t(0,110,\\fscx112\\fscy112)\\t(110,190,\\fscx100\\fscy100)';
        ev(
          0,
          cue.start_ms,
          cue.end_ms,
          themeStyleName,
          `${pos}${pop}}{\\1c${tagColor(wordColor)}}${up(clean(lay.lines[0]))}`,
        );
      } else {
        // phrase: emphasized words in the accent color
        let k = 0;
        const text = lay.lines
          .map((line) =>
            line
              .split(' ')
              .map((w) => {
                const gi = idx[k];
                k += 1;
                const hot = gi >= 0 && emphasis.has(gi);
                return `{\\1c${tagColor(hot ? accent : textColor)}}${up(clean(w))}`;
              })
              .join(' '),
          )
          .join('\\N');
        ev(0, cue.start_ms, cue.end_ms, themeStyleName, `${pos}}${text}`);
      }
    }
  }

  // Hook card (first two seconds) and any other on-screen text from the plan.
  const first = plan.beats[0];
  const hookText =
    first?.treatment === 'hook-card' ? (first.screen_text ?? plan.hook?.text ?? '').trim() : '';
  const placeScreenText = (text, start, end) => {
    const face = loadFontFace(hookFont.file);
    const words = clean(text).toUpperCase().split(/\s+/).filter(Boolean);
    let size = HOOK_STYLE.max_size;
    /** @type {string[]} */
    let lines = [];
    for (; size >= HOOK_STYLE.min_size; size -= 4) {
      const widthOf = (l) => face.width(l, size, 1) + 2 * HOOK_STYLE.padding;
      lines = greedyLines(words, widthOf, MAX_TEXT_WIDTH);
      const height = lines.length * face.line_height(size) + 2 * HOOK_STYLE.padding;
      if (lines.length <= HOOK_STYLE.max_lines && height <= HOOK_ZONE.y_max - HOOK_ZONE.y_min) break;
    }
    const top = HOOK_ZONE.y_min + HOOK_STYLE.padding;
    const height = lines.length * face.line_height(size) + 2 * HOOK_STYLE.padding;
    ev(
      2,
      start,
      end,
      'Hook',
      `{\\an8\\pos(${PLAY.width / 2},${top})\\q2\\fs${size}\\fsp1\\fad(120,160)}${lines.join('\\N')}`,
    );
    return { text, size, top, bottom: top + height, lines };
  };
  if (hookText) hookLayout = placeScreenText(hookText, 0, Math.min(HOOK_CARD_MS, plan.duration_ms));
  for (const [i, beat] of plan.beats.entries()) {
    if (i === 0 && hookText) continue;
    const text = beat.screen_text?.trim();
    if (!text || beat.treatment === 'hook-card') continue;
    const start = Math.max(beat.out_start_ms, hookText ? HOOK_CARD_MS : 0);
    const end = Math.min(beat.out_end_ms, start + 2500);
    if (end - start >= 400) placeScreenText(text, start, end);
  }

  if (options.quality === 'draft')
    ev(3, 0, plan.duration_ms, 'Stamp', `{\\an7\\pos(36,36)\\alpha&H60&}DRAFT`);

  if (!Number.isFinite(layout.top_min)) layout.top_min = anchorY;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${PLAY.width}`,
    `PlayResY: ${PLAY.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  return {
    text: [...header, ...events, ''].join('\n'),
    layout: { ...layout, ...(hookLayout ? { hook: hookLayout } : {}) },
  };
}

/**
 * Greedy line wrap.
 * @param {string[]} words
 * @param {(line: string) => number} widthOf
 * @param {number} max
 */
function greedyLines(words, widthOf, max) {
  /** @type {string[]} */
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && widthOf(next) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The font files the render needs next to the .ass file. */
export function fontFilesFor() {
  return [...new Set(Object.values(FONT_FILES).map((f) => f.file))];
}
