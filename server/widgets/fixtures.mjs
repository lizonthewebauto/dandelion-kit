// Sample structuredContent for every card, plus a fake kit that answers tool calls from the cards.
// Used by scripts/widget-preview.mjs (screenshots), by test/widgets.test.mjs, and by M5's demo mode.
// These shapes are the contract between the tool files (server/tools/*) and the cards (server/widgets/*.js).
// Every field here is written down in server/widgets/contracts.mjs.

/** @typedef {{ id: string, kind: 'frame'|'jpeg'|'mp4', label: string, w?: number, h?: number, hue?: number }} DemoAsset */

/**
 * The files the demo refers to by id. The preview script draws these (JPEG pictures and a small mp4).
 * @type {DemoAsset[]}
 */
export const DEMO_ASSETS = [
  { id: 'a_poster', kind: 'frame', label: 'Poster', w: 270, h: 480, hue: 38 },
  ...['karaoke-clean', 'bold-value', 'minimal-educator', 'editorial-luxe', 'storytime-energy'].map((id, i) => ({ id: `a_sample_${id}`, kind: /** @type {const} */ ('jpeg'), label: id, w: 640, h: 280, hue: 20 + i * 60 })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `a_frame_${i + 1}`, kind: /** @type {const} */ ('jpeg'), label: `Frame ${i + 1}`, w: 108, h: 192, hue: 30 + i * 8 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `a_slide_${i + 1}`, kind: /** @type {const} */ ('jpeg'), label: `Slide ${i + 1}`, w: 540, h: 675, hue: 40 + i * 25 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `a_thumb_${i + 1}`, kind: /** @type {const} */ ('jpeg'), label: `Slide ${i + 1}`, w: 216, h: 270, hue: 40 + i * 25 })),
  { id: 'a_video_draft', kind: 'mp4', label: 'Draft' },
  { id: 'a_video_final', kind: 'mp4', label: 'Final' },
];

// ---------------------------------------------------------------------------
// kit-project
// ---------------------------------------------------------------------------

const PROJECT_BASE = {
  id: 'p_demo',
  title: 'Morning routine talk',
  type: 'video',
  source_name: 'dandelion-owned-video-113s.mp4',
  duration_ms: 113000,
  width: 1080,
  height: 1920,
  fps: 30,
  transcript_ready: true,
  word_count: 287,
  language: 'en',
  face_found: true,
  cut_applied: false,
  has_shot_plan: false,
  has_draft: false,
  has_final: false,
  poster_asset_id: 'a_poster',
};

export const PROJECT = { mode: 'project', project: { ...PROJECT_BASE }, next: 'rough_cut' };

export const PROJECT_WAITING = { mode: 'project', project: { ...PROJECT_BASE, transcript_ready: false, word_count: 0, face_found: undefined }, next: 'rough_cut' };

export const PROJECT_FAR = {
  mode: 'project',
  project: { ...PROJECT_BASE, cut_applied: true, cut_before_ms: 113000, cut_after_ms: 91000, look_id: 'karaoke-clean', look_name: 'Karaoke Clean', has_shot_plan: true, has_draft: true, has_final: true },
  next: 'export',
};

