// One local JPEG lets the host AI see images and video frames together.
import sharp from 'sharp';
import { atomicWriteFile } from '../util/fs.mjs';

const BACKGROUND = '#17202A';
const MAX_BYTES = 499000;
const escapeText = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/**
 * The caller supplies short index labels that match its sample list. No source file is copied.
 * @param {{path:string,label:string}[]} tiles
 * @param {string} outFile
 * @returns {Promise<{file:string,buffer:Buffer,width:number,height:number}>}
 */
export async function createContactSheet(tiles, outFile) {
  if (!tiles.length || tiles.length > 220) throw new Error('A sample picture needs 1 to 220 image tiles.');
  const columns = Math.min(tiles.length, Math.max(1, Math.min(12, Math.ceil(Math.sqrt(tiles.length * 0.8)))));
  const rows = Math.ceil(tiles.length / columns);
  const tileWidth = Math.max(32, Math.floor(Math.min(400, 1600 / columns, 2400 / (rows * 1.25))));
  const tileHeight = Math.round(tileWidth * 1.25);
  const composites = [];
  for (const [index, tile] of tiles.entries()) {
    const label = escapeText(tile.label.trim().slice(0, 28) || String(index + 1));
    const fontSize = Math.max(10, Math.min(19, Math.round(tileWidth * 0.048)));
    const badgeWidth = Math.min(tileWidth - 8, Math.max(fontSize * 2, Math.ceil(Math.min(tile.label.length || 1, 28) * fontSize * 0.66 + 14)));
    const badgeHeight = fontSize + 10;
    const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}"><rect x="4" y="4" width="${badgeWidth}" height="${badgeHeight}" rx="3" fill="${BACKGROUND}" fill-opacity="0.94"/><text x="10" y="${fontSize + 7}" font-family="sans-serif" font-size="${fontSize}" fill="white">${label}</text></svg>`);
    const image = await sharp(tile.path).rotate().resize(tileWidth - 4, tileHeight - 4, { fit: 'contain', background: BACKGROUND })
      .flatten({ background: BACKGROUND }).extend({ top: 2, bottom: 2, left: 2, right: 2, background: BACKGROUND })
      .composite([{ input: badge, left: 0, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
    composites.push({ input: image, left: index % columns * tileWidth, top: Math.floor(index / columns) * tileHeight });
  }
  const width = columns * tileWidth, height = rows * tileHeight;
  const raw = await sharp({ create: { width, height, channels: 3, background: BACKGROUND } }).composite(composites).raw().toBuffer({ resolveWithObject: true });
  let size = width;
  while (true) {
    const result = await sharp(raw.data, { raw: { width, height, channels: raw.info.channels } }).resize({ width: size })
      .toColourspace('srgb').jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (result.data.length < MAX_BYTES) {
      await atomicWriteFile(outFile, result.data, { mode: 0o600 });
      return { file: outFile, buffer: result.data, width: result.info.width, height: result.info.height };
    }
    if (size <= 64) throw new Error('The sample picture could not fit in the size limit. Try fewer samples.');
    size = Math.max(64, Math.floor(size * 0.82));
  }
}
