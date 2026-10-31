// Video project steps that join the media code and the project store:
// open a video (ingest + register files) and transcribe it. The open_video tool calls these.
import { basename, extname, join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { ingestVideo } from '../../core/media/ingest.mjs';
import { transcribe } from '../../core/transcribe/whisper.mjs';
import { validateTranscript } from '../../core/transcribe/types.mjs';
import { hashFile } from '../../core/util/hash.mjs';
import { isFile } from '../../core/util/fs.mjs';
import {
  createProject,
  findBySourceHash,
  projectDir,
  registerAsset,
  requireProject,
  updateProject,
  videoProjectId,
  ProjectError,
} from './project.mjs';
import { KitMediaError } from '../../core/media/ffmpeg.mjs';

/** A title from a file name: "my-clip_v2.mp4" becomes "my clip v2". @param {string} path */
export function titleFromPath(path) {
  return basename(path, extname(path)).replace(/[_-]+/g, ' ').trim() || 'Untitled video';
}

/**
 * Open a video: make (or find) its project, prepare the work copy, proxy and wav, register the files.
 * Opening the same file again reuses the project and the prepared files.
 * @param {{path: string, title?: string, fit?: 'crop'|'pad', force?: boolean, signal?: AbortSignal, onProgress?: (stage:string, fraction:number, message?:string) => void}} input
 * @returns {Promise<{project: import('../../core/types.mjs').Project, reused: boolean, source_media: import('../../core/types.mjs').MediaInfo}>}
 */
export async function openVideo(input) {
  const source = resolve(input.path);
  if (!isFile(source)) throw new KitMediaError(`I could not find a video at ${source}.`);
  input.onProgress?.('hash', 0, 'Fingerprinting the file');
  const source_hash = await hashFile(source);

  let project = await findBySourceHash(source_hash);
  if (!project) {
    project = await createProject({
      id: videoProjectId(source_hash),
      type: 'video',
      title: input.title?.trim() || titleFromPath(source),
      source_path: source,
      source_hash,
    });
  }
  const dir = join(projectDir(project.id), 'media');
  const ingest = await ingestVideo(source, dir, {
    fit: input.fit,
    force: input.force,
    signal: input.signal,
    onProgress: input.onProgress,
    sourceHash: source_hash,
  });

  const { project: saved } = await updateProject(project.id, async (p) => {
    if (input.title?.trim()) p.title = input.title.trim();
    p.source_path = source;
    p.media = ingest.work_media;
    await registerAsset(p, { path: source, kind: 'source', label: 'Original video' });
    await registerAsset(p, { path: ingest.files.work, kind: 'work', label: 'Working copy (1080x1920)' });
    await registerAsset(p, { path: ingest.files.proxy, kind: 'proxy', label: 'Preview' });
    if (ingest.files.audio)
      await registerAsset(p, { path: ingest.files.audio, kind: 'audio', label: 'Sound' });
  });
  return { project: saved, reused: ingest.reused, source_media: ingest.source_media };
}

/**
 * Transcribe a project's sound and save the transcript on it. Skips the work when a transcript
 * already exists, unless force is set.
 * @param {string} projectId
 * @param {import('../../core/transcribe/whisper.mjs').TranscribeOptions & {force?: boolean}} [options]
 * @returns {Promise<{project: import('../../core/types.mjs').Project, transcript: import('../../core/types.mjs').Transcript, reused: boolean, elapsed_ms: number}>}
 */
export async function transcribeProject(projectId, options = {}) {
  const project = await requireProject(projectId);
  if (project.transcript_ready && project.transcript && !options.force) {
    return { project, transcript: project.transcript, reused: true, elapsed_ms: 0 };
  }
  const audio = Object.values(project.assets).find((asset) => asset.kind === 'audio');
  if (!audio) throw new ProjectError('This video has no sound to transcribe.');
  await stat(audio.path).catch(() => {
    throw new ProjectError('The sound file for this project is missing. Open the video again to rebuild it.');
  });
  const started = Date.now();
  const transcript = await transcribe(audio.path, options);
  const problems = validateTranscript(transcript);
  if (problems.length) throw new KitMediaError(`The transcript came back damaged: ${problems[0]}`);
  const { project: saved } = await updateProject(projectId, (p) => {
    p.transcript = transcript;
    p.transcript_ready = true;
    // A new transcript makes any cut, plan or render built on the old one stale.
    if (options.force) {
      delete p.cut;
      p.cut_applied = false;
      delete p.shot_plan;
      delete p.renders;
      delete p.variants;
    }
  });
  return { project: saved, transcript, reused: false, elapsed_ms: Date.now() - started };
}