export const DOCTOR = {
  mode: 'status',
  doctor: {
    ok: true,
    ffmpeg: { found: true, path: 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe', version: '8.1.1', has_ass: true, has_loudnorm: true, has_whisper: true },
    node: { version: '24.16.0', ok: true },
    disk: { free_bytes: 212_000_000_000, ok: true },
    models: { dir: 'C:\\Users\\you\\.dandelion-kit\\models', whisper: true, yunet: false },
    home: 'C:\\Users\\you\\.dandelion-kit',
    dandelion: { connected: false },
    next_steps: ['Drop a video path and I will open it.', 'Or tell me what carousel to make.'],
  },
};

export const DOCTOR_MISSING = {
  mode: 'status',
  doctor: {
    ...DOCTOR.doctor,
    ok: false,
    ffmpeg: { found: false, has_ass: false, has_loudnorm: false, has_whisper: false, install_hint: 'winget install Gyan.FFmpeg' },
    next_steps: ['Run the install command above, then ask me to check again.'],
  },
};

// ---------------------------------------------------------------------------
// kit-cut-review
// ---------------------------------------------------------------------------

/** @type {any[]} */
const SPANS = [
  { id: 'r1', kind: 'filler', src_start_ms: 4210, src_end_ms: 4590, text: 'um', keep: false },
  { id: 'r2', kind: 'silence', src_start_ms: 9100, src_end_ms: 10250, text: '', keep: false },
  { id: 'r3', kind: 'stutter', src_start_ms: 14020, src_end_ms: 14480, text: 'so so the', keep: false },
  { id: 'r4', kind: 'phrase-filler', src_start_ms: 21300, src_end_ms: 21980, text: 'you know', keep: false },
  { id: 'r5', kind: 'restart', src_start_ms: 27400, src_end_ms: 29150, text: 'I was going to, no wait, here is the thing', keep: false },
  { id: 'r6', kind: 'filler', src_start_ms: 33100, src_end_ms: 33420, text: 'uh', keep: false },
  { id: 'r7', kind: 'silence', src_start_ms: 41800, src_end_ms: 43600, text: '', keep: false },
  { id: 'r8', kind: 'filler', src_start_ms: 52010, src_end_ms: 52380, text: 'like', keep: true },
  { id: 'r9', kind: 'stutter', src_start_ms: 60700, src_end_ms: 61250, text: 'the the', keep: false },
  { id: 'r10', kind: 'silence', src_start_ms: 72200, src_end_ms: 73400, text: '', keep: false },
  { id: 'r11', kind: 'filler', src_start_ms: 88000, src_end_ms: 88350, text: 'um', keep: false },
  { id: 'r12', kind: 'restart', src_start_ms: 101200, src_end_ms: 102900, text: 'so what I mean is, what I wanted to say', keep: false },
];

export const CUT = { project_id: 'p_demo', preset: 'standard', before_ms: 113000, after_ms: 102660, removed: SPANS };

// ---------------------------------------------------------------------------
// kit-look-picker
// ---------------------------------------------------------------------------

export const LOOKS = [
  { id: 'karaoke-clean', name: 'Karaoke Clean', summary: 'Clean captions that light up the word you hear. The everyday default.', caption_theme: 'karaoke-highlight', camera_aggression: 'standard', cut_every_ms_min: 1500, cut_every_ms_max: 3000, sfx_per_minute: 4, grade: { saturation: 1.05, contrast: 1.04, warmth: 0.02 }, accent: '#FFD93D' },
  { id: 'bold-value', name: 'Bold Value', summary: 'Big, loud words with a thick outline. Good for tips and numbers.', caption_theme: 'bold-stroke', camera_aggression: 'bold', cut_every_ms_min: 1200, cut_every_ms_max: 2500, sfx_per_minute: 8, grade: { saturation: 1.12, contrast: 1.1, warmth: 0 }, accent: '#FF8A3D' },
  { id: 'minimal-educator', name: 'Minimal Educator', summary: 'Calm, quiet captions that stay out of the way of a good explanation.', caption_theme: 'clean-minimal', camera_aggression: 'calm', cut_every_ms_min: 2500, cut_every_ms_max: 4000, sfx_per_minute: 2, grade: { saturation: 1, contrast: 1, warmth: 0 }, accent: '#3DB8FF' },
  { id: 'editorial-luxe', name: 'Editorial Luxe', summary: 'A serif face and slow, steady moves. Feels like a magazine.', caption_theme: 'editorial-serif', camera_aggression: 'calm', cut_every_ms_min: 2500, cut_every_ms_max: 4500, sfx_per_minute: 1, grade: { saturation: 0.95, contrast: 1.06, warmth: 0.04 }, accent: '#E8C9A0' },
  { id: 'storytime-energy', name: 'Storytime Energy', summary: 'One word at a time, quick pace. For stories that build.', caption_theme: 'one-word-pop', camera_aggression: 'bold', cut_every_ms_min: 1000, cut_every_ms_max: 2200, sfx_per_minute: 10, grade: { saturation: 1.1, contrast: 1.05, warmth: 0.03 }, accent: '#FF5C7A' },
].map((l) => ({ ...l, sample_asset_id: `a_sample_${l.id}` }));

export const LOOK_PICKER = { project_id: 'p_demo', current: { look_id: 'karaoke-clean', caption_theme: 'karaoke-highlight', accent: '#FFD93D' }, looks: LOOKS };

// ---------------------------------------------------------------------------
// kit-shot-plan
// ---------------------------------------------------------------------------

/** @type {any[]} */
const BEATS = [
  { id: 'b1', kind: 'claim', out_start_ms: 0, out_end_ms: 3400, text: 'Most people start their morning on the wrong foot.', treatment: 'hook-card', screen_text: 'Your morning costs you focus' },
  { id: 'b2', kind: 'story', out_start_ms: 3400, out_end_ms: 7200, text: 'Here is what I did differently for thirty days.', treatment: 'face' },
  { id: 'b3', kind: 'list-step', out_start_ms: 7200, out_end_ms: 11800, text: 'Step one: no phone for the first hour.', treatment: 'text-emphasis', wanted_treatment: 'stat-card', rendered_as: 'face', screen_text: 'No phone first hour' },
  { id: 'b4', kind: 'emotional', out_start_ms: 11800, out_end_ms: 15000, text: 'I know, it sounds impossible.', treatment: 'face' },
  { id: 'b5', kind: 'number-stat', out_start_ms: 15000, out_end_ms: 19200, text: 'But my focus went up by forty percent.', treatment: 'punch-in', wanted_treatment: 'stat-card', rendered_as: 'punch-in' },
  { id: 'b6', kind: 'question', out_start_ms: 19200, out_end_ms: 22000, text: 'Do you want the full routine?', treatment: 'hold-wide' },
  { id: 'b7', kind: 'list-step', out_start_ms: 22000, out_end_ms: 27000, text: 'Step two is a glass of water before coffee.', treatment: 'face', screen_text: 'Water before coffee' },
  { id: 'b8', kind: 'claim', out_start_ms: 27000, out_end_ms: 30000, text: 'That is it. Simple wins.', treatment: 'face' },
  { id: 'b9', kind: 'cta', out_start_ms: 30000, out_end_ms: 33000, text: 'Follow for part two.', treatment: 'cta-end', screen_text: 'Follow for part two' },
];

export const SHOT_PLAN = {
  project_id: 'p_demo',
  look_id: 'karaoke-clean',
  look_name: 'Karaoke Clean',
  caption_theme: 'karaoke-highlight',
  accent: '#FFD93D',
  duration_ms: 33000,
  stats: { captions: 21, camera: 7, sfx: 3 },
  hook: {
    text: 'Your morning is quietly costing you focus',
    formula: 'cost-reveal',
    score: 84,
    candidates: [
      { text: 'Your morning is quietly costing you focus', formula: 'cost-reveal', score: 84 },
      { text: 'I skipped my phone for thirty days', formula: 'personal-experiment', score: 78 },
      { text: 'Why most morning routines fail by Friday', formula: 'myth-bust', score: 66 },
    ],
  },
  beats: BEATS,
};

// ---------------------------------------------------------------------------
// kit-preview
// ---------------------------------------------------------------------------

/** @type {any[]} */
const CHECKS_FINAL = [
  { id: 'encode', status: 'pass', label: 'File format', measured: 'h264, 1080 by 1920, 30 fps, 48 kHz audio', limit: 'h264, 1080 by 1920, 30 fps' },
  { id: 'duration', status: 'pass', label: 'Length matches the plan', measured: '0.04 s off', limit: '0.2 s' },
  { id: 'loudness', status: 'pass', label: 'Loudness', measured: '-14.1 LUFS', limit: '-15 to -13' },
  { id: 'true-peak', status: 'pass', label: 'Loudest peak', measured: '-1.4 dB', limit: '-1 dB' },
  { id: 'not-dark', status: 'pass', label: 'The end is not dark', measured: 'brightness 62', limit: 'above 12' },
  { id: 'captions-safe-zone', status: 'pass', label: 'Captions stay in the safe area', measured: 'all inside', limit: 'x 90 to 940, y 270 to 1450' },
  { id: 'face-motion', status: 'warn', label: 'Something moves in the first 2 seconds', measured: 'change 1.6', limit: '2 or more', fix: 'Add a punch-in in the first second, or start closer to the camera.' },
  { id: 'static-gap', status: 'pass', label: 'No long still stretch', measured: '3.2 s', limit: '4 s' },
  { id: 'hook-present', status: 'pass', label: 'Hook text in the first 2 seconds', measured: 'yes', limit: 'yes' },
];

const DRAFT_RENDER = {
  id: 'draft', label: 'Draft', quality: 'draft', file: 'C:\\Users\\you\\.dandelion-kit\\projects\\p_demo\\out\\draft.mp4', duration_ms: 33000, bytes: 1_240_000, plan_hash: 'h_a1',
  video_asset_id: 'a_video_draft', frame_asset_ids: Array.from({ length: 8 }, (_, i) => `a_frame_${i + 1}`),
  checks: CHECKS_FINAL.slice(0, 5).map((c) => ({ ...c })),
};
const FINAL_RENDER = {
  id: 'final', label: 'Final', quality: 'final', file: 'C:\\Users\\you\\.dandelion-kit\\projects\\p_demo\\out\\reel-final.mp4', duration_ms: 33040, bytes: 14_800_000, plan_hash: 'h_a1',
  video_asset_id: 'a_video_final', frame_asset_ids: Array.from({ length: 8 }, (_, i) => `a_frame_${i + 1}`), checks: CHECKS_FINAL,
};
const VARIANT_A = { ...FINAL_RENDER, id: 'v1', label: 'Variant A', variant_id: 'v1', axes: { hook_text: 'I skipped my phone for thirty days', opening: 'cold-open', caption_theme: 'one-word-pop', pace: 'punchy' }, file: 'C:\\Users\\you\\.dandelion-kit\\projects\\p_demo\\out\\reel-v1.mp4' };
const VARIANT_B = { ...FINAL_RENDER, id: 'v2', label: 'Variant B', variant_id: 'v2', axes: { hook_text: 'Why most morning routines fail by Friday', opening: 'hook-card', caption_theme: 'bold-stroke', pace: 'gentle' }, file: 'C:\\Users\\you\\.dandelion-kit\\projects\\p_demo\\out\\reel-v2.mp4' };

export const PREVIEW_DRAFT = { project_id: 'p_demo', active: 'draft', renders: [DRAFT_RENDER] };
export const PREVIEW_FINAL = { project_id: 'p_demo', active: 'final', renders: [DRAFT_RENDER, FINAL_RENDER] };
export const PREVIEW_VARIANTS = { project_id: 'p_demo', active: 'v1', renders: [DRAFT_RENDER, FINAL_RENDER, VARIANT_A, VARIANT_B] };

// ---------------------------------------------------------------------------
// kit-carousel
// ---------------------------------------------------------------------------

const BRAND = { name: 'Morning Method', handle: '@morningmethod', colors: { bg: '#FBF6EA', fg: '#1F1A14', accent: '#E0A100', muted: '#6B6254' }, fonts: { heading: 'Fraunces', body: 'Inter' } };

/** @type {any[]} */
const SLIDE_SPECS = [
  { layout: 'cover', fields: { kicker: 'Morning routine', title: 'Win the first hour', subtitle: 'Three small moves that changed my focus in thirty days.' } },
  { layout: 'list', fields: { title: 'What I stopped doing', items: ['Checking my phone in bed', 'Coffee on an empty stomach', 'Planning in my head', 'Skipping water'] } },
  { layout: 'steps', fields: { title: 'The routine', steps: [{ n: 1, text: 'No phone for the first hour' }, { n: 2, text: 'A glass of water before coffee' }, { n: 3, text: 'Write the one thing that matters' }] } },
  { layout: 'stat', fields: { number: '40%', label: 'more focus', note: 'Self-tracked over 30 days' } },
  { layout: 'quote', fields: { quote: 'Protect the first hour and the rest of the day takes care of itself.', who: 'Morning Method' } },
  { layout: 'cta', fields: { title: 'Try it for a week', line: 'Save this and tell me how day three goes.', handle: '@morningmethod' } },
];

export const CAROUSEL = {
  project_id: 'p_car',
  title: 'Win the first hour',
  size: 'portrait',
  width: 1080,
  height: 1350,
  brand: BRAND,
  slides: SLIDE_SPECS.map((s, i) => ({
    ...s,
    file: `C:\\Users\\you\\.dandelion-kit\\projects\\p_car\\out\\slide-${i + 1}.jpg`,
    asset_id: `a_slide_${i + 1}`,
    thumb_asset_id: `a_thumb_${i + 1}`,
    width: 1080,
    height: 1350,
  })),
};

// ---------------------------------------------------------------------------
// kit-export
// ---------------------------------------------------------------------------

export const EXPORT = {
  project_id: 'p_demo',
  dir: 'C:\\Users\\you\\Videos\\morning-routine-export',
  files: [
    { path: 'C:\\Users\\you\\Videos\\morning-routine-export\\reel-final.mp4', bytes: 14_800_000, kind: 'video' },
    { path: 'C:\\Users\\you\\Videos\\morning-routine-export\\reel-variant-a.mp4', bytes: 13_900_000, kind: 'video' },
    { path: 'C:\\Users\\you\\Videos\\morning-routine-export\\captions.srt', bytes: 3_120, kind: 'caption' },
    { path: 'C:\\Users\\you\\Videos\\morning-routine-export\\summary.md', bytes: 1_840, kind: 'doc' },
    { path: 'C:\\Users\\you\\Videos\\morning-routine-export\\source-map.json', bytes: 2_210, kind: 'doc' },
  ],
  summary_path: 'C:\\Users\\you\\Videos\\morning-routine-export\\summary.md',
  source_map_path: 'C:\\Users\\you\\Videos\\morning-routine-export\\source-map.json',
};

// ---------------------------------------------------------------------------
// kit-post
// ---------------------------------------------------------------------------

const LIMITS = {
  instagram: { caption_max: 2200, hashtags_max: 30, hashtags_ideal: 5 },
  tiktok: { caption_max: 2200, hashtags_max: 10, hashtags_ideal: 4 },
  youtube: { title_max: 100, description_max: 5000, hashtags_max: 15, hashtags_ideal: 3 },
  linkedin: { caption_max: 3000, hashtags_max: 5, hashtags_ideal: 3 },
  x: { caption_max: 280, hashtags_max: 2, hashtags_ideal: 1 },
  threads: { caption_max: 500, hashtags_max: 1, hashtags_ideal: 1 },
  facebook: { caption_max: 63206, hashtags_max: 5, hashtags_ideal: 2 },
  pinterest: { title_max: 100, description_max: 500, hashtags_max: 20, hashtags_ideal: 4 },
};

const CORE_TEXT = 'I stopped checking my phone for the first hour of the day. After thirty days my focus was up by about forty percent. Here is the whole routine, start to finish.';

/** @type {Record<string, any>} */
const CHANNELS = {
  instagram: { copy: { caption: `${CORE_TEXT}\n\nSave this for tomorrow morning.`, hashtags: ['#morningroutine', '#focus', '#habits'] }, limits: LIMITS.instagram, warnings: [], format: 'Reel' },
  tiktok: { copy: { caption: 'No phone for the first hour. Thirty days later my focus was up forty percent.', hashtags: ['#morningroutine', '#focus'] }, limits: LIMITS.tiktok, warnings: [], format: 'Video' },
  youtube: { copy: { title: 'The 30 day morning routine that boosted my focus', description: `${CORE_TEXT}\n\nStep one: no phone. Step two: water before coffee.`, hashtags: ['#shorts', '#morningroutine'] }, limits: LIMITS.youtube, warnings: [], format: 'Short' },
  linkedin: { copy: { caption: `${CORE_TEXT}\n\nWhat is the first thing you do after you wake up?`, hashtags: ['#productivity', '#habits'] }, limits: LIMITS.linkedin, warnings: [], format: 'Video post' },
  x: { copy: { caption: `${CORE_TEXT} It really does change the whole day, and the best part is that it costs you nothing at all to try tomorrow morning.`, hashtags: ['#focus'] }, limits: LIMITS.x, warnings: ['This is too long for X. Shorten it before you send.'], format: 'Post with video' },
  threads: { copy: { caption: 'No phone for the first hour. Thirty days later my focus was up forty percent.', hashtags: [] }, limits: LIMITS.threads, warnings: [], format: 'Post' },
  facebook: { copy: { caption: `${CORE_TEXT}`, hashtags: ['#morningroutine'] }, limits: LIMITS.facebook, warnings: [], format: 'Reel' },
  pinterest: { copy: { title: 'A 30 day morning routine for better focus', description: 'No phone for the first hour, water before coffee, and one thing written down. Save it for tomorrow.', hashtags: ['#morningroutine'] }, limits: LIMITS.pinterest, warnings: [], format: 'Video pin' },
};

const BUNDLE = {
  id: 'bundle_demo',
  kind: 'video',
  files: ['C:\\Users\\you\\.dandelion-kit\\projects\\p_demo\\out\\reel-final.mp4'],
  text: CORE_TEXT,
  project_id: 'p_demo',
  channels: CHANNELS,
  rules_source: 'live',
  created_at: 1_790_000_000_000,
  preview_asset_ids: ['a_poster'],
};

/** State 1: not connected. The versions work before any sign-up. */
export const POST_DRAFT = { bundle: BUNDLE, dandelion: { connected: false } };

const QA_BRAND = { id: '610301ec-0e2e-4be8-bc04-3d263d2fdfcc', name: 'Dandelion QA' };
const CONNECT_LINKS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'threads', 'facebook', 'pinterest'].map((platform) => ({ platform, url: `https://dandelionapp.io/app/connect/${platform}` }));

