// Shared shapes for Dandelion Kit. Every other module builds against these definitions.
// Changing a field here needs a note in CHANGELOG.md.
// Units: time in whole milliseconds (suffix _ms), sizes in pixels, ratios as plain numbers, ids as strings.

// ---------------------------------------------------------------------------
// Closed lists (frozen so every module imports the same values)
// ---------------------------------------------------------------------------

/** Social apps the kit writes for. The ids match Dandelion's platform ids. */
export const CHANNEL_IDS = Object.freeze([
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
  'threads',
  'facebook',
  'pinterest',
]);

/** The five looks a reel can have. The first one is the default. */
export const LOOK_IDS = Object.freeze([
  'karaoke-clean',
  'bold-value',
  'minimal-educator',
  'editorial-luxe',
  'storytime-energy',
]);

/** The eight caption themes. The first one is the default. */
export const CAPTION_THEMES = Object.freeze([
  'karaoke-highlight',
  'karaoke-pill',
  'one-word-pop',
  'bold-stroke',
  'clean-minimal',
  'editorial-serif',
  'box-caption',
  'mono-terminal',
]);

/** What a beat is about, decided from its sentence. */
export const BEAT_KINDS = Object.freeze([
  'number-stat',
  'list-step',
  'contrast',
  'instruction',
  'question',
  'story',
  'emotional',
  'cta',
  'claim',
  'default',
]);

/** Treatments the ffmpeg render path can draw in v1. */
export const TREATMENTS = Object.freeze([
  'face',
  'punch-in',
  'hold-wide',
  'text-emphasis',
  'hook-card',
  'cta-end',
]);

/** The twelve carousel and image layouts. */
export const LAYOUT_IDS = Object.freeze([
  'cover',
  'list',
  'steps',
  'stat',
  'comparison',
  'quote',
  'checklist',
  'myth-fact',
  'before-after',
  'cta',
  'photo-hero',
  'framework',
]);

/** Image sizes the carousel renderer supports. The first one is the default. */
export const IMAGE_SIZES = Object.freeze({
  portrait: { id: 'portrait', width: 1080, height: 1350 },
  square: { id: 'square', width: 1080, height: 1080 },
  story: { id: 'story', width: 1080, height: 1920 },
});

/** Kinds of social content the post offer accepts. */
export const POST_KINDS = Object.freeze(['text', 'image', 'carousel', 'video', 'thread']);

/** Result of one check on a finished reel. */
export const CHECK_STATUSES = Object.freeze(['pass', 'warn', 'stop']);

/** Kinds of file a project can register for read_asset. */
export const ASSET_KINDS = Object.freeze([
  'source',
  'work',
  'proxy',
  'audio',
  'frame',
  'thumb',
  'caption',
  'output',
  'slide',
]);

// ---------------------------------------------------------------------------
// Assets and projects
// ---------------------------------------------------------------------------

/**
 * A file registered in a project. read_asset only serves files registered here.
 * @typedef {object} Asset
 * @property {string} id            Short stable id, for example "a_3f9c".
 * @property {string} path          Absolute path on disk.
 * @property {string} mime          For example "video/mp4" or "image/jpeg".
 * @property {number} bytes
 * @property {typeof ASSET_KINDS[number]} kind
 * @property {string} [label]       Human label shown in cards.
 */

/**
 * Facts about a media file, from ffprobe.
 * @typedef {object} MediaInfo
 * @property {number} duration_ms
 * @property {number} fps           Average frames per second.
 * @property {number} width
 * @property {number} height
 * @property {boolean} has_audio
 * @property {number} [audio_rate]  Sample rate in Hz.
 * @property {string} [video_codec]
 */

/**
 * One kit project (a video edit or a carousel). Stored at ~/.dandelion-kit/projects/<id>/project.json.
 * @typedef {object} Project
 * @property {string} id
 * @property {'video'|'carousel'} type
 * @property {string} title
 * @property {number} created_at      Unix ms.
 * @property {number} updated_at      Unix ms.
 * @property {string} [source_path]   Original video path the person gave.
 * @property {string} [source_hash]   Content hash used to skip repeated ingest work.
 * @property {MediaInfo} [media]      Facts about the work copy.
 * @property {Record<string, Asset>} assets  Registry keyed by asset id.
 * @property {boolean} transcript_ready
 * @property {Transcript} [transcript]
 * @property {CutPlan} [cut]
 * @property {boolean} cut_applied
 * @property {string} [look_id]       One of LOOK_IDS.
 * @property {string} [caption_theme] One of CAPTION_THEMES.
 * @property {string} [accent]        Accent color, "#RRGGBB".
 * @property {ShotPlan} [shot_plan]
 * @property {Record<string, RenderResult>} [renders]  Keyed by "draft", "final" or a variant id.
 * @property {CarouselSpec} [carousel]
 * @property {{x:number,y:number,w:number,h:number}[]} [face_boxes]  Head boxes found in sampled frames.
 */

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/**
 * One spoken word with its time span.
 * @typedef {object} Word
 * @property {string} text
 * @property {number} start_ms
 * @property {number} end_ms
 * @property {number} [conf]          0 to 1, when the engine gives one.
 */

