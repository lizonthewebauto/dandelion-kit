import { readdir, stat, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { defineTool, fail, cleanPath, z } from '../lib/kit.mjs';
import { createProject, deleteProject, projectDir, registerAsset, updateProject } from '../store/project.mjs';
import { writeJson } from '../../core/util/fs.mjs';
import { analyzeImage } from '../../core/style/analyze-image.mjs';
import { analyzeVideo } from '../../core/style/analyze-video.mjs';
import { suggestStyle } from '../../core/style/map.mjs';
import { createContactSheet } from '../../core/style/contact-sheet.mjs';
import { RUBRICS } from '../../core/style/rubrics.mjs';

const IMAGES = new Set(['.jpg','.jpeg','.png','.webp','.avif','.tif','.tiff','.gif','.heic','.heif','.svg']);
const VIDEOS = new Set(['.mp4','.mov','.m4v','.webm','.mkv','.avi','.mpg','.mpeg','.mts']);
const short = (s) => s.length > 500 ? s.slice(0, 497) + '...' : s;
const sizeOf = (data) => Buffer.byteLength(JSON.stringify(data));

/** The interview is shared by the result text and the server instructions. */
export const STYLE_INTERVIEW = 'Look at the contact sheet and read the numbers. Say what you see in two or three short sentences. Ask one question at a time. First ask: What do you like about this one? Offer the colors, fonts, overall feel, captions, how fast it is cut, or how it opens. They may choose more than one. Borrow only what they choose; leave all other fields out. If cuts are too few, ask: Is it fast and punchy, or calm? Use the rubrics to pick the closest of the eight fonts and the other chosen details, then say why. Ask what to call the style. Next ask if it should be the default. Call save_style with only the chosen parts and liked labels. Show a sample carousel or use pick_look with style on a clip, ask what to adjust, then save again. Never save a full style from one sample without asking first.';

/** Gather files without reading sample contents or following folders inside a folder. */
async function gather(paths) {
  const files = [];
  const skipped = [];
  const seen = new Set();
  let skipped_count = 0;
  const skip = (path, reason) => { skipped_count++; if (skipped.length < 25) skipped.push({ path: short(path), reason }); };
  const add = (path) => {
    const ext = extname(path).toLowerCase();
    if (!IMAGES.has(ext) && !VIDEOS.has(ext)) return skip(path, 'This file is not a sample image or video.');
    if (seen.has(path)) return skip(path, 'This file was already in the list.');
    seen.add(path);
    if (files.length === 20) return skip(path, 'Only the first 20 samples are read.');
    files.push({ path, video: VIDEOS.has(ext) });
  };
  for (const raw of paths) {
    const path = resolve(cleanPath(raw));
    try {
      const info = await stat(path);
      if (info.isFile()) add(path);
      else if (info.isDirectory()) {
        for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
          const child = join(path, entry.name);
          if (entry.isFile()) add(child);
          else skip(child, 'Folders and links inside a sample folder are not read.');
        }
      } else skip(path, 'This path is not a file or a folder.');
    } catch { skip(path, 'This path could not be read. Check that it exists.'); }
  }
  return { files, skipped, get skipped_count() { return skipped_count; }, skip };
}

