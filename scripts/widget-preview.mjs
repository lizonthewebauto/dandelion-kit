#!/usr/bin/env node
// Card preview harness. Writes one HTML page per card (with sample data and a fake host) so the cards
// can be looked at in any browser without the real server.
//
//   node scripts/widget-preview.mjs --out <folder>
//
// Each page is a small fake MCP Apps host: it embeds the real card in an iframe, answers ui/initialize,
// sends the sample tool result, and answers tools/call from the sample kit in server/widgets/fixtures.mjs
// (including read_asset, so pictures and video load through the same chunk path as the real thing).
// Open <name>.html?theme=dark for dark, &w=360 for a phone width, &log=1 to see what the card told the model,
// &h=1800 to force a tall frame for screenshot tools that capture early.
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { WIDGETS, widgetHtml } from '../server/widgets/registry.mjs';
import { scriptJson } from '../server/widgets/page.mjs';
import { CARD_FIXTURES, DEMO_ASSETS, CAROUSEL } from '../server/widgets/fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = resolve(arg('out') || join(tmpdir(), 'dandelion-kit-widgets'));

/** @param {string} s */
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A made-up frame of a person talking: soft background, head, shoulders, and a caption pill.
 * @param {number} w @param {number} h @param {number} hue @param {string} caption
 */
function frameSvg(w, h, hue, caption) {
  const cx = w / 2;
  const headR = w * 0.17;
  const headY = h * 0.36;
  const font = Math.max(10, Math.round(w * 0.075));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,30%)"/><stop offset="1" stop-color="hsl(${hue + 20},40%,16%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<ellipse cx="${cx}" cy="${h * 0.78}" rx="${w * 0.36}" ry="${h * 0.2}" fill="hsl(${hue},25%,45%)"/>
<circle cx="${cx}" cy="${headY}" r="${headR}" fill="hsl(${hue - 10},55%,72%)"/>
<rect x="${cx - w * 0.38}" y="${h * 0.62}" width="${w * 0.76}" height="${font * 2.2}" rx="${font * 0.6}" fill="rgba(0,0,0,0.55)"/>
<text x="${cx}" y="${h * 0.62 + font * 1.5}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${font}" fill="#fff">${xml(caption)}</text>
</svg>`;
}

/**
 * A wide caption sample for a look.
 * @param {string} look @param {number} hue
 */
function sampleSvg(look, hue) {
  const w = 640, h = 280;
  const accents = { 'karaoke-clean': '#FFD93D', 'bold-value': '#FF8A3D', 'minimal-educator': '#3DB8FF', 'editorial-luxe': '#E8C9A0', 'storytime-energy': '#FF5C7A' };
  const accent = /** @type {Record<string,string>} */ (accents)[look] || '#FFD93D';
  const serif = look === 'editorial-luxe';
  const font = serif ? 'Georgia, serif' : 'Arial, Helvetica, sans-serif';
  const words = look === 'storytime-energy' ? ['KEY'] : ['This is', 'the key'];
  const big = look === 'bold-value' || look === 'storytime-energy';
  const size = big ? 64 : look === 'minimal-educator' ? 34 : 44;
  const weight = look === 'minimal-educator' ? 600 : 800;
  const stroke = look === 'bold-value' ? 'stroke="#000" stroke-width="6" paint-order="stroke"' : '';
  const line1 = words.length === 1 ? '' : `<text x="320" y="130" text-anchor="middle" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="#fff" ${stroke}>${xml(words[0])}</text>`;
  const line2 = `<text x="320" y="${words.length === 1 ? 150 : 190}" text-anchor="middle" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${accent}" ${stroke}>${xml(words[words.length - 1])}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},40%,28%)"/><stop offset="1" stop-color="hsl(${hue + 30},38%,14%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="520" cy="70" r="46" fill="hsl(${hue - 10},50%,70%)" opacity="0.5"/>
${look === 'karaoke-clean' ? '<rect x="150" y="150" width="340" height="68" rx="14" fill="rgba(0,0,0,0.35)"/>' : ''}
${line1}${line2}
</svg>`;
}

/**
 * A carousel slide made from its sample fields.
 * @param {number} i @param {number} w @param {number} h
 */
function slideSvg(i, w, h) {
  const spec = CAROUSEL.slides[i];
  const f = spec.fields || {};
  const title = String(f.title || f.quote || f.number || f.myth || '');
  const sub = String(f.subtitle || f.label || f.who || f.line || (Array.isArray(f.items) ? f.items.join(', ') : '') || (Array.isArray(f.steps) ? f.steps.map((/** @type {any} */ s) => s.text).join(', ') : ''));
  /** @param {string} t @param {number} n */
  const wrap = (t, n) => {
    const out = [];
    let line = '';
    for (const word of t.split(' ')) {
      if ((line + ' ' + word).trim().length > n) { out.push(line.trim()); line = word; } else line += ' ' + word;
    }
    if (line.trim()) out.push(line.trim());
    return out.slice(0, 4);
  };
  const size = Math.round(w * (spec.layout === 'stat' ? 0.24 : 0.085));
  const tl = wrap(title, spec.layout === 'stat' ? 6 : 16).map((t, k) => `<text x="${w * 0.08}" y="${h * 0.3 + k * size * 1.15}" font-family="Georgia, serif" font-weight="700" font-size="${size}" fill="#1F1A14">${xml(t)}</text>`).join('');
  const sl = wrap(sub, 30).map((t, k) => `<text x="${w * 0.08}" y="${h * 0.3 + (tl.length ? 4 : 1) * size * 1.15 + k * size * 0.6}" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.45)}" fill="#6B6254">${xml(t)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="#FBF6EA"/>
