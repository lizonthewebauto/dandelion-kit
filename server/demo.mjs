// Demo mode: `kit serve --demo` answers every tool with the sample data the cards were designed against
// (server/widgets/fixtures.mjs). It lets a person, or a test, look at all eight cards in an MCP host without
// a video, ffmpeg, a long render or a Dandelion account. Nothing is read from or written to real projects.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { detectFfmpeg, runFfmpeg } from '../core/media/ffmpeg.mjs';
import { ensureDir, isFile, kitHome } from '../core/util/fs.mjs';
import { CAROUSEL, DEMO_ASSETS, DOCTOR, PROJECT, demoTool, newDemoState } from './widgets/fixtures.mjs';
import { fail, ok } from './lib/kit.mjs';

const CHUNK = 200000;

/** @param {string} s */
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A plain picture for a demo file: a soft gradient and its label.
 * @param {{id: string, label: string, w?: number, h?: number, hue?: number}} a
 */
async function drawJpeg(a) {
  const w = a.w ?? 270;
  const h = a.h ?? 480;
  const hue = a.hue ?? 40;
  const size = Math.max(14, Math.round(Math.min(w, h) * 0.12));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,32%)"/><stop offset="1" stop-color="hsl(${hue + 20},40%,16%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w / 2}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.17}" fill="hsl(${hue - 10},55%,72%)"/>
<text x="${w / 2}" y="${h * 0.8}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${xml(a.label)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

/** A 4 second test video, or null when ffmpeg is not installed. */
async function drawVideo() {
  const dir = ensureDir(join(kitHome(), 'demo'));
  const file = join(dir, 'demo.mp4');
  if (!isFile(file)) {
    const ff = await detectFfmpeg();
    if (!ff.found) return null;
    try {
      await runFfmpeg([
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=15:duration=4',
        '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '32k', '-t', '4', '-movflags', '+faststart', file,
      ]);
    } catch {
      return null;
    }
  }
  return readFile(file);
}

/** @type {Map<string, {mime: string, bytes: Buffer}>} */
const assetCache = new Map();

/** @param {string} id */
async function demoAsset(id) {
  const cached = assetCache.get(id);
  if (cached) return cached;
  const def = DEMO_ASSETS.find((a) => a.id === id);
  if (!def) return null;
  /** @type {{mime: string, bytes: Buffer}|null} */
  let made = null;
  if (def.kind === 'mp4') {
    const bytes = await drawVideo();
    if (bytes) made = { mime: 'video/mp4', bytes };
  } else {
    made = { mime: 'image/jpeg', bytes: await drawJpeg(def) };
  }
  if (made) assetCache.set(id, made);
  return made;
}

/**
 * Read one chunk of a demo file in the same shape as the real read_asset.
 * @param {{asset_id: string, offset?: number, bytes?: number}} args
 */
async function demoRead(args) {
  const asset = await demoAsset(args.asset_id);
  if (!asset) return fail(`The demo has no file with id ${args.asset_id}.`);
  const offset = args.offset ?? 0;
  const length = Math.min(args.bytes ?? CHUNK, CHUNK);
  const slice = asset.bytes.subarray(offset, offset + length);
  const chunk = { data: slice.toString('base64'), mime: asset.mime, total: asset.bytes.length, has_more: offset + slice.length < asset.bytes.length };
  return ok(chunk, `${asset.mime}, bytes ${offset} to ${offset + slice.length} of ${asset.bytes.length}${chunk.has_more ? ', more to read' : ''}.`);
}

/** The state a demo server keeps between calls, so taps continue from what is on screen. */
export function newDemoServerState() {
  return newDemoState();
}

/**
 * Answer a tool call with sample data.
 * @param {string} name
 * @param {Record<string, any>} args
 * @param {ReturnType<typeof newDemoState>} state
 * @returns {Promise<import('./lib/kit.mjs').ToolOutcome>}
 */
export async function demoOutcome(name, args, state) {
  switch (name) {
    case 'read_asset':
      return demoRead(/** @type {any} */ (args));
    case 'doctor':
      return ok(JSON.parse(JSON.stringify(DOCTOR)));
    case 'open_video':
      return ok(JSON.parse(JSON.stringify(PROJECT)));
    case 'list_projects':
      return ok({
        projects: [{ id: 'p_demo', type: 'video', title: PROJECT.project.title, updated_at: Date.now(), duration_ms: PROJECT.project.duration_ms, transcript_ready: true, has_final: false }],
      });
    case 'make_carousel':
    case 'make_image': {
      state.carousel = JSON.parse(JSON.stringify(CAROUSEL));
      return ok(JSON.parse(JSON.stringify(state.carousel)));
    }
    default: {
      // render_reel with quality final and make_variants answer "still building" first (PREVIEW_PENDING in fixtures.mjs),
      // so the progress bar and the Check again button can be seen. Ask again and the finished reel comes back.
      const result = demoTool(name, args, state);
      if (result.isError) return fail(result.content[0].text);
      return ok(/** @type {any} */ (result).structuredContent);
    }
  }
}