export const tool = defineTool({
  name: 'analyze_samples', title: 'Learn from samples',
  description: 'Measure one or more sample images or videos and show a JPEG contact sheet for your AI to look at. One sample is enough. Give file paths or a folder; chat attachments in Claude Desktop cannot be read by tools. Samples stay on this computer and are never uploaded or copied. Ask what the person likes before saving only those parts as a style.',
  input: { paths: z.array(z.string()).min(1).max(20) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run({ paths }, ctx) {
    const found = await gather(paths);
    if (!found.files.length) return fail(`No sample images or videos could be read. Skipped ${found.skipped_count} items. Give a file path or a folder.`, { skipped: found.skipped, skipped_count: found.skipped_count });
    const project = await createProject({ type: 'carousel', title: 'Sample readings' });
    await updateProject(project.id, p => { /** @type {any} */ (p).hidden = true; });
    const base = projectDir(project.id);
    const framesDir = join(base, 'sample-frames');
    /** @type {any[]} */
    const images = [];
    /** @type {any[]} */
    const videos = [];
    const tiles = [];
    try {
      for (const [index, item] of found.files.entries()) {
        ctx.signal?.throwIfAborted();
        try {
          if (item.video) {
            const { keyframes, ...video } = await analyzeVideo(item.path, {
              outDir: join(framesDir, String(index)), signal: ctx.signal,
              onProgress: (f, message) => ctx.progress((index + f) / found.files.length * 0.85, message),
            });
            videos.push({ ...video, sample_index: index + 1 });
            for (const frame of keyframes) tiles.push({ path: frame.path, label: `${index + 1}: ${(frame.t_ms / 1000).toFixed(1)}s` });
          } else {
            images.push({ ...await analyzeImage(item.path), sample_index: index + 1 });
            tiles.push({ path: item.path, label: `${index + 1}: image` });
          }
        } catch {
          ctx.signal?.throwIfAborted();
          found.skip(item.path, 'This sample could not be read. Use an image or video that opens on this computer.');
        }
      }
      if (!tiles.length) {
        await deleteProject(project.id);
        return fail(`No sample images or videos could be read. Skipped ${found.skipped_count} items.`, { skipped: found.skipped, skipped_count: found.skipped_count });
      }
      ctx.progress(0.9, 'Making the contact sheet');
      const sheet = await createContactSheet(tiles, join(base, 'contact-sheet.jpg'));
      const sheetAsset = await registerAsset(project, { path: sheet.file, kind: 'sample', label: 'Sample contact sheet' });
      /** @type {Record<string, any>} */
      const data = {
        images, videos, contact_sheet: { asset_id: sheetAsset.id, file: sheet.file },
        suggested_style: suggestStyle(images, videos), rubrics: RUBRICS,
        skipped: found.skipped, skipped_count: found.skipped_count,
      };
      if (sizeOf(data) > 48000) {
        const file = join(base, 'measurements.json');
        await writeJson(file, data, { mode: 0o600 });
        const full = await registerAsset(project, { path: file, kind: 'sample', label: 'All sample numbers' });
        data.full_measurements = { file, asset_id: full.id };
        // Keep all measured rates and percentiles. Large cut lists stay in the local JSON file.
        for (const video of [...videos].sort((a,b) => b.cut_times_ms.length - a.cut_times_ms.length)) {
          if (sizeOf(data) <= 48000) break;
          video.cut_count = video.cut_times_ms.length;
          video.cut_times_ms = [];
          video.cut_times_file = file;
        }
        if (sizeOf(data) > 48000) {
          data.skipped = [];
          for (const sample of [...images, ...videos]) { sample.path = short(sample.path); }
          data.path_note = 'Long paths and full cut lists are in the local full_measurements file.';
        }
        if (sizeOf(data) > 50000) throw new Error('These sample names are too long for one reply. Please use fewer files.');
      }
      await updateProject(project.id, p => { Object.assign(p.assets, project.assets); /** @type {any} */ (p).hidden = true; });
      const lines = [
        `Read ${images.length} images and ${videos.length} videos. Skipped ${found.skipped_count} items. Samples stayed where you put them.`,
        ...images.map((v,i) => `Image ${v.sample_index}: ${v.width} by ${v.height}, ${v.brightness}, ${v.saturation}, ${v.background} background, ${Math.round(v.whitespace_ratio*100)}% open space.`),
        ...videos.map((v,i) => `Video ${v.sample_index}: ${(v.duration_ms/1000).toFixed(1)} seconds, ${v.cuts_per_10s} cuts per 10 seconds. Speech: ${v.speech}. ${v.confidence_note}${v.speech_note ? ' '+v.speech_note : ''}`),
        ...(images.length === 1 ? ['A single image is a small sample. Its palette and background reading are a start.'] : []),
        'Video cuts and color use at most the first 90 seconds. Speech uses at most the first minute and needs a ready local speech model.',
        `Contact sheet: ${sheet.file}`, 'Open it if you cannot see the picture.',
        ...(data.full_measurements ? [`Full numbers and cut lists: ${data.full_measurements.file}`] : []),
        'Each tile starts with its sample number in the input order. Video tiles also show the time.',
        STYLE_INTERVIEW,
      ];
      ctx.progress(1, 'Sample readings ready');
      return { data, text: lines.join('\n'), images: [{ data: sheet.buffer.toString('base64'), mimeType: 'image/jpeg' }] };
    } catch (error) {
      await deleteProject(project.id).catch(() => {});
      throw error;
    } finally {
      await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