<rect x="${w * 0.08}" y="${h * 0.1}" width="${w * 0.14}" height="${h * 0.012}" fill="#E0A100"/>
<text x="${w * 0.08}" y="${h * 0.16}" font-family="Arial, sans-serif" font-weight="700" font-size="${Math.round(size * 0.4)}" fill="#E0A100">${i + 1} / 6</text>
${tl}${sl}
<text x="${w * 0.08}" y="${h * 0.93}" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.4)}" fill="#6B6254">@morningmethod</text>
</svg>`;
}

/** @param {string} name */
async function makeAsset(name) {
  const a = DEMO_ASSETS.find((x) => x.id === name);
  if (!a) throw new Error(`unknown asset ${name}`);
  if (a.kind === 'mp4') return null;
  const w = a.w || 200, h = a.h || 200;
  let svg;
  if (a.id.startsWith('a_sample_')) svg = sampleSvg(a.id.slice('a_sample_'.length), a.hue || 40);
  else if (a.id.startsWith('a_slide_') || a.id.startsWith('a_thumb_')) svg = slideSvg(Number(a.id.split('_')[2]) - 1, w, h);
  else svg = frameSvg(w, h, a.hue || 40, a.id === 'a_poster' ? 'Stop scrolling' : 'the key');
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return { mime: 'image/jpeg', b64: buf.toString('base64') };
}

/** @param {string} dir */
function makeVideo(dir) {
  const file = join(dir, 'demo.mp4');
  const r = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=15:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '32k', '-t', '4', '-movflags', '+faststart', file,
  ]);
  if (r.status !== 0) return null;
  return { mime: 'video/mp4', b64: readFileSync(file).toString('base64') };
}

/** The fixtures module as plain script text (no export keywords), so a file:// page can run it. */
function fixturesAsScript() {
  const src = readFileSync(join(ROOT, 'server', 'widgets', 'fixtures.mjs'), 'utf8').replace(/\r\n/g, '\n');
  return src.replace(/^export /gm, '');
}

const HOST_SCRIPT = String.raw`
(function () {
  var q = new URLSearchParams(location.search);
  var theme = q.get("theme") === "dark" ? "dark" : "light";
  var width = q.get("w") || "";
  var showLog = q.get("log") === "1";
  document.documentElement.setAttribute("data-host", theme);
  var frame = document.getElementById("card");
  if (width && width !== "full") frame.style.width = width + "px";
  if (q.get("h")) frame.style.minHeight = q.get("h") + "px"; // for screenshot tools that capture before the card reports its height
  var logEl = document.getElementById("log");
  logEl.hidden = !showLog;
  function log(line) { var p = document.createElement("div"); p.textContent = line; logEl.appendChild(p); }

  var STATE = newDemoState(window.__SEED__);
  var assets = window.__ASSETS__;
  var bytesCache = {};
  function bytesOf(id) {
    if (bytesCache[id]) return bytesCache[id];
    var a = assets[id] || assets.a_video_draft_fallback;
    if (!a) return null;
    var bin = atob(a.b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    bytesCache[id] = { u8: u8, mime: a.mime };
    return bytesCache[id];
  }
  function b64of(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 3000) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 3000)));
    return btoa(s);
  }
  var win = function () { return frame.contentWindow; };
  function send(msg) { win().postMessage(msg, "*"); }
  function reply(id, result) { send({ jsonrpc: "2.0", id: id, result: result }); }
  function fail(id, message) { send({ jsonrpc: "2.0", id: id, error: { code: -32000, message: message } }); }

  window.addEventListener("message", function (ev) {
    if (ev.source !== win()) return;
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === "ui/initialize") {
      reply(m.id, {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "kit-preview-host", version: "1.0.0" },
        hostCapabilities: { updateModelContext: { text: {} }, openLinks: {}, serverTools: {} },
        hostContext: { theme: theme, timeZone: "America/New_York", locale: "en-US", displayMode: "inline", platform: "web" }
      });
      return;
    }
    if (m.method === "ui/notifications/initialized") {
      send({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } });
      send({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: window.__TITLE__ }], structuredContent: window.__SEED__ } });
      return;
    }
    if (m.method === "ui/notifications/size-changed") {
      frame.style.height = Math.max(120, m.params.height) + "px";
      return;
    }
    if (m.method === "ui/open-link") { log("open-link: " + m.params.url); reply(m.id, {}); return; }
    if (m.method === "ui/update-model-context") { log("tell-model: " + m.params.content[0].text.split("\n").pop()); reply(m.id, {}); return; }
    if (m.method === "tools/call") {
      var name = m.params.name, args = m.params.arguments || {};
      if (name === "read_asset") {
        var b = bytesOf(args.asset_id);
        if (!b) { reply(m.id, { isError: true, content: [{ type: "text", text: "No such file." }] }); return; }
        var off = args.offset || 0, n = Math.min(args.bytes || 200000, 200000);
        var slice = b.u8.subarray(off, off + n);
        reply(m.id, { content: [{ type: "text", text: "chunk" }], structuredContent: { data: b64of(slice), mime: b.mime, total: b.u8.length, has_more: off + n < b.u8.length } });
        return;
      }
      log("tool: " + name + " " + JSON.stringify(args).slice(0, 160));
      var delay = name === "render_reel" ? 1500 : STATE.delayMs;
      setTimeout(function () { reply(m.id, demoTool(name, args, STATE)); }, delay);
      return;
    }
    if (m.id !== undefined && m.method) reply(m.id, {});
  });

  document.getElementById("t-light").href = "?theme=light" + (width ? "&w=" + width : "") + (showLog ? "&log=1" : "");
  document.getElementById("t-dark").href = "?theme=dark" + (width ? "&w=" + width : "") + (showLog ? "&log=1" : "");
  document.getElementById("t-360").href = "?theme=" + theme + "&w=360" + (showLog ? "&log=1" : "");
  document.getElementById("t-full").href = "?theme=" + theme + "&w=full" + (showLog ? "&log=1" : "");
  frame.srcdoc = JSON.parse(document.getElementById("card-html").textContent);
})();
`;

/**
 * @param {{ file: string, widget: string, title: string, data: any }} fx
 * @param {Record<string, { mime: string, b64: string }>} assets
 */
function hostPage(fx, assets) {
  const widget = WIDGETS.find((w) => w.id === fx.widget);
  if (!widget) throw new Error(`no widget ${fx.widget}`);
  const html = widgetHtml(widget);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xml(fx.file)} (preview host)</title>
<style>
  body { margin: 0; font: 13px system-ui, sans-serif; background: #ffffff; color: #211911; }
  html[data-host="dark"] body { background: #1b1b1f; color: #f5f2e9; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #8884; }
  .bar a { color: inherit; }
  .bar b { margin-right: 8px; }
  .wrap { padding: 14px 12px 24px; }
  iframe { display: block; border: 0; width: 100%; max-width: 640px; height: 200px; background: transparent; color-scheme: normal; }
  #log { margin: 12px; padding: 8px; font: 12px ui-monospace, Consolas, monospace; border: 1px dashed #8886; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="bar"><b>${xml(fx.title)}</b>
  <a id="t-light" href="#">Light</a> <a id="t-dark" href="#">Dark</a> <a id="t-360" href="#">360 px</a> <a id="t-full" href="#">Full width</a>
  <a href="index.html">All cards</a></div>
<div class="wrap"><iframe id="card" title="Card" sandbox="allow-scripts allow-same-origin"></iframe></div>
<div id="log" hidden></div>
<script type="application/json" id="card-html">${scriptJson(html)}</script>
<script>window.__SEED__ = ${scriptJson(fx.data)}; window.__TITLE__ = ${scriptJson(fx.title)}; window.__ASSETS__ = ${scriptJson(assets)};</script>
<script>${fixturesAsScript()}</script>
<script>${HOST_SCRIPT}</script>
</body>
</html>`;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const assets = /** @type {Record<string, { mime: string, b64: string }>} */ ({});
  for (const a of DEMO_ASSETS) {
    const made = await makeAsset(a.id);
    if (made) assets[a.id] = made;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'kit-video-'));
  const video = makeVideo(tmp);
  if (video) {
    assets.a_video_draft = video;
    assets.a_video_final = video;
  } else {
    console.error('ffmpeg is not available, so the video preview will show its error state.');
  }
  for (const fx of CARD_FIXTURES) writeFileSync(join(outDir, `${fx.file}.html`), hostPage(fx, assets));
  const rows = CARD_FIXTURES.map((fx) => `<li><b>${xml(fx.title)}</b> <a href="${fx.file}.html?theme=light">light</a> <a href="${fx.file}.html?theme=dark">dark</a> <a href="${fx.file}.html?theme=light&w=360">light 360</a> <a href="${fx.file}.html?theme=dark&w=360">dark 360</a></li>`).join('\n');
  writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Kit card previews</title><body style="font:15px system-ui;margin:24px;line-height:1.9"><h1>Kit card previews</h1><ul>${rows}</ul></body>`);
  console.log(`Wrote ${CARD_FIXTURES.length} card pages to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
