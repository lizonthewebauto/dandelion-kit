import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { APP_ONLY_TOOLS, TOOL_NAMES, WIDGET_IDS } from '../core/types.mjs';
import { WIDGETS, TOOL_WIDGETS, registerWidgets, toolWidgetUri, widgetHtml, widgetResourceMeta, withWidgetMeta } from '../server/widgets/registry.mjs';
import { APP_URL, runtimeSource, styleSource, viewSource } from '../server/widgets/page.mjs';
import { CARD_TOOL_CALLS } from '../server/widgets/contracts.mjs';
import { CARD_FIXTURES, DEMO_ASSETS, demoTool, newDemoState } from '../server/widgets/fixtures.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'widgets');
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const TICK = String.fromCharCode(96);

/** @param {string} html */
const scriptsOf = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
/** @param {string} src */
const callsIn = (src) => [...new Set([...src.matchAll(/DK\.call\(\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
/** @param {string} src */
const viewToolsIn = (src) => {
  const m = /DK\.view\(\s*"([a-z-]+)"\s*,\s*\{\s*tools:\s*\[([^\]]*)\]/.exec(src);
  return m ? { id: m[1], tools: [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort() } : null;
};

// ---------------------------------------------------------------------------
// the registry
// ---------------------------------------------------------------------------

test('eight widgets, one per id, with versioned ui:// uris', () => {
  assert.deepEqual(WIDGETS.map((w) => w.id), [...WIDGET_IDS]);
  assert.equal(new Set(WIDGETS.map((w) => w.uri)).size, 8);
  for (const w of WIDGETS) {
    assert.match(w.uri, /^ui:\/\/dandelion-kit\/v\d+\/[a-z-]+\.html$/);
    assert.equal(w.uri.endsWith(`/${w.id}.html`), true);
    assert.ok(w.title && w.description);
  }
});

test('the tool to card map only names real tools and real cards, and every card has a tool', () => {
  for (const [tool, id] of Object.entries(TOOL_WIDGETS)) {
    assert.ok(TOOL_NAMES.includes(tool), `unknown tool ${tool}`);
    assert.ok(WIDGET_IDS.includes(id), `unknown card ${id}`);
    assert.equal(toolWidgetUri(tool)?.endsWith(`/${id}.html`), true);
  }
  for (const id of WIDGET_IDS) assert.ok(Object.values(TOOL_WIDGETS).includes(id), `${id} has no tool`);
});

test('withWidgetMeta adds the card uri, and app-only visibility for the tools only cards call', () => {
  const doctor = withWidgetMeta('doctor', { description: 'x' });
  assert.equal(doctor._meta.ui.resourceUri, toolWidgetUri('doctor'));
  assert.equal(doctor._meta['ui/resourceUri'], toolWidgetUri('doctor'));
  assert.equal(doctor._meta.ui.visibility, undefined);
  for (const tool of APP_ONLY_TOOLS) assert.deepEqual(withWidgetMeta(tool, {})._meta.ui.visibility, ['app'], tool);
  assert.deepEqual(withWidgetMeta('update_cut', { _meta: { ui: { visibility: ['model', 'app'] } } })._meta.ui.visibility, ['model', 'app']);
  const plain = { description: 'no card' };
  assert.equal(withWidgetMeta('list_projects', plain), plain);
  assert.equal(withWidgetMeta('approve_post', plain), plain);
});

test('CSP: no network of our own, no extra domains', () => {
  const meta = widgetResourceMeta();
  assert.deepEqual(meta.ui.csp.connectDomains, []);
  assert.deepEqual(meta.ui.csp.resourceDomains, []);
  assert.equal(meta.ui.prefersBorder, false);
});

test('registerWidgets serves all eight resources and patches registerTool', async () => {
  const server = new McpServer({ name: 'kit-test', version: '0.0.0' });
  registerWidgets(server);
  server.registerTool('doctor', { description: 'Check the kit.' }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  server.registerTool('read_asset', { description: 'Read a file.' }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  server.registerTool('open_path', { description: 'Show a file.' }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const { resources } = await client.listResources();
    assert.equal(resources.length, 8);
    for (const r of resources) assert.equal(r.mimeType, 'text/html;profile=mcp-app');
    const read = await client.readResource({ uri: WIDGETS[7].uri });
    assert.equal(read.contents.length, 1);
    const c = /** @type {any} */ (read.contents[0]);
    assert.equal(c.mimeType, 'text/html;profile=mcp-app');
    assert.ok(String(c.text).startsWith('<!doctype html>'));
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, /** @type {any} */ (t)._meta]));
    assert.equal(by.doctor.ui.resourceUri, toolWidgetUri('doctor'));
    assert.deepEqual(by.read_asset.ui.visibility, ['app']);
    assert.equal(by.open_path, undefined);
  } finally {
    await client.close();
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// the pages
// ---------------------------------------------------------------------------

for (const w of WIDGETS) {
  test(`${w.id}: self-contained HTML that obeys the card rules`, () => {
    const html = widgetHtml(w);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
    assert.doesNotMatch(html, /<iframe\b|<link\b|<img\b[^>]*\bsrc="http|@import|url\(\s*["']?https?:/i);
    assert.doesNotMatch(html, /\bimport\s*\(/);
    const scripts = scriptsOf(html);
    assert.equal(scripts.length, 11, 'data block, runtime, eight views, boot');
    const data = scripts.find((s) => s.attrs.includes('application/json'));
    const parsed = JSON.parse(String(data?.body));
    assert.equal(parsed.appUrl, APP_URL);
    assert.equal(Object.keys(parsed.platforms).length, 8);
    for (const s of scripts.filter((x) => !x.attrs.includes('application/json'))) {
      assert.doesNotThrow(() => new Script(s.body));
      assert.doesNotMatch(s.body, /<\/script/i);
      assert.equal(s.body.includes(TICK), false, 'no backticks in card scripts');
      assert.doesNotMatch(s.body, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
      assert.doesNotMatch(s.body, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
    }
    assert.ok(html.includes(`window.DK.boot("${w.id}"`));
    assert.equal(html.includes(EM), false);
    assert.equal(html.includes(EN), false);
    // the only addresses in the page: the SVG namespace and Dandelion's site
    for (const m of html.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) assert.ok(['http://www.w3.org', APP_URL].includes(m[0]), `unexpected address ${m[0]}`);
  });
}

test('runtime and card scripts and styles have no dashes, no backticks, no innerHTML', () => {
  const sources = [runtimeSource(), styleSource(), ...WIDGET_IDS.map(viewSource)];
  for (const s of sources) {
    assert.equal(s.includes(EM) || s.includes(EN), false);
  }
  for (const s of [runtimeSource(), ...WIDGET_IDS.map(viewSource)]) {
    assert.equal(s.includes(TICK), false);
    assert.doesNotMatch(s, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/);
  }
});

test('every card calls only real tools, and exactly the tools the contract lists', () => {
  for (const id of WIDGET_IDS) {
    const calls = callsIn(viewSource(id));
    for (const t of calls) assert.ok(TOOL_NAMES.includes(t), `${id} calls unknown tool ${t}`);
    assert.deepEqual(calls, [...CARD_TOOL_CALLS[id]].sort(), `${id} tool calls`);
  }
  assert.deepEqual(callsIn(runtimeSource()), ['read_asset']);
});

test('each view registers for the tools that TOOL_WIDGETS points at it', () => {
  for (const id of WIDGET_IDS) {
    const v = viewToolsIn(viewSource(id));
    assert.ok(v, `${id} registers a view`);
    assert.equal(v.id, id);
    const expected = Object.entries(TOOL_WIDGETS).filter(([, w]) => w === id).map(([t]) => t).sort();
    assert.deepEqual(v.tools, expected, `${id} tools`);
  }
});

test('every action tells the model what the person tapped', () => {
  for (const id of WIDGET_IDS) {
    const src = viewSource(id);
    const calls = (src.match(/DK\.call\(/g) || []).length;
    const tells = (src.match(/DK\.tellModel\(/g) || []).length;
    assert.ok(tells >= 1, `${id} never calls tellModel`);
    assert.ok(tells >= Math.ceil(calls / 4), `${id}: ${calls} calls but only ${tells} tellModel`);
  }
});

test('read_asset chunks are whole base64 groups and under the 200000 byte limit', () => {
  const m = /var CHUNK = (\d+);/.exec(runtimeSource());
  assert.ok(m);
  const n = Number(m[1]);
  assert.equal(n % 3, 0);
  assert.ok(n <= 200000);
  assert.match(runtimeSource(), /DK\.asset = |DK\.video = |DK\.img = /);
  for (const name of ['asset', 'video', 'img']) assert.match(runtimeSource(), new RegExp(`DK\\.${name} = function`));
});

test('post and approve always take two taps, and schedule uses datetime-local with an offset', () => {
  const post = viewSource('kit-post');
  assert.match(post, /DK\.twoTap\(\{[\s\S]*?label: "Approve now"[\s\S]*?onConfirm: approveNow/);
  assert.match(post, /DK\.twoTap\(\{[\s\S]*?label: "Schedule it"[\s\S]*?onConfirm: function \(\) \{ return schedule\(/);
  // the tools that send things out are only reached through those two confirms
  assert.equal((post.match(/DK\.call\("approve_post"/g) || []).length, 2);
  assert.equal((post.match(/approveNow\(/g) || []).length, 1, 'approveNow is only defined, never called directly');
  assert.match(post, /type: "datetime-local"/);
  assert.match(post, /DK\.zonedIso\(/);
  assert.match(runtimeSource(), /DK\.zonedIso = function/);
  assert.match(runtimeSource(), /DK\.twoTap = function/);
});

// ---------------------------------------------------------------------------
// contrast and layout rules
// ---------------------------------------------------------------------------

/** @param {string} hex */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** @param {string} a @param {string} b */
function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** @param {string} block */
function tokens(block) {
  /** @type {Record<string, string>} */
  const t = {};
  for (const m of block.matchAll(/--dk-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2];
  return t;
}

test('contrast: text is at least 4.5:1 everywhere and 7:1 for body text, light and dark', () => {
  const css = styleSource();
  const light = tokens(/:root\s*\{[\s\S]*?\n\}/.exec(css)?.[0] || '');
  const darkBlock = /:root\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/.exec(css)?.[0] || '';
  const dark = { ...light, ...tokens(darkBlock) };
  const mediaBlock = /@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n\}\n/.exec(css)?.[0] || '';
  const system = { ...light, ...tokens(mediaBlock) };
  for (const [name, t] of [['light', light], ['dark', dark], ['system dark', system]]) {
    const T = /** @type {Record<string, string>} */ (t);
    const need = (/** @type {string} */ a, /** @type {string} */ b, /** @type {number} */ min) => {
      const r = ratio(T[a], T[b]);
      assert.ok(r >= min, `${name}: ${a} on ${b} is ${r.toFixed(2)}, needs ${min}`);
    };
    for (const bg of ['paper', 'raise', 'wash', 'tint-warn', 'tint-bad', 'tint-ok']) need('fg', bg, 7);
    for (const bg of ['paper', 'raise', 'wash']) need('muted', bg, 4.5);
    need('muted', 'paper', 7);
    for (const c of ['danger', 'success', 'warn', 'link']) { need(c, 'paper', 4.5); need(c, 'raise', 4.5); }
    // painted gold buttons keep their ink text in both themes
    for (const g of ['gold-1', 'gold-2', 'gold-3']) need('ink', g, 4.5);
    // non-text edges and focus rings against the page: 3:1
    need('edge', 'paper', 3);
    need('focus', 'paper', 3);
    // colored words on tinted notes stay readable
    need('danger', 'tint-bad', 4.5);
    need('warn', 'tint-warn', 4.5);
    need('success', 'tint-ok', 4.5);
  }
});

test('layout rules: theme from the host, 360 px friendly, system fonts, no remote fonts', () => {
  const css = styleSource();
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /system-ui/);
  assert.doesNotMatch(css, /@font-face|fonts\.googleapis/);
  assert.match(runtimeSource(), /root\.setAttribute\("data-theme"/);
  assert.match(runtimeSource(), /ui\/notifications\/size-changed/);
  assert.match(runtimeSource(), /ui\/update-model-context/);
  assert.match(runtimeSource(), /PROTOCOL = "2026-01-26"/);
});

// ---------------------------------------------------------------------------
// fixtures and the fake kit
// ---------------------------------------------------------------------------

test('fixtures: every asset id they mention exists, and every card has a sample', () => {
  const known = new Set(DEMO_ASSETS.map((a) => a.id));
  for (const fx of CARD_FIXTURES) {
    assert.ok(WIDGET_IDS.includes(fx.widget));
    for (const m of JSON.stringify(fx.data).matchAll(/"(a_[a-z0-9_-]+)"/g)) assert.ok(known.has(m[1]), `${fx.file} mentions unknown asset ${m[1]}`);
  }
  for (const id of WIDGET_IDS) assert.ok(CARD_FIXTURES.some((f) => f.widget === id), `${id} has no sample`);
  // kit-post shows all three states
  const post = CARD_FIXTURES.filter((f) => f.widget === 'kit-post').map((f) => /** @type {any} */ (f.data));
  assert.ok(post.some((d) => d.dandelion && d.dandelion.connected === false && !d.bundle.sent));
  assert.ok(post.some((d) => d.dandelion && d.dandelion.connected && !d.bundle.sent));
  assert.ok(post.some((d) => d.bundle.sent && d.bundle.sent.jobs.length > 0));
});

test('fixtures: every sample has the fields its card reads, with no dashes in the words', () => {
  for (const fx of CARD_FIXTURES) {
    const text = JSON.stringify(fx.data);
    assert.equal(text.includes(EM) || text.includes(EN), false, fx.file);
    assert.ok(text.length < 50_000, `${fx.file} is under 50 KB`);
  }
  const by = (/** @type {string} */ f) => /** @type {any} */ (CARD_FIXTURES.find((x) => x.file === f)?.data);
  assert.ok(by('kit-cut-review').removed.every((/** @type {any} */ s) => s.id && s.kind && typeof s.keep === 'boolean'));
  assert.equal(by('kit-look-picker').looks.length, 5);
  assert.ok(by('kit-shot-plan').beats.length >= 6 && by('kit-shot-plan').hook.candidates.length >= 2);
  assert.ok(by('kit-preview-variants').renders.some((/** @type {any} */ r) => r.axes));
  assert.ok(by('kit-carousel').slides.every((/** @type {any} */ s) => s.layout && s.file && s.asset_id));
  assert.equal(Object.keys(by('kit-post').bundle.channels).length, 8);
});

test('the fake kit answers every tool the cards call (except read_asset, which the host serves)', () => {
  const state = newDemoState();
  const wanted = new Set(Object.values(CARD_TOOL_CALLS).flat());
  wanted.delete('read_asset');
  for (const tool of wanted) {
    const args = { project_id: 'p_demo', bundle_id: 'bundle_demo', channel: 'instagram', copy: { caption: 'Hi' }, job_id: 'j1', brand_id: 'b', mode: 'library', slides: [], beats: [], keep_ids: [], drop_ids: [], path: 'x', kind: 'video', files: [], quality: 'draft' };
    const r = demoTool(tool, args, state);
    assert.ok(r.content[0].text, tool);
    assert.equal(!!r.isError, false, tool);
  }
});

test('the fake kit: update_cut moves the length, update_slides renders again, set_channel_copy checks limits', () => {
  const state = newDemoState();
  const before = state.cut.after_ms;
  const keepAll = state.cut.removed.map((/** @type {any} */ s) => s.id);
  const r = /** @type {any} */ (demoTool('update_cut', { project_id: 'p', keep_ids: keepAll, drop_ids: [] }, state));
  assert.ok(r.structuredContent.after_ms > before);
  const s = /** @type {any} */ (demoTool('update_slides', { project_id: 'p', slides: [{ layout: 'cover', fields: { title: 'x' } }] }, state));
  assert.equal(s.structuredContent.slides.length, 1);
  const bad = demoTool('set_channel_copy', { bundle_id: 'b', channel: 'x', copy: { caption: 'y'.repeat(400) } }, state);
  assert.equal(bad.isError, true);
});
