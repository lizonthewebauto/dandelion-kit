import { copyFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { ensureDir, isFile, kitHome, writeJson } from '../../core/util/fs.mjs';
import { requireProject } from '../store/project.mjs';
import { renderLabel, renderKeys } from '../lib/preview.mjs';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

/** "Morning routine: day 3!" becomes "morning-routine-day-3". @param {string} text */
export function slugify(text) {
  const s = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'export';
}

/** @param {number} ms */
function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const p = (/** @type {number} */ n, /** @type {number} */ w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(t % 1000, 3)}`;
}

/**
 * A subtitle file from the caption cues of a shot plan.
 * @param {import('../../core/types.mjs').CaptionCue[]} cues
 */
export function captionsToSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start_ms)} --> ${srtTime(c.end_ms)}\n${c.text.trim()}\n`)
      .join('\n') || ''
  );
}

/** @param {number} bytes */
function size(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export const tool = defineTool({
  name: 'export',
  title: 'Export files',
  description:
    'Copy the finished files to a folder you can find: the final reel (and any variants) with a subtitle file for a video project, or the JPEG slides for a carousel. Also writes summary.md (what each file is) and source-map.json (which plan each file came from). Default folder is under the kit home. Ends by offering to post: call offer_post next.',
  input: {
    project_id: z.string(),
    to_dir: z.string().optional().describe('Folder to copy into. Created if missing.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const project = await requireProject(args.project_id);
    const slug = slugify(project.title);
    const dir = ensureDir(args.to_dir ? resolve(args.to_dir) : join(kitHome(), 'exports', slug));
    /** @type {{path: string, bytes: number, kind: 'video'|'image'|'caption'|'doc'}[]} */
    const files = [];
    /** @type {{file: string, kind: string, from: string, plan_hash?: string, quality?: string}[]} */
    const map = [];
    /** @type {string[]} */
    const lines = [`# ${project.title}`, '', `Exported by the Dandelion Kit on ${new Date().toISOString().slice(0, 10)}.`, ''];

    if (project.type === 'carousel') {
      const slides = project.carousel?.rendered ?? [];
      if (!slides.length) return fail('This project has no rendered slides yet.');
      lines.push('## Slides', '');
      for (let i = 0; i < slides.length; i += 1) {
        const name = `slide-${String(i + 1).padStart(2, '0')}.jpg`;
        const to = join(dir, name);
        await copyFile(slides[i].file, to);
        const bytes = (await stat(to)).size;
        files.push({ path: to, bytes, kind: 'image' });
        map.push({ file: name, kind: 'image', from: slides[i].file });
        lines.push(`- ${name}: slide ${i + 1} of ${slides.length}, ${slides[i].width} by ${slides[i].height}, ${size(bytes)}`);
      }
    } else {
      const renders = /** @type {Record<string, import('../../core/types.mjs').RenderResult>} */ (project.renders ?? {});
      const finals = renderKeys(project).filter((k) => renders[k].quality === 'final' && isFile(renders[k].file));
      if (!finals.length) return fail('There is no final reel yet. Build it with render_reel (quality final) first.');
      lines.push('## Video', '');
      for (const key of finals) {
        const r = renders[key];
        const name = key === 'final' ? `${slug}-reel.mp4` : `${slug}-${slugify(renderLabel(key))}.mp4`;
        const to = join(dir, name);
        await copyFile(r.file, to);
        const bytes = (await stat(to)).size;
        files.push({ path: to, bytes, kind: 'video' });
        map.push({ file: name, kind: 'video', from: r.file, plan_hash: r.plan_hash, quality: r.quality });
        const bad = (r.checks ?? []).filter((c) => c.status !== 'pass').length;
        lines.push(`- ${name}: ${renderLabel(key)}, 1080 by 1920, ${size(bytes)}, ${bad === 0 ? 'all checks passed' : `${bad} check${bad === 1 ? '' : 's'} to look at`}`);
      }
      if (project.shot_plan?.captions?.length) {
        const to = join(dir, `${slug}-captions.srt`);
        await writeFile(to, captionsToSrt(project.shot_plan.captions), 'utf8');
        files.push({ path: to, bytes: (await stat(to)).size, kind: 'caption' });
        map.push({ file: basename(to), kind: 'caption', from: 'shot plan', plan_hash: project.shot_plan.hash });
        lines.push('', '## Captions', '', `- ${basename(to)}: the caption words and times, for editors that take a subtitle file`);
      }
    }

    const sourceMapPath = join(dir, 'source-map.json');
    const summaryPath = join(dir, 'summary.md');
    await writeJson(sourceMapPath, { project_id: project.id, title: project.title, source: project.source_path ?? null, exported_at: new Date().toISOString(), outputs: map });
    lines.push('', '## Notes', '', '- source-map.json lists where each file came from.', '- Next step: ask for the versions for each app and post with Dandelion.');
    await writeFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
    files.push({ path: summaryPath, bytes: (await stat(summaryPath)).size, kind: 'doc' });
    files.push({ path: sourceMapPath, bytes: (await stat(sourceMapPath)).size, kind: 'doc' });
    return ok({ project_id: project.id, dir, files, summary_path: summaryPath, source_map_path: sourceMapPath });
  },
});
