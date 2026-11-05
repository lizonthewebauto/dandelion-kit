// Local pixel measurements. The host AI chooses fonts and other visual details.
import sharp from 'sharp';
import { contrast, luminance, mix, readableOn, toHex } from '../carousel/color.mjs';

const rounded = (n) => Math.round(n * 1000000) / 1000000;
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const saturation = (p) => {
  const hi = Math.max(...p);
  return hi ? (hi - Math.min(...p)) / hi : 0;
};

/** HSV saturation, luma spread and mean red minus blue, each on a 0 to 1 scale (warmth may be negative).
 * @param {Uint8Array} data RGB bytes.
 * @param {number} width
 * @param {number} height
 */
export function pixelStats(data, width, height) {
  const count = width * height;
  if (!count || data.length < count * 3) throw new Error('The image needs RGB pixels and a size.');
  let s = 0, luma = 0, squares = 0, warmth = 0;
  for (let i = 0; i < count; i++) {
    const rgb = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    const y = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
    s += saturation(rgb); luma += y; squares += y * y; warmth += (rgb[0] - rgb[2]) / 255;
  }
  return { saturation: rounded(s / count), contrast: rounded(Math.sqrt(Math.max(0, squares / count - (luma / count) ** 2))), warmth: rounded(warmth / count) };
}

/** Fixed-seed first point, then farthest-point starts keep even small accent colors in view. */
function clustersFor(pixels) {
  let seed = 173;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  let centers = [pixels[seed % pixels.length].slice()];
  while (centers.length < 6) {
    let best = -1, point = pixels[0];
    for (const p of pixels) {
      const d = Math.min(...centers.map((c) => distance(p, c)));
      if (d > best) { best = d; point = p; }
    }
    if (best < 9) break;
    centers.push(point.slice());
  }
  const labels = new Uint8Array(pixels.length);
  for (let round = 0; round < 20; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      let best = Infinity, label = 0;
      for (let j = 0; j < centers.length; j++) {
        const d = distance(pixels[i], centers[j]);
        if (d < best) { best = d; label = j; }
      }
      labels[i] = label;
      const sum = sums[label];
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[i][channel];
      sum[3]++;
    }
    const next = centers.map((c, j) => sums[j][3] ? sums[j].slice(0, 3).map((n) => n / sums[j][3]) : c);
    const stable = next.every((c, j) => distance(c, centers[j]) < 0.01);
    centers = next;
    if (stable) break;
  }
  // Assign once more against the final centers, so counts and labels match exactly.
  const counts = centers.map(() => 0);
  pixels.forEach((p, i) => {
    let nearest = 0;
    for (let j = 1; j < centers.length; j++) if (distance(p, centers[j]) < distance(p, centers[nearest])) nearest = j;
    labels[i] = nearest;
    counts[nearest]++;
  });
  return { centers, labels, counts };
}

/** Sobel luma edges, with adjacent-pixel differences to catch fine repeating marks. */
function edgeDensity(pixels, width, height) {
  if (width < 3 || height < 3) return 0;
  const luma = pixels.map((p) => (p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722) / 255);
  let edges = 0;
  const at = (x, y) => luma[y * width + x];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const gx = -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
    const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
    if (Math.hypot(gx, gy) / 4 > 0.1 || Math.abs(at(x, y) - at(x + 1, y)) > 0.18 || Math.abs(at(x, y) - at(x, y + 1)) > 0.18) edges++;
  }
  return edges / ((width - 2) * (height - 2));
}

/** @param {string} path @returns {Promise<import('../types.mjs').SampleImage>} */
export async function analyzeImage(path) {
  const metadata = await sharp(path).metadata();
  const { data, info } = await sharp(path).rotate().flatten({ background: '#FFFFFF' }).removeAlpha().toColourspace('srgb')
    .resize({ width: 96, height: 96, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' }).raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height;
  const pixels = Array.from({ length: width * height }, (_, i) => Array.from(data.subarray(i * 3, i * 3 + 3)));
  const { centers, labels, counts } = clustersFor(pixels);
  const border = [];
  for (let x = 0; x < width; x++) border.push(x);
  for (let y = 1; y < height; y++) border.push(y * width + width - 1);
  if (height > 1) for (let x = width - 2; x >= 0; x--) border.push((height - 1) * width + x);
  if (width > 1) for (let y = height - 2; y > 0; y--) border.push(y * width);
  const borderCounts = centers.map(() => 0);
  for (const i of border) borderCounts[labels[i]]++;
  const bgIndex = borderCounts.indexOf(Math.max(...borderCounts));
  const bg_hex = toHex(centers[bgIndex]);
  const palette = centers.map((c, i) => ({ hex: toHex(c), share: rounded(counts[i] / pixels.length) }))
    .filter((c) => c.share > 0).sort((a, b) => b.share - a.share || a.hex.localeCompare(b.hex));
  const text_hex = palette.filter((c) => c.share >= 0.005 && c.hex !== bg_hex)
    .sort((a, b) => contrast(b.hex, bg_hex) - contrast(a.hex, bg_hex))[0]?.hex ?? readableOn(bg_hex, []);
  const saturated = centers.map((rgb, i) => ({ hex: toHex(rgb), value: saturation(rgb), share: counts[i] / pixels.length }))
    .sort((a, b) => b.value - a.value || b.share - a.share);
  const accent_hex = saturated.find((c) => c.hex !== bg_hex && c.hex !== text_hex && c.share >= 0.01)?.hex
    ?? saturated.filter((c) => c.hex !== bg_hex && c.hex !== text_hex)[1]?.hex ?? mix(bg_hex, text_hex, 0.45);
  const nearBg = pixels.filter((p) => distance(p, centers[bgIndex]) < 24 ** 2);
  const nonBg = pixels.filter((p) => distance(p, centers[bgIndex]) >= 24 ** 2);
  const meanSaturation = nonBg.length ? nonBg.reduce((sum, p) => sum + saturation(p), 0) / nonBg.length : 0;
  const borderMean = [0, 1, 2].map((c) => border.reduce((sum, i) => sum + pixels[i][c], 0) / border.length);
  const spread = Math.sqrt(border.reduce((sum, i) => sum + distance(pixels[i], borderMean), 0) / border.length);
  const step = border.reduce((sum, i, n) => sum + Math.sqrt(distance(pixels[i], pixels[border[(n + 1) % border.length]])), 0) / border.length;
  const busyness = edgeDensity(pixels, width, height);
  const background = spread < 14 ? 'flat' : step < 12 && busyness < 0.12 ? 'gradient' : 'busy';
  const light = luminance(bg_hex);
  const rotated = (metadata.orientation ?? 1) >= 5 && (metadata.orientation ?? 1) <= 8;
  return {
    path,
    width: (rotated ? metadata.height : metadata.width) ?? width,
    height: (rotated ? metadata.width : metadata.height) ?? height,
    palette, bg_hex, text_hex, accent_hex,
    brightness: light < 0.15 ? 'dark' : light > 0.6 ? 'light' : 'mid',
    saturation: meanSaturation < 0.18 ? 'muted' : meanSaturation > 0.5 ? 'vivid' : 'normal',
    background, whitespace_ratio: rounded(nearBg.length / pixels.length), busyness: rounded(busyness),
  };
}
