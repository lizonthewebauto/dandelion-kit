// Measured sample numbers to small saved choices. The person's AI chooses the rest.
import { contrast, mix, readableOn } from '../carousel/color.mjs';

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Median of finite sample values, or null when there is no measurement. */
function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build suggestions from measurements. Never infer cadence from a short or single shot clip.
 * @param {any[]} [images]
 * @param {any[]} [videos]
 * @returns {import('./schema.mjs').StyleInput}
 */
export function suggestStyle(images = [], videos = []) {
  /** @type {import('./schema.mjs').StyleInput} */
  const style = {};
  const image = images[0];
  if (image) {
    const bg = image.bg_hex;
    const fg = contrast(bg, image.text_hex) >= 4.5 ? image.text_hex : readableOn(bg, [image.text_hex]);
    const muted = mix(bg, fg, 0.65);
    style.brand = { colors: { bg, fg, accent: image.accent_hex, muted: contrast(bg, muted) >= 4.5 ? muted : fg } };
  }
  if (!videos.length) return style;
  /** @type {NonNullable<import('./schema.mjs').StyleInput['video']>} */
  const video = {};
  /** @type {NonNullable<typeof video.overrides>} */
  const overrides = {};
  const cadence = videos.filter((v) => v.duration_ms >= 8000 && Array.isArray(v.cut_times_ms) && v.cut_times_ms.length >= 3 &&
    finite(v.shot_ms?.p25) && finite(v.shot_ms?.median) && finite(v.shot_ms?.p75) && finite(v.cuts_per_10s));
  if (cadence.length) {
    const p25 = /** @type {number} */ (median(cadence.map((v) => v.shot_ms.p25)));
    const p75 = /** @type {number} */ (median(cadence.map((v) => v.shot_ms.p75)));
    const shot = /** @type {number} */ (median(cadence.map((v) => v.shot_ms.median)));
    const cuts = /** @type {number} */ (median(cadence.map((v) => v.cuts_per_10s)));
    overrides.cut_every_ms_min = Math.round(clamp(p25, 800, 6000));
    overrides.cut_every_ms_max = Math.round(clamp(p75, overrides.cut_every_ms_min + 600, 9000));
    overrides.camera_aggression = shot < 2000 ? 'bold' : shot < 3500 ? 'standard' : 'calm';
    video.base_look = overrides.camera_aggression === 'bold' ? 'bold-value' : overrides.camera_aggression === 'calm' ? 'minimal-educator' : 'karaoke-clean';
    const target = clamp(Math.round(cuts + 1), 3, 8);
    overrides.density_per_10s = { min: Math.max(3, target - 2), target, max: Math.min(8, target + 2) };
  }
  const pause = median(videos.filter((v) => v.speech === 'measured' && finite(v.word_count) && v.word_count >= 20).map((v) => v.pause_ms?.p90));
  if (pause !== null) video.rough_cut = pause < 450 ? 'punchy' : pause < 800 ? 'standard' : 'gentle';
  const saturation = median(videos.map((v) => v.grade?.saturation));
  const deviation = median(videos.map((v) => v.grade?.contrast));
  const warmth = median(videos.map((v) => v.grade?.warmth));
  /** @type {NonNullable<typeof overrides.grade>} */
  const grade = {};
  if (saturation !== null) grade.saturation = saturation < 0.18 ? 0.95 : saturation < 0.32 ? 1.05 : 1.12;
  if (deviation !== null) grade.contrast = deviation < 0.18 ? 1 : deviation < 0.26 ? 1.05 : 1.1;
  if (warmth !== null) grade.warmth = warmth > 0.08 ? 0.06 : warmth < -0.08 ? -0.06 : 0;
  if (Object.keys(grade).length) overrides.grade = grade;
  if (image) video.accent = image.accent_hex;
  if (Object.keys(overrides).length) video.overrides = overrides;
  if (Object.keys(video).length) style.video = video;
  return style;
}