/** State 2: connected, but no app is connected to the brand yet. */
export const POST_CONNECTED_NO_CHANNELS = {
  bundle: BUNDLE,
  dandelion: { connected: true, workspace: { id: 'w1', name: 'Liz Owner' }, plan: 'Owner', usage: { used: 12, limit: 200 }, brands: [QA_BRAND], channels: [], connect_links: CONNECT_LINKS },
};

/** State 2 with two apps ready. */
export const POST_CONNECTED = {
  bundle: BUNDLE,
  dandelion: {
    connected: true, workspace: { id: 'w1', name: 'Liz Owner' }, plan: 'Free', usage: { used: 12, limit: 60 },
    brands: [QA_BRAND, { id: 'b2', name: 'Morning Method' }],
    channels: [
      { id: 'c1', brand_id: QA_BRAND.id, platform: 'instagram', handle: 'morningmethod', can_post: true },
      { id: 'c2', brand_id: QA_BRAND.id, platform: 'tiktok', handle: 'morningmethod', can_post: true },
      { id: 'c3', brand_id: QA_BRAND.id, platform: 'youtube', handle: 'morningmethod', can_post: false },
    ],
    connect_links: CONNECT_LINKS,
  },
};

/** @type {any[]} */
const JOBS = [
  { id: 'j1', channel_id: 'c1', platform: 'instagram', handle: 'morningmethod', status: 'review', copy: CHANNELS.instagram.copy, checks: [] },
  { id: 'j2', channel_id: 'c2', platform: 'tiktok', handle: 'morningmethod', status: 'review', copy: CHANNELS.tiktok.copy, checks: ['The caption is under the recommended length, add a line about the routine.'] },
  { id: 'j3', channel_id: 'c3', platform: 'youtube', handle: 'morningmethod', status: 'scheduled', post_at: '2026-12-02T14:00:00.000Z', copy: CHANNELS.youtube.copy, checks: [] },
];

