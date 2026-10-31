// Cut list, camera, grade and captions to an ffmpeg filter graph.
//   1. Each kept piece is trimmed out of the work copy by frame number and the pieces are joined.
//   2. The camera is one moving zoom: the frame is scaled up by z(t) and cropped back to size, so punch-ins
//      and slow pushes are smooth and cost one filter, not one per move.
//   3. A small color grade from the look, then the captions (libass) on top.
// The graph is written to a file and passed with -/filter_complex, so a long cut list never hits a command line limit.
import { PUNCH_RISE_MS } from '../edit/camera.mjs';
import { getLook } from '../edit/looks.mjs';

export const QUALITY = Object.freeze({
  draft: Object.freeze({
    width: 540,
    height: 960,
    fps: 15,
    crf: 30,
    preset: 'ultrafast',
    audio_bitrate: '96k',
  }),
  final: Object.freeze({
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 20,
    preset: 'medium',
    audio_bitrate: '160k',
  }),
});

/** Speech peaks are held under this linear level (about -12.4 dBFS) before loudness is set. */
export const SPEECH_PEAK_LIMIT = 0.24;

/** The work copy is constant 30 fps, so cuts land on whole frames. */
export const WORK_FPS = 30;
/** The camera crops with the frame sitting this far down the spare height (faces sit in the upper half). */
export const CROP_BIAS = 0.4;

/**
 * @typedef {object} Segment
 * @property {number} src_frame     First frame in the work copy.
 * @property {number} frames        Length in frames (at least 1).
 * @property {number} out_frame     First frame in the cut timeline.
 */

/**
 * Snap the pieces to whole frames. Output boundaries are rounded from the plan's times, so rounding never
 * adds up: the cut timeline stays within half a frame of the plan at every cut.
 * @param {import('../types.mjs').Piece[]} pieces
 * @param {number} [fps]
 * @returns {{segments: Segment[], total_frames: number}}
 */
export function snapPieces(pieces, fps = WORK_FPS) {
  /** @type {Segment[]} */
  const segments = [];
  let cursor = 0;
  for (const p of pieces) {
    const outEnd = Math.round((p.out_end_ms * fps) / 1000);
    const frames = outEnd - cursor;
    if (frames <= 0) continue;
    segments.push({ src_frame: Math.round((p.src_start_ms * fps) / 1000), frames, out_frame: cursor });
    cursor += frames;
  }
  return { segments, total_frames: cursor };
}

/** @param {number} n */
const num = (n) => Number(n.toFixed(5)).toString();

/**
 * The zoom at time t (seconds) as an ffmpeg expression, written as a balanced tree of if() calls.
 * @param {import('../types.mjs').CameraMove[]} camera
 * @returns {string}
 */
export function zoomExpression(camera) {
  const moves = camera.filter((m) => m.out_end_ms > m.out_start_ms);
  if (moves.length === 0) return '1';
  const single = (m) => {
    if (m.zoom_from === m.zoom_to || m.kind === 'wide') return num(m.zoom_from);
    const s = m.out_start_ms / 1000;
    const span = m.kind === 'creep' ? (m.out_end_ms - m.out_start_ms) / 1000 : PUNCH_RISE_MS / 1000;
    return `${num(m.zoom_from)}+${num(m.zoom_to - m.zoom_from)}*clip((t-${num(s)})/${num(span)},0,1)`;
  };
  const build = (lo, hi) => {
    if (lo === hi) return single(moves[lo]);
    const mid = (lo + hi) >> 1;
    return `if(lt(t,${num(moves[mid + 1].out_start_ms / 1000)}),${build(lo, mid)},${build(mid + 1, hi)})`;
  };
  return build(0, moves.length - 1);
}

/**
 * The color grade for a look as filters (empty when the look leaves color alone).
 * @param {string} lookId
 * @returns {string[]}
 */
