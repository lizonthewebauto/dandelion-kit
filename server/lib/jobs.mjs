// Speech to text runs in the background after open_video, so the first answer comes back fast.
// Tools that need the words (rough_cut, plan_shots) call ensureTranscript(), which waits for the same job.
import * as log from '../../core/util/log.mjs';
import { requireProject } from '../store/project.mjs';
import { transcribeProject } from '../store/video.mjs';
import { friendlyError } from './kit.mjs';

/**
 * @typedef {object} TranscribeJob
 * @property {Promise<import('../../core/types.mjs').Project>} promise
 * @property {{stage: string, fraction: number}} progress
 * @property {string} [error]
 * @property {boolean} done
 */

/** @type {Map<string, TranscribeJob>} */
const jobs = new Map();

/** The running or failed job for a project, if any. @param {string} projectId */
export function transcribeJob(projectId) {
  return jobs.get(projectId);
}

/**
 * Start transcribing a project unless it is done or already running. Never throws; errors are kept on the job.
 * @param {string} projectId
 * @param {{model?: 'base'|'tiny', onProgress?: (fraction: number, message?: string) => void}} [options]
 * @returns {Promise<TranscribeJob | null>}  null when the transcript already exists.
 */
export async function startTranscription(projectId, options = {}) {
  const project = await requireProject(projectId);
  if (project.transcript_ready && project.transcript) return null;
  const running = jobs.get(projectId);
  if (running && !running.done) return running;

  /** @type {TranscribeJob} */
  const job = {
    progress: { stage: 'start', fraction: 0 },
    done: false,
    promise: /** @type {any} */ (null),
  };
  job.promise = transcribeProject(projectId, {
    model: options.model,
    onProgress: (stage, fraction, message) => {
      job.progress = { stage, fraction };
      options.onProgress?.(fraction, message);
    },
  })
    .then((r) => {
      job.done = true;
      return r.project;
    })
    .catch((error) => {
      job.done = true;
      job.error = friendlyError(error).text;
      log.warn(`Transcription of ${projectId} failed:`, error);
      throw error;
    });
  // Nobody may be waiting yet. Keep an unhandled rejection from stopping the server.
  job.promise.catch(() => {});
  jobs.set(projectId, job);
  return job;
}

/**
 * Make sure the project has its words, waiting for a running job or starting one.
 * @param {string} projectId
 * @param {{onProgress?: (fraction: number, message?: string) => void}} [options]
 * @returns {Promise<import('../../core/types.mjs').Project>}
 */
export async function ensureTranscript(projectId, options = {}) {
  const project = await requireProject(projectId);
  if (project.transcript_ready && project.transcript) return project;
  const existing = jobs.get(projectId);
  // A failed job is retried once on the next ask.
  if (existing?.error) jobs.delete(projectId);
  const job = await startTranscription(projectId, options);
  if (!job) return requireProject(projectId);
  await job.promise;
  return requireProject(projectId);
}