/**
 * A run of words (a sentence or a phrase).
 * @typedef {object} Segment
 * @property {number} start_ms
 * @property {number} end_ms
 * @property {string} text
 * @property {number} first_word      Index into Transcript.words.
 * @property {number} last_word       Index into Transcript.words, inclusive.
 */

/**
 * @typedef {object} Transcript
 * @property {Word[]} words           Times strictly non-decreasing.
 * @property {Segment[]} segments
 * @property {string} language        For example "en".
 * @property {'precise'|'coarse'} quality  "coarse" when only the ffmpeg whisper filter was available.
 * @property {string} engine          "transformers", "whisper-cli" or "ffmpeg".
 */

// ---------------------------------------------------------------------------
// Rough cut
// ---------------------------------------------------------------------------

/**
 * A stretch of the source that stays in the reel.
 * @typedef {object} Piece
 * @property {string} id
 * @property {number} src_start_ms    Start in the work copy.
 * @property {number} src_end_ms
 * @property {number} out_start_ms    Start in the cut timeline.
 * @property {number} out_end_ms
 * @property {number} first_word      Index into Transcript.words.
 * @property {number} last_word
 */

/**
 * A stretch the rough cut proposes to remove. The person can keep it from the card.
 * @typedef {object} RemovedSpan
 * @property {string} id
 * @property {'filler'|'stutter'|'silence'|'restart'|'phrase-filler'} kind
 * @property {number} src_start_ms
 * @property {number} src_end_ms
 * @property {string} text            The words removed (empty for silence).
 * @property {boolean} keep           True when the person chose to keep it.
 */

/**
 * @typedef {object} CutPlan
 * @property {'gentle'|'standard'|'punchy'} preset
 * @property {Piece[]} pieces
 * @property {RemovedSpan[]} removed
 * @property {number} before_ms       Duration before the cut.
 * @property {number} after_ms        Duration after the cut.
 */

// ---------------------------------------------------------------------------
// Looks and shot plan
// ---------------------------------------------------------------------------

/**
 * One look (a named bundle of pacing, caption, camera and sound defaults).
 * @typedef {object} Look
 * @property {typeof LOOK_IDS[number]} id
 * @property {string} name
 * @property {string} summary                 One plain sentence for the picker card.
 * @property {typeof CAPTION_THEMES[number]} caption_theme
 * @property {'calm'|'standard'|'bold'|'chaos'} camera_aggression
 * @property {number} cut_every_ms_min        Shortest time between visual changes.
 * @property {number} cut_every_ms_max
 * @property {number} sfx_per_minute          Sound effect budget.
 * @property {{saturation:number,contrast:number,warmth:number}} grade
 * @property {string} accent                  Default accent color, "#RRGGBB".
 */

/**
 * One beat of the reel: a sentence or idea with the way it is shown.
 * @typedef {object} Beat
 * @property {string} id
 * @property {typeof BEAT_KINDS[number]} kind
 * @property {number} out_start_ms            In the cut timeline.
 * @property {number} out_end_ms
 * @property {number} first_word
 * @property {number} last_word
 * @property {string} text                    The spoken words.
 * @property {typeof TREATMENTS[number]} treatment
 * @property {string} [wanted_treatment]      Richer treatment a later path could draw.
 * @property {string} [rendered_as]           What v1 draws instead, for example "face".
 * @property {string} [screen_text]           Short on-screen text (3 to 7 words), never a copy of the caption.
 * @property {number[]} emphasis_words        Indexes into Transcript.words.
 */

/**
 * One caption cue, in the cut timeline.
 * @typedef {object} CaptionCue
 * @property {number} start_ms
 * @property {number} end_ms
 * @property {number[]} word_indexes          Indexes into Transcript.words.
 * @property {string} text
 * @property {number} [active_word]           Position inside word_indexes that is highlighted, per-word cues.
 */

/**
 * One camera move on a stretch of the cut timeline.
 * @typedef {object} CameraMove
 * @property {number} out_start_ms
 * @property {number} out_end_ms
 * @property {'wide'|'punch-in'|'micro-punch'|'creep'} kind
 * @property {number} zoom_from            1 means no zoom.
 * @property {number} zoom_to
 */

/**
 * One sound effect cue.
 * @typedef {object} SfxCue
 * @property {number} out_ms
 * @property {'tap'|'submit'|'pop'|'whoosh'|'ding'|'riser'|'bass-hit'|'snap'|'page'|'complete'} name
 * @property {number} gain_db              Relative to speech, usually -12.
 */

/**
 * The hook (the first two seconds).
 * @typedef {object} Hook
 * @property {string} text                 On-screen hook text, at most 9 words, no dashes.
 * @property {string} formula              Id of the hook formula used.
 * @property {number} score                0 to 100, pass at 70 or more.
 * @property {{text:string,formula:string,score:number}[]} candidates
 */