/** State 3: after a send, one card per post. */
export const POST_JOBS = {
  bundle: { ...BUNDLE, sent: { brand_id: QA_BRAND.id, content_id: 'ct_demo', mode: 'review', jobs: JOBS, sent_at: 1_790_000_100_000 } },
  dandelion: POST_CONNECTED.dandelion,
};

/** After a library-only send with no app connected. */
export const POST_LIBRARY_NO_CHANNELS = {
  bundle: { ...BUNDLE, sent: { brand_id: QA_BRAND.id, content_id: 'ct_demo', mode: 'library', jobs: [], sent_at: 1_790_000_100_000 } },
  dandelion: POST_CONNECTED_NO_CHANNELS.dandelion,
};

// ---------------------------------------------------------------------------
// The fake kit: answers tools/call from the cards
// ---------------------------------------------------------------------------

/** @param {string} text @param {any} data */
const ok = (text, data) => ({ content: [{ type: 'text', text }], structuredContent: data });
/** @param {string} text */
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
/** @param {any} v */
const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * Start state for the fake kit. Pass the card's own fixture so a tap continues from what is on screen.
 * @param {any} [seed]
 */
export function newDemoState(seed) {
  return {
    cut: copy(CUT),
    shot: copy(SHOT_PLAN),
    carousel: copy(CAROUSEL),
    look: copy(LOOK_PICKER.current),
    post: copy(seed && seed.bundle ? seed : POST_DRAFT),
    sentJobs: copy(JOBS),
    connected: !!(seed && seed.dandelion && seed.dandelion.connected),
    delayMs: 350,
  };
}

