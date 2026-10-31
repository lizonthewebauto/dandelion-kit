// ui:// resources for the eight kit cards, the tool to card map, and the CSP meta.
// server/index.mjs calls registerWidgets(server) once, before it registers any tool.
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { APP_ONLY_TOOLS } from '../../core/types.mjs';
import { widgetPage } from './page.mjs';

/**
 * @typedef {object} WidgetDef
 * @property {string} id
 * @property {string} uri       Bump the version in the URI when a change must not use a host's cached copy.
 * @property {string} title
 * @property {string} description
 */

/** @type {readonly WidgetDef[]} */
export const WIDGETS = Object.freeze([
  { id: 'kit-project', uri: 'ui://dandelion-kit/v1/kit-project.html', title: 'Video project', description: 'Where a video project stands and the next step: transcript, rough cut, look, shot plan, draft and final. Also the kit check.' },
  { id: 'kit-cut-review', uri: 'ui://dandelion-kit/v1/kit-cut-review.html', title: 'Rough cut', description: 'Before and after length, and every piece the rough cut would remove, with a switch to keep each one.' },
  { id: 'kit-look-picker', uri: 'ui://dandelion-kit/v1/kit-look-picker.html', title: 'Pick a look', description: 'Five looks with a caption sample, an accent color and a caption style.' },
  { id: 'kit-shot-plan', uri: 'ui://dandelion-kit/v1/kit-shot-plan.html', title: 'Shot plan', description: 'The hook with scored choices, then each beat with how it is shown and its on-screen text.' },
  { id: 'kit-preview', uri: 'ui://dandelion-kit/v1/kit-preview.html', title: 'Reel preview', description: 'Plays the draft or final reel with 8 frames, every check, variant tabs, and buttons to render, vary or post.' },
  { id: 'kit-carousel', uri: 'ui://dandelion-kit/v1/kit-carousel.html', title: 'Carousel and images', description: 'Slide strip, a fields editor for the chosen slide, layout picker and brand colors.' },
  { id: 'kit-export', uri: 'ui://dandelion-kit/v1/kit-export.html', title: 'Exported files', description: 'The files that were written, with Open folder and Post with Dandelion.' },
  { id: 'kit-post', uri: 'ui://dandelion-kit/v1/kit-post.html', title: 'Post with Dandelion', description: 'A version for each app with limit meters, connect Dandelion, send, then approve, schedule or skip each post.' },
]);

/**
 * Which tool shows which card. Hosts without cards ignore this and use the text.
 * @type {Readonly<Record<string, string>>}
 */
export const TOOL_WIDGETS = Object.freeze({
  doctor: 'kit-project',
  open_video: 'kit-project',
  get_project: 'kit-project',
  rough_cut: 'kit-cut-review',
  update_cut: 'kit-cut-review',
  pick_look: 'kit-look-picker',
  plan_shots: 'kit-shot-plan',
  update_shot_plan: 'kit-shot-plan',
  render_reel: 'kit-preview',
  check_reel: 'kit-preview',
  make_variants: 'kit-preview',
  make_carousel: 'kit-carousel',
  make_image: 'kit-carousel',
  update_slides: 'kit-carousel',
  export: 'kit-export',
  offer_post: 'kit-post',
  set_channel_copy: 'kit-post',
  connect_dandelion: 'kit-post',
  dandelion_status: 'kit-post',
  send_to_dandelion: 'kit-post',
});

/** @param {string} id */
export function widgetById(id) {
  return WIDGETS.find((w) => w.id === id);
}

/**
 * The ui:// resource a tool shows, if any.
 * @param {string} tool
 */
export function toolWidgetUri(tool) {
  const id = TOOL_WIDGETS[tool];
  return id ? widgetById(id)?.uri : undefined;
}

/**
 * The resource's _meta.ui. The cards make no network calls of their own (every action is a tool call through the host,
 * pictures and video arrive as data: URLs), so both lists stay empty and the host's default CSP applies.
 * prefersBorder is false because each card draws its own Marigold card.
 */
export function widgetResourceMeta() {
  return {
    ui: {
      csp: { connectDomains: /** @type {string[]} */ ([]), resourceDomains: /** @type {string[]} */ ([]) },
      prefersBorder: false,
    },
  };
}

/** @type {Map<string, string>} */
const htmlCache = new Map();

/**
 * The card's HTML (built once per server instance).
 * @param {WidgetDef} widget
 */
export function widgetHtml(widget) {
  let html = htmlCache.get(widget.id);
  if (!html) {
    html = widgetPage({ title: widget.title, widgetId: widget.id });
    htmlCache.set(widget.id, html);
  }
  return html;
}

/**
 * Add _meta.ui.resourceUri (plus the older flat "ui/resourceUri" key) for tools that have a card,
 * and _meta.ui.visibility ["app"] for tools only the cards call (unless the tool already sets visibility).
 * @param {string} tool
 * @param {Record<string, any>} config
 * @returns {Record<string, any>}
 */
export function withWidgetMeta(tool, config) {
  const uri = toolWidgetUri(tool);
  const appOnly = APP_ONLY_TOOLS.includes(tool);
  if (!uri && !appOnly) return config;
  const meta = config._meta ?? {};
  const ui = meta.ui && typeof meta.ui === 'object' ? { ...meta.ui } : {};
  if (uri) ui.resourceUri = uri;
  if (appOnly && !ui.visibility) ui.visibility = ['app'];
  return { ...config, _meta: { ...meta, ui, ...(uri ? { [RESOURCE_URI_META_KEY]: uri } : {}) } };
}

/**
 * Call once, before registering any tool: registers the eight ui:// resources and makes server.registerTool
 * add the card meta for the tools in TOOL_WIDGETS (and app-only visibility for the tools in APP_ONLY_TOOLS).
 * @param {any} server  An McpServer from @modelcontextprotocol/sdk.
 */
export function registerWidgets(server) {
  for (const widget of WIDGETS) {
    registerAppResource(
      server,
      widget.title,
      widget.uri,
      /** @type {any} */ ({ title: widget.title, description: widget.description, mimeType: RESOURCE_MIME_TYPE, _meta: widgetResourceMeta() }),
      async () => ({
        contents: [{ uri: widget.uri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(widget), _meta: widgetResourceMeta() }],
      }),
    );
  }
  const register = server.registerTool.bind(server);
  server.registerTool = (/** @type {string} */ name, /** @type {any} */ config, /** @type {any} */ cb) =>
    register(name, withWidgetMeta(name, config ?? {}), cb);
}
