// Quality checks measured on the finished file (not on the plan), so what is reported is what a viewer gets.
// Each check says pass, warn or stop, shows the number it measured and the limit, and says how to fix a miss.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HOOK_CARD_MS } from '../edit/shotplan.mjs';
import { visualEvents } from '../edit/pacing.mjs';
import { captureFfmpeg, runFfprobe } from '../media/ffmpeg.mjs';
import { makeTempDir } from '../util/fs.mjs';
import { buildAss, fontFilesFor, HOOK_STYLE, readableOn, SAFE_ZONE, THEME_STYLES, PLAY } from './ass.mjs';
import { chinAtZoom, maxZoomOf } from './facezone.mjs';
import { QUALITY } from './filtergraph.mjs';
import { ffmpegLog, streamRawFrames } from './run.mjs';

export const CHECK_LIMITS = Object.freeze({
  duration_tolerance_ms: 200,
  loudness_lufs: { min: -15, max: -13 },
  loudness_soft_lufs: 1.5,
  true_peak_db: -1,
  silent_lufs: -50,
  tail_luma_min: 12,
  tail_ms: 500,
  motion_min: 2,
  motion_times_ms: [250, 1000, 1800],
  static_gap_max_ms: 4000,
  contrast_min: 4.5,
});

/** @param {import('../types.mjs').Check['status']} status @param {string} id @param {string} label @param {number|string|boolean|null} measured @param {number|string|null} limit @param {string} [fix] */
function check(status, id, label, measured, limit, fix) {
  /** @type {import('../types.mjs').Check} */
  const c = { id, status, label, measured, limit };
  if (fix && status !== 'pass') c.fix = fix;
  return c;
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/**
 * Integrated loudness and true peak of a file.
 * @param {string} file
 * @returns {Promise<{lufs: number | null, true_peak: number | null}>}
 */
export async function measureLoudness(file) {
  const log = await ffmpegLog(['-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const i = /I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary);
  const tp = /Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary);
  const parse = (m) => (m && Number.isFinite(Number(m[1])) ? Number(m[1]) : null);
  return { lufs: parse(i), true_peak: parse(tp) };
}

/**
 * Average brightness (0 to 255) of the last `ms` of a video.
 * @param {string} file
 * @param {number} duration_ms
 * @param {number} ms
 */
export async function measureTailLuma(file, duration_ms, ms = CHECK_LIMITS.tail_ms) {
  const start = Math.max(0, duration_ms - ms) / 1000;
  let sum = 0;
  let count = 0;
  const size = 32 * 56;
  await streamRawFrames(
    [
      '-ss',
      start.toFixed(3),
      '-i',
      file,
      '-an',
      '-vf',
      'scale=32:56,format=gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    size,
    (frame) => {
      let s = 0;
      for (let i = 0; i < size; i++) s += frame[i];
      sum += s / size;
      count += 1;
    },
  );
  return count ? sum / count : 0;
}

/**
 * Grayscale pixels of the frame at a time, scaled down.
 * @param {string} file
 * @param {number} t_ms
 * @param {string} vf  Filter chain ending in format=gray.
 */
async function grayFrame(file, t_ms, vf) {
  return captureFfmpeg([
    '-ss',
    (t_ms / 1000).toFixed(3),
    '-i',
    file,
    '-an',
    '-frames:v',
    '1',
    '-vf',
    vf,
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
}

/**
 * How much the picture changes between the frames at the given times (mean absolute difference, 0 to 255).
 * @param {string} file
 * @param {number[]} times_ms
 */
export async function measureMotion(file, times_ms = CHECK_LIMITS.motion_times_ms) {
  const frames = [];
  for (const t of times_ms) frames.push(await grayFrame(file, t, 'scale=72:128,format=gray'));
  /** @type {number[]} */
  const diffs = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const n = Math.min(a.length, b.length);
    if (n === 0) continue;
    let s = 0;
    for (let k = 0; k < n; k++) s += Math.abs(a[k] - b[k]);
    diffs.push(s / n);
  }
  return diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : 0;
}

/**
 * Draw the plan's captions on black with libass and find the box they cover. This is measured, not guessed
 * from font sizes, so the numbers include outlines, boxes and shadows.
 * @param {import('../types.mjs').ShotPlan} plan
 * @returns {Promise<{x_min: number, x_max: number, y_min: number, y_max: number, frames: number} | null>}
 */
export async function measureCaptionBounds(plan) {
  if (!plan.captions.length) return null;
  const dir = makeTempDir('kit-caps-');
  try {
    mkdirSync(join(dir, 'fonts'));
    for (const f of fontFilesFor()) copyFileSync(f, join(dir, 'fonts', basename(f)));
    // Captions only: the hook card is checked from its own layout.
    const noHook = {
      ...plan,
      beats: plan.beats.map((b) => ({
        ...b,
        screen_text: undefined,
        treatment: b.treatment === 'hook-card' ? 'face' : b.treatment,
      })),
    };
    writeFileSync(join(dir, 'c.ass'), buildAss(noHook, { captions: true }).text);
    const w = 540;
    const h = 960;
    const fps = 5;
    const scale = PLAY.width / w;
    let x0 = Infinity;
    let x1 = -1;
    let y0 = Infinity;
    let y1 = -1;
    const frames = await streamRawFrames(
      [
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${w}x${h}:r=${fps}:d=${(plan.duration_ms / 1000).toFixed(2)}`,
        '-vf',
        'ass=c.ass:fontsdir=fonts,format=gray',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      w * h,
      (frame) => {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            if (frame[row + x] > 40) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
      },
      // Run ffmpeg in the folder so the .ass and fonts paths stay relative.
      { cwd: dir },
    );
    if (x1 < 0) return { x_min: 0, x_max: 0, y_min: 0, y_max: 0, frames };
    return {
      x_min: Math.floor(x0 * scale),
      x_max: Math.ceil((x1 + 1) * scale),
      y_min: Math.floor(y0 * scale),
      y_max: Math.ceil((y1 + 1) * scale),
      frames,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Relative luminance of "#RRGGBB". @param {string} hex */
function luminanceOf(hex) {
  const h = hex.replace('#', '');
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}

/** Contrast ratio between two luminances. */
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Worst contrast between caption text and what it sits on. Text with a stroke or box is measured against the
 * stroke or box; the frame behind is sampled at a few cues and blended in where the box is see-through.
 * @param {string} file
 * @param {import('../types.mjs').ShotPlan} plan
 * @param {{y_min: number, y_max: number}} bounds
 * @param {number} width
 */
export async function measureCaptionContrast(file, plan, bounds, width) {
  const style = THEME_STYLES[plan.caption_theme];
  const fill = style.text ?? '#FFFFFF';
  const accent = plan.accent || '#FFD93D';
  const stroke = style.stroke ?? '#000000';
  const k = width / PLAY.width;
  const cues = plan.captions;
  if (!cues.length) return null;
  const picks = [0.2, 0.5, 0.8].map((f) => cues[Math.min(cues.length - 1, Math.floor(cues.length * f))]);
  let worst = Infinity;
  for (const cue of picks) {
    const t = (cue.start_ms + cue.end_ms) / 2;
    const y = Math.round(bounds.y_min * k);
    const h = Math.max(2, Math.round((bounds.y_max - bounds.y_min) * k));
    const px = await grayFrame(
      file,
      t,
      `crop=${Math.round(PLAY.width * k)}:${h}:0:${y},scale=1:1:flags=area,format=gray`,
    );
    const frameL = ((px[0] ?? 128) / 255) ** 2.2;
    const fillL = luminanceOf(fill);
    let backL;
    if (style.box) {
      const a = 1 - (style.box_alpha ?? 80) / 255;
      backL = luminanceOf(stroke) * a + frameL * (1 - a);
    } else if (style.outline >= 3) backL = luminanceOf(stroke);
    else backL = frameL;
    worst = Math.min(worst, contrast(fillL, backL));
    if (plan.caption_theme.startsWith('karaoke') || plan.caption_theme === 'bold-stroke')
      worst = Math.min(worst, contrast(luminanceOf(accent), backL));
    if (style.mode === 'pill')
      worst = Math.min(worst, contrast(luminanceOf(readableOn(accent)), luminanceOf(accent)));
  }
  return Number.isFinite(worst) ? worst : null;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * Check a finished reel.
 * @param {object} input
 * @param {string} input.file
 * @param {import('../types.mjs').ShotPlan} input.plan
 * @param {'draft'|'final'} input.quality
 * @param {number[]} [input.cut_points_ms]   Where jump cuts fall on the cut timeline; they count as visual changes.
 * @returns {Promise<import('../types.mjs').Check[]>}
 */
export async function checkReel({ file, plan, quality, cut_points_ms = [] }) {
  const q = QUALITY[quality];
  /** @type {import('../types.mjs').Check[]} */
  const checks = [];

  // Encode facts
  const probe = JSON.parse(
    await runFfprobe(['-print_format', 'json', '-show_streams', '-show_format', file]),
  );
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const [num, den] = String(video?.avg_frame_rate ?? '0/1')
    .split('/')
    .map(Number);
  const fps = den ? num / den : 0;
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);
  const encodeOk =
    video?.codec_name === 'h264' && width === q.width && height === q.height && Math.abs(fps - q.fps) < 0.5;
  checks.push(
    check(
      encodeOk ? 'pass' : 'stop',
      'encode',
      `Video is h264 ${q.width}x${q.height} at ${q.fps} fps`,
      `${video?.codec_name ?? 'none'} ${width}x${height} ${round(fps, 2)} fps`,
      `h264 ${q.width}x${q.height} ${q.fps} fps`,
      'Render again with the same quality setting.',
    ),
  );
  const rate = Number(audio?.sample_rate ?? 0);
  checks.push(
    check(
      audio && rate === 48000 ? 'pass' : 'stop',
      'audio-format',
      'Sound is 48 kHz',
      audio ? `${audio.codec_name} ${rate} Hz` : 'no sound',
      '48000 Hz',
      'Render again; the sound track is missing or the wrong rate.',
    ),
  );

  const durationMs = Math.round(Number(probe.format?.duration ?? 0) * 1000);
  const drift = Math.abs(durationMs - plan.duration_ms);
  checks.push(
    check(
      drift <= CHECK_LIMITS.duration_tolerance_ms ? 'pass' : 'stop',
      'duration',
      'Length matches the plan',
      `${durationMs} ms (off by ${drift} ms)`,
      `within ${CHECK_LIMITS.duration_tolerance_ms} ms of ${plan.duration_ms} ms`,
      'Render again. If it repeats, rebuild the shot plan.',
    ),
  );

  // Sound
  const loud = await measureLoudness(file);
  if (loud.lufs === null) {
    checks.push(
      check(
        'stop',
        'loudness',
        'Speech is not silent',
        'silent',
        `above ${CHECK_LIMITS.silent_lufs} LUFS`,
        'The sound track is silent. Check the original video has audio.',
      ),
    );
  } else {
    const { min, max } = CHECK_LIMITS.loudness_lufs;
    const off = loud.lufs < min ? min - loud.lufs : loud.lufs > max ? loud.lufs - max : 0;
    const status =
      loud.lufs <= CHECK_LIMITS.silent_lufs
        ? 'stop'
        : off === 0
          ? 'pass'
          : off <= CHECK_LIMITS.loudness_soft_lufs
            ? 'warn'
            : 'stop';
    checks.push(
      check(
        status,
        'loudness',
        'Loudness is about -14 LUFS',
        `${round(loud.lufs)} LUFS`,
        `${min} to ${max} LUFS`,
        'Render again; the loudness pass may have been skipped.',
      ),
    );
  }
  if (loud.true_peak !== null) {
    const tp = loud.true_peak;
    checks.push(
      check(
        tp <= CHECK_LIMITS.true_peak_db ? 'pass' : tp <= 0 ? 'warn' : 'stop',
        'true-peak',
        'Loudest peak leaves headroom',
        `${round(tp)} dBTP`,
        `at most ${CHECK_LIMITS.true_peak_db} dBTP`,
        'Lower the sound effect level or render again.',
      ),
    );
  }

  // Picture
  const tail = await measureTailLuma(file, durationMs);
  checks.push(
    check(
      tail > CHECK_LIMITS.tail_luma_min ? 'pass' : 'warn',
      'not-dark-tail',
      'The last half second is not black',
      round(tail),
      `above ${CHECK_LIMITS.tail_luma_min}`,
      'The reel ends on a dark frame. Trim the end of the cut.',
    ),
  );

  // Captions: measured bounds and where they sit against the face
  const bounds = await measureCaptionBounds(plan);
  if (bounds) {
    const inside =
      bounds.x_min >= SAFE_ZONE.x_min &&
      bounds.x_max <= SAFE_ZONE.x_max &&
      bounds.y_min >= SAFE_ZONE.y_min &&
      bounds.y_max <= SAFE_ZONE.y_max;
    checks.push(
      check(
        inside ? 'pass' : 'stop',
        'captions-safe-zone',
        'Captions stay inside the safe zone',
        `x ${bounds.x_min}-${bounds.x_max}, y ${bounds.y_min}-${bounds.y_max}`,
        `x ${SAFE_ZONE.x_min}-${SAFE_ZONE.x_max}, y ${SAFE_ZONE.y_min}-${SAFE_ZONE.y_max}`,
        'Pick a calmer caption theme or shorten the words on screen.',
      ),
    );
    const anchor = /** @type {any} */ (plan.caption_anchor);
    if (anchor?.source === 'face' && typeof anchor.chin_y === 'number') {
      const chinOut = chinAtZoom(anchor.chin_y, maxZoomOf(plan));
      const gap = bounds.y_min - chinOut;
      checks.push(
        check(
          gap >= 0 ? 'pass' : 'warn',
          'captions-under-chin',
          'Captions sit below your chin',
          `${Math.round(gap)} px below`,
          'at least 0 px',
          'Run the face step again, or pick a look with a gentler camera.',
        ),
      );
    } else {
      checks.push(
        check(
          'warn',
          'captions-under-chin',
          'Captions sit below your chin',
          anchor?.note ?? 'no face found, fixed height used',
          'a face found in 60% of the video',
          'I could not find your face in enough of the video. Captions sit at a fixed height; check the frames by eye.',
        ),
      );
    }
    const ratio = await measureCaptionContrast(file, plan, bounds, width || q.width).catch(() => null);
    if (ratio !== null) {
      checks.push(
        check(
          ratio >= CHECK_LIMITS.contrast_min ? 'pass' : 'warn',
          'caption-contrast',
          'Caption words are easy to read',
          `${round(ratio)}:1`,
          `at least ${CHECK_LIMITS.contrast_min}:1`,
          'Pick a caption theme with a stroke or a box.',
        ),
      );
    }
  }

  // Opening
  const first = plan.beats[0];
  const hookCard = first?.treatment === 'hook-card';
  const hookText = (first?.screen_text ?? plan.hook?.text ?? '').trim();
  if (hookCard && hookText) {
    const hookEvent = buildAss(plan, { captions: false }).layout.hook;
    checks.push(
      check(
        hookEvent ? 'pass' : 'stop',
        'hook-text',
        'Hook text is on screen in the first 2 seconds',
        hookEvent ? `"${hookText}"` : 'missing',
        `shown by ${HOOK_CARD_MS / 1000} s`,
        'Add hook text in the shot plan.',
      ),
    );
  } else if (hookText) {
    checks.push(
      check(
        'pass',
        'hook-text',
        'Opens on the spoken hook (no text card)',
        'cold open',
        'a hook in the first 2 seconds',
        'Add hook text if you want it on screen.',
      ),
    );
  } else {
    checks.push(
      check(
        'warn',
        'hook-text',
        'Hook text is on screen in the first 2 seconds',
        'none',
        `shown by ${HOOK_CARD_MS / 1000} s`,
        'Add hook text in the shot plan.',
      ),
    );
  }
  if (hookCard && hookText) {
    const hookBox = buildAss(plan, { captions: false }).layout.hook;
    if (hookBox && hookBox.clearance_px !== null) {
      checks.push(
        check(
          hookBox.clearance_px >= HOOK_STYLE.face_clearance ? 'pass' : 'warn',
          'hook-clear-of-face',
          'Hook card stays clear of your head',
          `${hookBox.clearance_px} px above your head`,
          `at least ${HOOK_STYLE.face_clearance} px`,
          'Your head is high in the frame. Use a shorter hook, or frame the shot a little lower.',
        ),
      );
    }
  }
  if (durationMs > 2000) {
    const motion = await measureMotion(file);
    checks.push(
      check(
        motion >= CHECK_LIMITS.motion_min ? 'pass' : 'warn',
        'first-2s-motion',
        'Something moves in the first 2 seconds',
        round(motion, 2),
        `at least ${CHECK_LIMITS.motion_min}`,
        'The opening is nearly still. Start on a stronger push or a cut.',
      ),
    );
  }

  // Pace
  const extra = [...cut_points_ms];
  if (hookCard) extra.push(HOOK_CARD_MS);
  const events = [...visualEvents(plan.camera, extra), plan.duration_ms].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < events.length; i++) gap = Math.max(gap, events[i] - events[i - 1]);
  checks.push(
    check(
      gap <= CHECK_LIMITS.static_gap_max_ms ? 'pass' : 'warn',
      'static-gap',
      'No long stretch without a change',
      `${round(gap / 1000)} s`,
      `at most ${CHECK_LIMITS.static_gap_max_ms / 1000} s`,
      'Add a punch-in or a cut in the long still stretch.',
    ),
  );

  return checks;
}

/** One line per check, for text output. @param {import('../types.mjs').Check[]} checks */
export function checksTable(checks) {
  const mark = { pass: 'PASS', warn: 'WARN', stop: 'STOP' };
  return checks
    .map(
      (c) =>
        `${mark[c.status]}  ${c.label}: ${c.measured} (limit ${c.limit})${c.fix && c.status !== 'pass' ? ` - ${c.fix}` : ''}`,
    )
    .join('\n');
}