/**
 * Answer one tool call. Returns a MCP tool result. `state` is mutated, like a real project would be.
 * @param {string} tool
 * @param {Record<string, any>} args
 * @param {ReturnType<typeof newDemoState>} state
 */
export function demoTool(tool, args, state) {
  switch (tool) {
    case 'get_project':
      return ok('Project p_demo: transcript ready.', copy(PROJECT));
    case 'rough_cut': {
      state.cut = copy(CUT);
      state.cut.preset = args.preset || 'standard';
      if (args.preset === 'punchy') state.cut.after_ms = 94100;
      if (args.preset === 'gentle') state.cut.after_ms = 106800;
      return ok(`Rough cut ready: ${state.cut.removed.length} pieces.`, copy(state.cut));
    }
    case 'update_cut': {
      const keep = new Set(args.keep_ids || []);
      let after = state.cut.after_ms;
      for (const s of state.cut.removed) {
        const was = s.keep;
        s.keep = keep.has(s.id);
        const dur = s.src_end_ms - s.src_start_ms;
        if (was && !s.keep) after -= dur;
        if (!was && s.keep) after += dur;
      }
      state.cut.after_ms = after;
      return ok('Cut updated.', copy(state.cut));
    }
    case 'pick_look': {
      if (args.look) state.look = { look_id: args.look, caption_theme: args.caption_theme, accent: args.accent };
      return ok('Looks.', { project_id: args.project_id, current: copy(state.look), looks: copy(LOOKS) });
    }
    case 'plan_shots':
      return ok('Shot plan ready.', copy(state.shot));
    case 'update_shot_plan': {
      for (const e of args.beats || []) {
        const b = state.shot.beats.find((/** @type {any} */ x) => x.id === e.id);
        if (!b) continue;
        if (e.treatment) b.treatment = e.treatment;
        if (e.text !== undefined) b.screen_text = e.text;
      }
      if (args.hook_text) state.shot.hook.text = args.hook_text;
      return ok('Shot plan saved.', copy(state.shot));
    }
    case 'render_reel':
      return ok(`${args.quality} render done.`, copy(args.quality === 'final' ? PREVIEW_FINAL : PREVIEW_DRAFT));
    case 'check_reel':
      return ok('Checks run.', copy(PREVIEW_FINAL));
    case 'make_variants':
      return ok('Two variants ready.', copy(PREVIEW_VARIANTS));
    case 'update_slides': {
      state.carousel.slides = (args.slides || []).map((/** @type {any} */ s, /** @type {number} */ i) => ({
        ...s, file: `C:\\Users\\you\\.dandelion-kit\\projects\\p_car\\out\\slide-${i + 1}.jpg`,
        asset_id: `a_slide_${(i % 6) + 1}`, thumb_asset_id: `a_thumb_${(i % 6) + 1}`, width: 1080, height: 1350,
      }));
      return ok('Slides rendered.', copy(state.carousel));
    }
    case 'export':
      return ok('Exported.', copy(EXPORT));
    case 'open_path':
      return ok('Opened.', { ok: true });
    case 'offer_post': {
      const seed = copy(POST_DRAFT);
      seed.bundle.kind = args.kind || seed.bundle.kind;
      if (args.files) seed.bundle.files = args.files;
      if (state.connected) seed.dandelion = copy(POST_CONNECTED_NO_CHANNELS.dandelion);
      state.post = seed;
      return ok('Versions ready for 8 apps.', copy(seed));
    }
    case 'set_channel_copy': {
      const ch = state.post.bundle.channels[args.channel];
      if (ch) ch.copy = args.copy;
      const text = (args.copy && (args.copy.caption || args.copy.description)) || '';
      const max = ch && ch.limits && (ch.limits.caption_max || ch.limits.description_max);
      if (max && text.length > max) return fail(`That is ${text.length - max} characters over the limit for ${args.channel}.`);
      return ok('Saved.', { channel: args.channel, copy: args.copy, warnings: [] });
    }
    case 'connect_dandelion':
      state.connected = true;
      state.post.dandelion = copy(POST_CONNECTED.dandelion);
      return ok('Signed in.', { dandelion: copy(state.post.dandelion) });
    case 'dandelion_status':
      return ok(state.connected ? 'Signed in.' : 'Not signed in.', { dandelion: copy(state.post.dandelion) });
    case 'send_to_dandelion': {
      const want = new Set(args.channels || []);
      const jobs = args.mode === 'review' ? copy(state.sentJobs).filter((/** @type {any} */ j) => want.has(j.platform) && j.status === 'review') : [];
      state.post.bundle.sent = { brand_id: args.brand_id, content_id: 'ct_demo', mode: args.mode, jobs, sent_at: Date.now() };
      return ok(jobs.length ? `${jobs.length} posts are waiting for your OK.` : 'Saved to your library.', { sent: copy(state.post.bundle.sent) });
    }
    case 'approve_post':
      return ok('Approved.', { job: { id: args.job_id, status: args.post_at ? 'scheduled' : 'posting', post_at: args.post_at } });
    case 'skip_post':
      return ok('Skipped.', { job: { id: args.job_id, status: 'skipped' } });
    default:
      return fail(`The demo kit does not know the tool ${tool}.`);
  }
}

