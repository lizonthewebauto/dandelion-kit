// Builds the structuredContent each card reads, from a stored project. The shapes match server/widgets/fixtures.mjs.
// Everything here is plain data: no files are written except the poster frame in ensurePoster().
import { basename, join } from 'node:path';
import { LOOKS } from '../../core/edit/looks.mjs';
import { cutStats } from '../../core/edit/roughcut.mjs';
import { sampleFrames } from '../../core/media/frames.mjs';
import { isFile } from '../../core/util/fs.mjs';
import { projectDir, registerAsset, updateProject } from '../store/project.mjs';

/** @typedef {import('../../core/types.mjs').Project} Project */

/** The look's display name, or the id when it is not one of the five. @param {string|undefined} id */
export function lookName(id) {
  if (!id) return undefined;
  return /** @type {any} */ (LOOKS)[id]?.name ?? id;
}

/** Find a registered asset by its label. @param {Project} project @param {string} label */
export function assetByLabel(project, label) {
  return Object.values(project.assets ?? {}).find((a) => a.label === label);
}

/** The first asset of a kind. @param {Project} project @param {string} kind */
export function assetByKind(project, kind) {
  return Object.values(project.assets ?? {}).find((a) => a.kind === kind);
}

/** True when a render exists for this key and was built from the plan as it is now. @param {Project} project @param {string} key */
export function renderIsFresh(project, key) {
  const r = project.renders?.[key];
  return Boolean(r && project.shot_plan && r.plan_hash === project.shot_plan.hash && isFile(r.file));
}

/**
 * The next tool to run, in plain order. The card works this out itself; the text uses it.
 * @param {Project} project
 */
export function nextStep(project) {
  if (project.type !== 'video') return 'export';
  if (!project.cut) return 'rough_cut';
  if (!project.look_id) return 'pick_look';
  if (!project.shot_plan) return 'plan_shots';
  if (renderIsFresh(project, 'final')) return 'export';
  return 'render_reel';
}

/**
 * Data for the kit-project card.
 * @param {Project} project
 * @param {{transcript_error?: string, transcribing?: {stage: string, fraction: number}}} [extra]
 */
export function projectCardData(project, extra = {}) {
  const faces = project.face_samples;
  const poster = assetByLabel(project, 'Poster');
  /** @type {Record<string, any>} */
  const p = {
    id: project.id,
    title: project.title,
    type: project.type,
    source_name: project.source_path ? basename(project.source_path) : project.title,
    duration_ms: project.media?.duration_ms ?? 0,
    width: project.media?.width ?? 0,
    height: project.media?.height ?? 0,
    fps: project.media?.fps ?? 0,
    transcript_ready: project.transcript_ready,
    word_count: project.transcript?.words.length ?? 0,
    language: project.transcript?.language,
    face_found: faces && faces.length ? faces.some((f) => f.box) : undefined,
    cut_applied: project.cut_applied,
    has_shot_plan: Boolean(project.shot_plan),
    has_draft: renderIsFresh(project, 'draft'),
    has_final: renderIsFresh(project, 'final'),
  };
  if (project.cut) {
    p.cut_before_ms = project.cut.before_ms;
    p.cut_after_ms = project.cut.after_ms;
  }
  if (project.look_id) {
    p.look_id = project.look_id;
    p.look_name = lookName(project.look_id);
  }
  if (poster) p.poster_asset_id = poster.id;
  if (extra.transcript_error) p.transcript_error = extra.transcript_error;
  if (extra.transcribing) p.transcribing = extra.transcribing;
  return { mode: 'project', project: p, next: nextStep(project) };
}

/**
 * Make (once) a small poster frame for the project card.
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function ensurePoster(projectId) {
  await updateProject(projectId, async (p) => {
    if (assetByLabel(p, 'Poster')) return;
    const work = assetByKind(p, 'work');
    if (!work || !isFile(work.path)) return;
    const at = Math.min(1000, Math.round((p.media?.duration_ms ?? 2000) / 4));
    try {
      const [frame] = await sampleFrames(work.path, [at], join(projectDir(p.id), 'poster'), { width: 270, prefix: 'poster' });
      await registerAsset(p, { path: frame.path, kind: 'frame', label: 'Poster' });
    } catch {
      // A poster is nice to have. Skip it when ffmpeg cannot make one.
    }
  });
}

/**
 * Data for the kit-cut-review card.
 * @param {Project} project
 */
export function cutData(project) {
  const cut = /** @type {NonNullable<Project['cut']>} */ (project.cut);
  return {
    project_id: project.id,
    preset: cut.preset,
    before_ms: cut.before_ms,
    after_ms: cut.after_ms,
    removed: cut.removed.map((r) => ({
      id: r.id,
      kind: r.kind,
      src_start_ms: r.src_start_ms,
      src_end_ms: r.src_end_ms,
      text: r.text,
      keep: r.keep,
    })),
    stats: cutStats(cut),
  };
}

/**
 * Data for the kit-shot-plan card. Beats are trimmed to what the card shows so the result stays small.
 * @param {Project} project
 */
export function shotPlanData(project) {
  const plan = /** @type {NonNullable<Project['shot_plan']>} */ (project.shot_plan);
  return {
    project_id: project.id,
    look_id: plan.look_id,
    look_name: lookName(plan.look_id),
    caption_theme: plan.caption_theme,
    accent: plan.accent,
    duration_ms: plan.duration_ms,
    plan_hash: plan.hash,
    stats: { captions: plan.captions.length, camera: plan.camera.length, sfx: plan.sfx.length },
    hook: {
      text: plan.hook.text,
      formula: plan.hook.formula,
      score: plan.hook.score,
      candidates: plan.hook.candidates.slice(0, 6),
    },
    beats: plan.beats.map((b) => {
      /** @type {Record<string, any>} */
      const out = {
        id: b.id,
        kind: b.kind,
        out_start_ms: b.out_start_ms,
        out_end_ms: b.out_end_ms,
        text: b.text.length > 220 ? `${b.text.slice(0, 217)}...` : b.text,
        treatment: b.treatment,
      };
      if (b.wanted_treatment) out.wanted_treatment = b.wanted_treatment;
      if (b.rendered_as) out.rendered_as = b.rendered_as;
      if (b.screen_text) out.screen_text = b.screen_text;
      return out;
    }),
  };
}
