// `kit edit <video> --look <id> --out <folder>`: the whole reel pipeline from the command line.
//   open the video -> transcribe -> rough cut -> shot plan -> caption anchor -> render -> checks -> export
// bin/kit.mjs calls runEdit(args) with everything after the word "edit".
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getLook, planShots, roughCut } from '../edit/index.mjs';
import { LOOK_IDS, CAPTION_THEMES } from '../types.mjs';
import { sampleFrames } from '../media/frames.mjs';
import { transcribeProject, openVideo } from '../../server/store/video.mjs';
import { requireProject, updateProject } from '../../server/store/project.mjs';
import { captionAnchor } from './facezone.mjs';
import { checksTable } from './checks.mjs';
import { renderReel } from './render.mjs';
import { makeVariants } from './variants.mjs';

const VALUE_FLAGS = new Set([
  'look',
  'out',
  'preset',
  'caption-theme',
  'accent',
  'hook',
  'quality',
  'variants',
  'seed',
  'model',
  'engine',
  'language',
  'fit',
]);

/** @param {string[]} args */
export function parseEditArgs(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (VALUE_FLAGS.has(name) && args[i + 1] !== undefined) flags[name] = args[++i];
      else flags[name] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

/** @param {number} ms */
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * @param {string[]} args
 * @returns {Promise<number>} exit code
 */
export async function runEdit(args) {
  const { flags, positional } = parseEditArgs(args);
  const video = positional[0];
  if (!video) {
    process.stderr.write(
      'Usage: kit edit <video> --look <id> --out <folder> [--quality draft|final|both] [--preset gentle|standard|punchy] [--caption-theme <id>] [--accent #RRGGBB] [--hook "text"] [--variants 2-4]\n',
    );
    return 2;
  }
  const lookId = typeof flags.look === 'string' ? flags.look : LOOK_IDS[0];
  if (!LOOK_IDS.includes(/** @type {any} */ (lookId))) {
    process.stderr.write(`Unknown look "${lookId}". Use one of: ${LOOK_IDS.join(', ')}.\n`);
    return 2;
  }
  const theme = typeof flags['caption-theme'] === 'string' ? flags['caption-theme'] : undefined;
  if (theme && !CAPTION_THEMES.includes(/** @type {any} */ (theme))) {
    process.stderr.write(`Unknown caption theme "${theme}". Use one of: ${CAPTION_THEMES.join(', ')}.\n`);
    return 2;
  }
  const quality = typeof flags.quality === 'string' ? flags.quality : 'final';
  if (!['draft', 'final', 'both'].includes(quality)) {
    process.stderr.write('The quality must be draft, final or both.\n');
    return 2;
  }
  const preset = typeof flags.preset === 'string' ? flags.preset : 'standard';
  const out = resolve(typeof flags.out === 'string' ? flags.out : 'kit-out');
  mkdirSync(out, { recursive: true });

  const log = (text) => process.stderr.write(`[kit] ${text}\n`);
  const progress = (stage, fraction, message) => {
    if (message && (fraction === 0 || fraction >= 1)) log(`${stage}: ${message}`);
  };
  /** @type {Record<string, number>} */
  const timing = {};
  const t0 = Date.now();
  const lap = (name, since) => {
    timing[name] = Date.now() - since;
  };

  let mark = Date.now();
  const { project: opened } = await openVideo({
    path: video,
    onProgress: progress,
    fit: flags.fit === 'pad' ? 'pad' : 'crop',
  });
  lap('open', mark);
  mark = Date.now();
  const { transcript, reused } = await transcribeProject(opened.id, { onProgress: progress });
  lap('transcribe', mark);
  log(`transcript: ${transcript.words.length} words${reused ? ' (already done)' : ''}`);

  mark = Date.now();
  const project = await requireProject(opened.id);
  const cut = roughCut(transcript, {
    preset: /** @type {any} */ (preset),
    duration_ms: project.media?.duration_ms,
  });
  const look = getLook(lookId, {
    caption_theme: theme,
    accent: typeof flags.accent === 'string' ? flags.accent : undefined,
  });
  const seed = typeof flags.seed === 'string' ? flags.seed : opened.id;
  const plan = planShots(transcript, cut, look, {
    hook_text: typeof flags.hook === 'string' ? flags.hook : undefined,
    seed,
  });
  await updateProject(opened.id, (p) => {
    p.cut = cut;
    p.cut_applied = true;
    p.look_id = look.id;
    p.caption_theme = look.caption_theme;
    p.accent = look.accent;
    p.shot_plan = plan;
    delete p.renders;
    delete p.variants;
  });
  lap('plan', mark);
  log(
    `cut: ${secs(cut.before_ms)} to ${secs(cut.after_ms)}, ${plan.beats.length} beats, ${plan.camera.length} camera moves, ${plan.sfx.length} sounds; hook: "${plan.hook.text}"`,
  );

  mark = Date.now();
  const anchor = await captionAnchor({ projectId: opened.id, onProgress: progress });
  lap('faces', mark);
  log(
    `captions sit at y=${anchor.y} (${anchor.source}, face in ${Math.round(anchor.face_ratio * 100)}% of samples)`,
  );

  /** @type {Record<string, import('../types.mjs').RenderResult>} */
  const results = {};
  for (const q of quality === 'both' ? ['draft', 'final'] : [quality]) {
    mark = Date.now();
    const r = await renderReel({
      projectId: opened.id,
      quality: /** @type {'draft'|'final'} */ (q),
      onProgress: progress,
    });
    lap(`render_${q}`, mark);
    results[q] = r;
    const target = join(out, `reel-${q}.mp4`);
    copyFileSync(r.file, target);
    writeFileSync(join(out, `checks-${q}.json`), JSON.stringify(r.checks, null, 2) + '\n');
    writeFileSync(join(out, `checks-${q}.txt`), checksTable(r.checks) + '\n');
  }

  if (typeof flags.variants === 'string' || flags.variants === true) {
    mark = Date.now();
    const count = Math.max(2, Math.min(4, Number(flags.variants) || 2));
    const vs = await makeVariants({ projectId: opened.id, count, onProgress: progress });
    lap('variants', mark);
    for (const v of vs) {
      copyFileSync(v.file, join(out, `reel-${v.variant_id}.mp4`));
      writeFileSync(join(out, `checks-${v.variant_id}.txt`), checksTable(v.checks) + '\n');
      log(`${v.variant_id}: changed ${v.plan_diff.changed.join(', ')}`);
    }
  }

  // Three frames to look at: just after the start, the middle and the end.
  const main = results.final ?? results.draft;
  const dur = main.duration_ms;
  const frames = await sampleFrames(
    join(out, `reel-${results.final ? 'final' : 'draft'}.mp4`),
    [500, Math.round(dur / 2), Math.max(0, dur - 200)],
    out,
    { width: 720, quality: 2, prefix: 'frame' },
  );
  const named = [];
  for (const [i, label] of ['0.5s', 'mid', 'last'].entries()) {
    const target = join(out, `frame-${label}.jpg`);
    copyFileSync(frames[i].path, target);
    named.push(target);
  }
  for (const f of frames) rmSync(f.path, { force: true });

  lap('total', t0);
  writeFileSync(
    join(out, 'timing.json'),
    JSON.stringify({ project_id: opened.id, wall_ms: timing }, null, 2) + '\n',
  );
  const lines = [
    `Project ${opened.id}`,
    ...Object.entries(results).flatMap(([q, r]) => [
      ``,
      `${q}: ${join(out, `reel-${q}.mp4`)} (${(r.bytes / 1048576).toFixed(1)} MB, ${secs(r.duration_ms)})`,
      checksTable(r.checks),
    ]),
    '',
    `Frames: ${named.join(', ')}`,
    `Wall time: ${secs(timing.total)} (${Object.entries(timing)
      .filter(([k]) => k !== 'total')
      .map(([k, v]) => `${k} ${secs(v)}`)
      .join(', ')})`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
  return Object.values(results).some((r) => r.checks.some((c) => c.status === 'stop')) ? 1 : 0;
}

export default runEdit;