export function gradeFilters(lookId) {
  let grade;
  try {
    grade = getLook(lookId).grade;
  } catch {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  if (Math.abs(grade.saturation - 1) > 0.005 || Math.abs(grade.contrast - 1) > 0.005) {
    out.push(`eq=saturation=${num(grade.saturation)}:contrast=${num(grade.contrast)}`);
  }
  if (Math.abs(grade.warmth) > 0.005) {
    const w = Math.max(-0.5, Math.min(0.5, grade.warmth * 0.5));
    out.push(`colorbalance=rm=${num(w)}:bm=${num(-w)}:rh=${num(w / 2)}:bh=${num(-w / 2)}`);
  }
  return out;
}

/**
 * Build the video graph.
 * @param {object} input
 * @param {Segment[]} input.segments
 * @param {import('../types.mjs').CameraMove[]} input.camera
 * @param {string} input.look_id
 * @param {'draft'|'final'} input.quality
 * @param {string} [input.ass_file]    Relative path of the .ass file (ffmpeg runs in its folder).
 * @param {string} [input.fonts_dir]   Relative path of the fonts folder.
 * @returns {string}  The filter graph text. Input 0 is the work copy. The result is labeled [vout].
 */
export function buildVideoGraph({
  segments,
  camera,
  look_id,
  quality,
  ass_file = 'captions.ass',
  fonts_dir = 'fonts',
}) {
  if (segments.length === 0) throw new Error('There is nothing to render: the cut has no pieces.');
  const q = QUALITY[quality];
  const n = segments.length;
  const lines = [];
  if (n === 1) {
    lines.push(`[0:v]null[v0]`);
  } else {
    lines.push(`[0:v]split=${n}${segments.map((_, i) => `[v${i}]`).join('')}`);
  }
  segments.forEach((s, i) => {
    lines.push(
      `[v${i}]trim=start_frame=${s.src_frame}:end_frame=${s.src_frame + s.frames},setpts=PTS-STARTPTS[t${i}]`,
    );
  });
  lines.push(`${segments.map((_, i) => `[t${i}]`).join('')}concat=n=${n}:v=1:a=0[cat]`);

  /** @type {string[]} */
  const chain = [];
  if (quality === 'draft') chain.push(`fps=${q.fps}`, `scale=${q.width}:${q.height}:flags=bilinear`);
  const z = zoomExpression(camera);
  if (z !== '1') {
    chain.push(
      `scale=w='trunc(${q.width}*(${z})/2)*2':h='trunc(${q.height}*(${z})/2)*2':eval=frame:flags=bicubic`,
      `crop=${q.width}:${q.height}:(in_w-${q.width})/2:(in_h-${q.height})*${CROP_BIAS}`,
    );
  }
  chain.push(...gradeFilters(look_id));
  chain.push(`ass=${ass_file}:fontsdir=${fonts_dir}`, 'format=yuv420p');
  lines.push(`[cat]${chain.join(',')}[vout]`);
  return lines.join(';\n') + '\n';
}

/**
 * Build the speech graph: the pieces cut out of the sound track, with a tiny fade at each cut so nothing clicks.
 * @param {Segment[]} segments
 * @param {number} [rate]   Sample rate of the sound file.
 * @returns {string}  Input 0 is the wav. The result is labeled [speech].
 */
export function buildSpeechGraph(segments, rate = 48000) {
  const n = segments.length;
  const per = rate / WORK_FPS;
  const fade = 0.005;
  const lines = [];
  lines.push(n === 1 ? `[0:a]anull[a0]` : `[0:a]asplit=${n}${segments.map((_, i) => `[a${i}]`).join('')}`);
  segments.forEach((s, i) => {
    const start = Math.round(s.src_frame * per);
    const end = Math.round((s.src_frame + s.frames) * per);
    const dur = (end - start) / rate;
    const f = Math.min(fade, dur / 3);
    lines.push(
      `[a${i}]atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS,afade=t=in:d=${num(f)},afade=t=out:st=${num(Math.max(0, dur - f))}:d=${num(f)}[s${i}]`,
    );
  });
  lines.push(`${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${n}:v=0:a=1[joined]`);
  // Spoken words have sharp peaks (plosives, claps). Trim them to about -12 dBFS so the loudness pass can reach -14 LUFS
  // without pushing the peaks past the -1 dBTP ceiling.
  lines.push(`[joined]alimiter=limit=${SPEECH_PEAK_LIMIT}:attack=2:release=40:level=false[speech]`);
  return lines.join(';\n') + '\n';
}
