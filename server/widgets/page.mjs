// Builds a self-contained card page: inline styles, the window.DK runtime, all eight views and a boot line.
// No network is used: system fonts only, pictures and video arrive as data: URLs through read_asset.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL_IDS, WIDGET_IDS } from '../../core/types.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

/** The one address cards may mention: Dandelion's site (links are opened by the host, never fetched by the card). */
export const APP_URL = 'https://dandelionapp.io';

/** Names and a decorative dot color for each app. The words always carry the meaning. */
export const CHANNEL_INFO = Object.freeze({
  instagram: { n: 'Instagram', c: '#E1306C' },
  tiktok: { n: 'TikTok', c: '#25F4EE' },
  youtube: { n: 'YouTube', c: '#FF0000' },
  linkedin: { n: 'LinkedIn', c: '#0A66C2' },
  x: { n: 'X', c: '#8A8A8A' },
  threads: { n: 'Threads', c: '#B5B5B5' },
  facebook: { n: 'Facebook', c: '#1877F2' },
  pinterest: { n: 'Pinterest', c: '#E60023' },
});

/** @type {Map<string, string>} */
const files = new Map();
/** @param {string} name */
function read(name) {
  let text = files.get(name);
  if (text === undefined) {
    text = readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
    files.set(name, text);
  }
  return text;
}

/** The runtime script (window.DK). */
export const runtimeSource = () => read('runtime.js');
/** The card styles. */
export const styleSource = () => read('style.css');
/** The script of one view, by widget id. @param {string} id */
export const viewSource = (id) => read(`${id}.js`);

/**
 * JSON that is safe inside a script tag (no closing tag, no comment opener).
 * @param {unknown} value
 */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One card page. Every page carries all eight views so a tap can move to the next step inside the same card;
 * widgetId says which view the host's first tool result belongs to.
 * @param {{ title: string, widgetId: string, extraHead?: string, extraBody?: string }} input
 */
export function widgetPage(input) {
  const data = { appUrl: APP_URL, platforms: CHANNEL_INFO, channels: CHANNEL_IDS };
  const views = WIDGET_IDS.map((id) => `<script>${viewSource(id)}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(input.title)}</title>
<style>${styleSource()}</style>${input.extraHead ?? ''}
</head>
<body>
<main id="app" aria-live="polite"></main>
<script type="application/json" id="dk-data">${scriptJson(data)}</script>
<script>${runtimeSource()}</script>
${views}
<script>window.DK.boot(${scriptJson(input.widgetId)}, ${scriptJson(`Dandelion Kit: ${input.title}`)});</script>${input.extraBody ?? ''}
</body>
</html>`;
}
