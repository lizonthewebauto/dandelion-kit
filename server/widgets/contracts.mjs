// What each kit tool must put in structuredContent so its card can draw it. The tool files (server/tools/*) build these,
// the card scripts (server/widgets/kit-*.js) read them, and server/widgets/fixtures.mjs holds a worked example of each.
// Cards ignore fields they do not know and cope with missing optional fields. Media never travels in structuredContent:
// it is an asset id the card loads through read_asset. Keep structuredContent under 50 KB.
//
// One card page carries all eight views. When a card calls a tool, the view that tool belongs to draws the result
// (see TOOL_WIDGETS in registry.mjs), so every tool below must return its own view's shape, in the same call.

/**
 * kit-project. Shown by open_video and get_project (mode "project") and by doctor (mode "status").
 * @typedef {object} ProjectCard
 * @property {'project'|'status'} [mode]
 * @property {{
 *   id: string, title: string, source_name?: string, duration_ms?: number, width?: number, height?: number, fps?: number,
 *   transcript_ready: boolean, word_count?: number, face_found?: boolean,
 *   cut_applied?: boolean, cut_before_ms?: number, cut_after_ms?: number,
 *   look_id?: string, look_name?: string, has_shot_plan?: boolean, has_draft?: boolean, has_final?: boolean,
 *   poster_asset_id?: string
 * }} [project]
 * @property {import('../../core/types.mjs').DoctorReport} [doctor]   With mode "status".
 */

/**
 * kit-cut-review. Shown by rough_cut and update_cut. removed[].keep is true when the piece stays in.
 * @typedef {object} CutCard
 * @property {string} project_id
 * @property {'gentle'|'standard'|'punchy'} preset
 * @property {number} before_ms
 * @property {number} after_ms                    Length with the current keep flags applied.
 * @property {import('../../core/types.mjs').RemovedSpan[]} removed
 */

/**
 * kit-look-picker. Shown by pick_look. Called with look, caption_theme and accent it saves them and returns the same shape
 * with current updated.
 * @typedef {object} LookCard
 * @property {string} project_id
 * @property {{look_id?: string, caption_theme?: string, accent?: string}} current
 * @property {(import('../../core/types.mjs').Look & {sample_asset_id?: string})[]} looks   sample_asset_id is a JPEG with a caption on a frame.
 * @property {string[]} [accents]                 Extra accent colors, "#RRGGBB".
 */

/**
 * kit-shot-plan. Shown by plan_shots and update_shot_plan. update_shot_plan takes {project_id, beats:[{id, treatment?, text?}], hook_text?}
 * where text is the beat's on-screen text; it returns this shape again.
 * @typedef {object} ShotPlanCard
 * @property {string} project_id
 * @property {string} look_id
 * @property {string} [look_name]
 * @property {string} caption_theme
 * @property {number} duration_ms
 * @property {{captions?: number, camera?: number, sfx?: number}} [stats]
 * @property {import('../../core/types.mjs').Hook} hook
 * @property {import('../../core/types.mjs').Beat[]} beats
 */

/**
 * kit-preview. Shown by render_reel, check_reel and make_variants. Every one returns ALL known renders of the project
 * (draft, final, variants) with active pointing at the one to show first.
 * @typedef {object} PreviewRender
 * @property {string} id                          "draft", "final" or a variant id.
 * @property {string} label                       Tab label.
 * @property {'draft'|'final'} quality
 * @property {string} file                        Absolute path of the mp4.
 * @property {number} duration_ms
 * @property {number} bytes
 * @property {string} [variant_id]
 * @property {import('../../core/types.mjs').Variant['axes']} [axes]
 * @property {string} [video_asset_id]            The 540 by 960 proxy for playing in the card.
 * @property {string[]} [frame_asset_ids]         Up to 8 JPEG frames.
 * @property {import('../../core/types.mjs').Check[]} checks
 */
/**
 * @typedef {object} PreviewCard
 * @property {string} project_id
 * @property {string} [active]
 * @property {PreviewRender[]} renders
 */

/**
 * kit-carousel. Shown by make_carousel, make_image and update_slides. update_slides takes {project_id, slides:[{layout, fields}]}
 * (the full new list) and returns this shape again. Asset ids may stay the same after a re-render: the card forgets its cache.
 * @typedef {object} CarouselCard
 * @property {string} project_id
 * @property {string} title
 * @property {keyof typeof import('../../core/types.mjs').IMAGE_SIZES} size
 * @property {number} width
 * @property {number} height
 * @property {import('../../core/types.mjs').BrandConfig} brand
 * @property {{layout: string, fields: Record<string, any>, file: string, asset_id: string, thumb_asset_id?: string, width: number, height: number}[]} slides
 * @property {Record<string, number>} [budgets]   Optional character budgets keyed "layout:path", for example "cover:title".
 */

/**
 * kit-export. Shown by export. It is core/types.mjs ExportResult plus the project id.
 * @typedef {import('../../core/types.mjs').ExportResult & {project_id?: string}} ExportCard
 */

/**
 * kit-post. Shown by offer_post, set_channel_copy, connect_dandelion, dandelion_status and send_to_dandelion.
 * Each of those returns some of these fields and the card merges what it gets:
 *   offer_post          {bundle, dandelion}
 *   set_channel_copy    {channel, copy, warnings?}  (or {bundle})
 *   connect_dandelion   {dandelion}                 (if sign-in is still open it may return {dandelion:{connected:false}, pending:true, connect_url}
 *                                                    and the card polls dandelion_status for up to 3 minutes)
 *   dandelion_status    {dandelion}
 *   send_to_dandelion   {sent}                      (or {bundle} with bundle.sent set). The card sends
 *                                                    {bundle_id, brand_id, mode, channels?: platform ids} where channels lists the connected
 *                                                    apps to make posts for when mode is "review".
 *   approve_post        {job:{id, status, post_at?}}
 *   skip_post           {job:{id, status}}
 * bundle.channels[p].format is an optional label such as "Reel"; bundle.preview_asset_ids are JPEG thumbnails or a video poster.
 * @typedef {object} PostCard
 * @property {import('../../core/types.mjs').PostBundle & {preview_asset_ids?: string[]}} [bundle]
 * @property {import('../../core/types.mjs').DandelionState} [dandelion]
 * @property {import('../../core/types.mjs').SentBundle} [sent]
 * @property {string} [notice]
 * @property {string} [connect_url]
 * @property {boolean} [pending]
 */

/** The kit tools each card calls itself. The widget test keeps the scripts and this list in step. */
export const CARD_TOOL_CALLS = Object.freeze({
  'kit-project': ['rough_cut', 'pick_look', 'plan_shots', 'render_reel', 'get_project', 'export'],
  'kit-cut-review': ['update_cut', 'rough_cut', 'pick_look'],
  'kit-look-picker': ['pick_look', 'plan_shots'],
  'kit-shot-plan': ['update_shot_plan', 'render_reel'],
  'kit-preview': ['render_reel', 'make_variants', 'check_reel', 'offer_post'],
  'kit-carousel': ['update_slides', 'offer_post'],
  'kit-export': ['open_path', 'offer_post'],
  'kit-post': ['set_channel_copy', 'connect_dandelion', 'dandelion_status', 'send_to_dandelion', 'approve_post', 'skip_post'],
  runtime: ['read_asset'],
});