/** The first result each card shows in the preview, by file name. */
export const CARD_FIXTURES = [
  { file: 'kit-project', widget: 'kit-project', title: 'Project, after open_video', data: PROJECT },
  { file: 'kit-project-working', widget: 'kit-project', title: 'Project, still listening', data: PROJECT_WAITING },
  { file: 'kit-project-done', widget: 'kit-project', title: 'Project, finished', data: PROJECT_FAR },
  { file: 'kit-project-doctor', widget: 'kit-project', title: 'Kit check', data: DOCTOR },
  { file: 'kit-project-doctor-missing', widget: 'kit-project', title: 'Kit check, ffmpeg missing', data: DOCTOR_MISSING },
  { file: 'kit-cut-review', widget: 'kit-cut-review', title: 'Rough cut', data: CUT },
  { file: 'kit-look-picker', widget: 'kit-look-picker', title: 'Looks', data: LOOK_PICKER },
  { file: 'kit-shot-plan', widget: 'kit-shot-plan', title: 'Shot plan', data: SHOT_PLAN },
  { file: 'kit-preview', widget: 'kit-preview', title: 'Draft preview', data: PREVIEW_DRAFT },
  { file: 'kit-preview-final', widget: 'kit-preview', title: 'Final with a warning', data: PREVIEW_FINAL },
  { file: 'kit-preview-variants', widget: 'kit-preview', title: 'Variants', data: PREVIEW_VARIANTS },
  { file: 'kit-carousel', widget: 'kit-carousel', title: 'Carousel', data: CAROUSEL },
  { file: 'kit-export', widget: 'kit-export', title: 'Export', data: EXPORT },
  { file: 'kit-post', widget: 'kit-post', title: 'Post, state 1: not connected', data: POST_DRAFT },
  { file: 'kit-post-connected', widget: 'kit-post', title: 'Post, state 2: connected', data: POST_CONNECTED },
  { file: 'kit-post-connect-links', widget: 'kit-post', title: 'Post, state 2: no app connected yet', data: POST_CONNECTED_NO_CHANNELS },
  { file: 'kit-post-jobs', widget: 'kit-post', title: 'Post, state 3: approve, schedule or skip', data: POST_JOBS },
  { file: 'kit-post-library', widget: 'kit-post', title: 'Post, saved to library, no app yet', data: POST_LIBRARY_NO_CHANNELS },
];