/**
 * Everything the renderer needs. The render is built once from this.
 * @typedef {object} ShotPlan
 * @property {string} look_id
 * @property {string} caption_theme
 * @property {string} accent
 * @property {number} seed                 Same seed and inputs give the same plan.
 * @property {number} duration_ms          Length of the cut timeline.
 * @property {Beat[]} beats
 * @property {CaptionCue[]} captions
 * @property {CameraMove[]} camera
 * @property {SfxCue[]} sfx
 * @property {Hook} hook
 * @property {{x:number,y:number}|null} [caption_anchor]  Pixel anchor in the 1080x1920 frame, null when unknown.
 * @property {string} hash                 Content hash of the fields above, used by the render cache.
 */

// ---------------------------------------------------------------------------
// Render and checks
// ---------------------------------------------------------------------------

/**
 * One check on a finished file.
 * @typedef {object} Check
 * @property {string} id                   For example "loudness" or "captions-safe-zone".
 * @property {typeof CHECK_STATUSES[number]} status
 * @property {string} label                Plain words.
 * @property {number|string|boolean|null} measured
 * @property {number|string|null} limit
 * @property {string} [fix]                What to change when the check is not a pass.
 */

/**
 * @typedef {object} RenderResult
 * @property {string} file                 Absolute path of the mp4.
 * @property {'draft'|'final'} quality
 * @property {string} plan_hash            ShotPlan.hash used for this render.
 * @property {number} duration_ms
 * @property {number} bytes
 * @property {Check[]} checks
 * @property {string} [variant_id]
 * @property {number} rendered_at          Unix ms.
 */

/**
 * A variant of the same speech with different creative choices.
 * @typedef {object} Variant
 * @property {string} id
 * @property {{hook_text:string, opening:'hook-card'|'cold-open', caption_theme:string, pace:'gentle'|'standard'|'punchy'}} axes
 * @property {RenderResult} [render]
 */

// ---------------------------------------------------------------------------
// Carousels and images
// ---------------------------------------------------------------------------

/**
 * Brand settings read from brand.json.
 * @typedef {object} BrandConfig
 * @property {string} name
 * @property {string} handle               For example "@yourname".
 * @property {{bg:string,fg:string,accent:string,muted:string}} colors  "#RRGGBB" values.
 * @property {{heading:string,body:string}} fonts  Font family names from assets/fonts.
 * @property {string} [logo]               Path to a logo image.
 */

/**
 * One slide: a layout plus its fields. The fields are checked against the layout's schema and budgets.
 * @typedef {object} SlideSpec
 * @property {typeof LAYOUT_IDS[number]} layout
 * @property {Record<string, any>} fields
 */

/**
 * @typedef {object} CarouselSpec
 * @property {string} title
 * @property {SlideSpec[]} slides
 * @property {BrandConfig} [brand]
 * @property {keyof typeof IMAGE_SIZES} [size]
 * @property {{file:string, thumb:string, width:number, height:number}[]} [rendered]  Filled after rendering.
 */

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * The words for one channel.
 * @typedef {object} ChannelCopy
 * @property {string} [caption]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string[]} [hashtags]
 */

/**
 * Limits for one channel, from Dandelion's public rules.
 * @typedef {object} ChannelLimits
 * @property {number} [caption_max]
 * @property {number} [title_max]
 * @property {number} [description_max]
 * @property {number} [hashtags_max]
 * @property {number} [hashtags_ideal]
 */

/**
 * The offer to post: content plus a draft for each channel.
 * @typedef {object} PostBundle
 * @property {string} id
 * @property {typeof POST_KINDS[number]} kind
 * @property {string[]} files              Absolute paths of images or videos (empty for text only).
 * @property {string} [text]               The original text the agent wrote.
 * @property {string} [project_id]
 * @property {Record<string, {copy: ChannelCopy, warnings: string[]}>} channels  Keyed by CHANNEL_IDS.
 * @property {number} created_at           Unix ms.
 */

/**
 * What the post card needs to know about the Dandelion account.
 * @typedef {object} DandelionState
 * @property {boolean} connected
 * @property {string} [plan]
 * @property {{id:string,name:string}[]} [brands]
 * @property {{id:string,platform:string,handle:string,can_post:boolean}[]} [channels]
 * @property {{platform:string,url:string}[]} [connect_links]
 */

// ---------------------------------------------------------------------------
// Tool results
// ---------------------------------------------------------------------------

/**
 * What every kit tool returns. The text is always readable on its own.
 * @typedef {object} ToolResult
 * @property {{type:'text', text:string}[]} content
 * @property {Record<string, any>} [structuredContent]   Under 50 KB. Media goes through read_asset.
 * @property {boolean} [isError]
 */

/**
 * One chunk from read_asset.
 * @typedef {object} AssetChunk
 * @property {string} data                 Base64.
 * @property {string} mime
 * @property {number} total                Total bytes of the file.
 * @property {boolean} has_more
 */

export {};
