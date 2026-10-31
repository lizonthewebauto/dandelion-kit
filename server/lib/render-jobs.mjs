// Long builds (a final reel, variants) run in the background so one tool call never waits past the time a host gives it.
// Hosts stop waiting for a tool answer after about a minute and do not stretch that for progress messages.
// A tool starts the work here, waits up to renderWaitMs() for it, and then either answers with the finished card data
// (exactly what it returned before) or with a "still building" answer. Calling the same tool again with the same
// arguments attaches to the same job: it never starts a second build. The build itself still goes through the
// render cache and the one-build-at-a-time queue in core/render/render.mjs.
import { hashShotPlan } from '../../core/edit/shotplan.mjs';
import * as log from '../../core/util/log.mjs';
import { overallProgress } from '../../core/render/progress.mjs';
import { fail, friendlyError, ok } from './kit.mjs';

const DEFAULT_WAIT_MS = 40_000;
/** setTimeout cannot count past 2^31 - 1 ms (about 24 days). */
const MAX_WAIT_MS = 2_000_000_000;

/**
 * How long a tool waits for a build before it answers "still building". 40 seconds, or the number of milliseconds in
 * DANDELION_KIT_RENDER_WAIT_MS. The command line sets a huge number so it waits for the whole build.
 */
export function renderWaitMs() {
  const raw = process.env.DANDELION_KIT_RENDER_WAIT_MS;
  const n = Number(raw);
  if (raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n >= 0) return Math.min(n, MAX_WAIT_MS);
  return DEFAULT_WAIT_MS;
}

/**
 * @typedef {'render_reel' | 'make_variants'} RenderTool
 *
 * @typedef {object} RenderJob
 * @property {string} key
 * @property {string} projectId
 * @property {RenderTool} tool
 * @property {'draft'|'final'} quality
 * @property {Record<string, any>} extra     Extra fields for the pending answer, for example the variant count.
 * @property {number} fraction               0 to 1, only goes up.
 * @property {string} message
 * @property {boolean} done
 * @property {import('./kit.mjs').ToolOutcome} [outcome]   Set when the build ends, good or bad.
 * @property {number} waiters                Calls that are waiting for this job right now.
 * @property {Set<(fraction: number, message?: string) => void>} listeners
 * @property {Promise<void>} settled         Resolves (never rejects) when the build ends.
 */

/** @type {Map<string, RenderJob>} */
const jobs = new Map();

/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A short id for the plan as the person made it. The caption spot is found and saved into the plan during the first
 * build, which changes the plan's own hash, so it is left out here: a repeat call still finds the same job.
 * @param {import('../../core/types.mjs').ShotPlan} plan
 */
export function planKey(plan) {
  return hashShotPlan({ ...plan, caption_anchor: null });
}

/**
 * The build in flight for a project, if any. get_project shows it.
 * @param {string} projectId
 * @returns {{quality: 'draft'|'final', progress: number, tool: RenderTool, message: string} | null}
 */
export function activeRender(projectId) {
  /** @type {RenderJob | null} */
  let found = null;
  for (const job of jobs.values()) if (job.projectId === projectId && !job.done) found = job;
  return found ? { quality: found.quality, progress: round2(found.fraction), tool: found.tool, message: found.message } : null;
}

/**
 * Turn the render code's (stage, fraction, message) progress into one number that only goes up.
 * @param {(fraction: number, message?: string) => void} report
 */
export function stageProgress(report) {
  /** @param {string} stage @param {number} fraction @param {string} [message] */
  return (stage, fraction, message) => {
    const overall = overallProgress(stage, fraction);
    if (overall !== null) report(overall, message);
  };
}

/**
 * @param {RenderJob} job
 * @returns {import('./kit.mjs').ToolOutcome}
 */
function pendingOutcome(job) {
  return ok({
    project_id: job.projectId,
    quality: job.quality,
    tool: job.tool,
    ...job.extra,
    pending: true,
    progress: round2(job.fraction),
    message: job.message,
  });
}

/**
 * Start the work.
 * @param {{key: string, projectId: string, tool: RenderTool, quality: 'draft'|'final', extra: Record<string, any>, start: (report: (fraction: number, message?: string) => void) => Promise<import('./kit.mjs').ToolOutcome>}} input
 * @returns {RenderJob}
 */
function begin({ key, projectId, tool, quality, extra, start }) {
  /** @type {RenderJob} */
  const job = {
    key,
    projectId,
    tool,
    quality,
    extra,
    fraction: 0,
    message: 'Getting ready',
    done: false,
    outcome: undefined,
    waiters: 0,
    listeners: new Set(),
    settled: /** @type {any} */ (null),
  };
  /** @param {number} fraction @param {string} [message] */
  const report = (fraction, message) => {
    job.fraction = Math.max(job.fraction, Math.min(0.99, Number(fraction) || 0));
    if (message) job.message = message;
    for (const listener of job.listeners) {
      try {
        listener(job.fraction, job.message);
      } catch {
        // A listener that fails (the host went away) must not stop the build.
      }
    }
  };
  job.settled = Promise.resolve()
    .then(() => start(report))
    .then(
      (outcome) => {
        job.outcome = outcome;
      },
      (error) => {
        const friendly = friendlyError(error);
        if (friendly.known) log.warn(`${tool} for ${projectId}: ${friendly.text}`);
        else log.error(`${tool} for ${projectId} failed:`, /** @type {any} */ (error)?.stack ?? error);
        job.outcome = fail(friendly.text, friendly.data);
      },
    )
    .then(() => {
      job.done = true;
      if (!job.outcome?.isError) job.fraction = 1;
      // Somebody is waiting and will take the answer now. Otherwise keep it for the next call, good or bad.
      if (job.waiters > 0) jobs.delete(key);
    });
  jobs.set(key, job);
  return job;
}

/**
 * Wait for a job to end, for at most `ms`. Resolves early when the call is cancelled.
 * @param {RenderJob} job
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 */
function waitForJob(job, ms, signal) {
  return new Promise((resolve) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const finish = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve(undefined);
    };
    if (signal?.aborted) return finish();
    timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    job.settled.then(finish);
  });
}

/**
 * Run a build in the background, or attach to the one already running for this key, and wait for it a while.
 * Returns the finished outcome if the build ends within the wait, or a pending outcome if it does not.
 * An error from a build that nobody was waiting for is kept and returned on the next call, then cleared.
 * @param {object} input
 * @param {string} input.key               Same key, same build. For example the project, the tool, the quality and the plan.
 * @param {string} input.projectId
 * @param {RenderTool} input.tool
 * @param {'draft'|'final'} input.quality
 * @param {Record<string, any>} [input.extra]
 * @param {(report: (fraction: number, message?: string) => void) => Promise<import('./kit.mjs').ToolOutcome>} input.start
 *   Does the work and returns what the tool returns. Called once per build.
 * @param {import('./kit.mjs').ToolContext} input.ctx
 * @param {number} [input.waitMs]
 * @returns {Promise<import('./kit.mjs').ToolOutcome>}
 */
export async function runInBackground({ key, projectId, tool, quality, extra = {}, start, ctx, waitMs = renderWaitMs() }) {
  let job = jobs.get(key);
  if (job?.done) {
    // It ended while nobody was waiting. Hand over the answer once.
    jobs.delete(key);
    if (job.outcome) return job.outcome;
    job = undefined;
  }
  if (!job) job = begin({ key, projectId, tool, quality, extra, start });

  /** @param {number} fraction @param {string} [message] */
  const listener = (fraction, message) => ctx.progress(fraction, message);
  job.listeners.add(listener);
  job.waiters += 1;
  listener(job.fraction, job.message);
  try {
    await waitForJob(job, waitMs, ctx.signal);
  } finally {
    job.listeners.delete(listener);
    job.waiters -= 1;
  }
  if (job.done && job.outcome) {
    if (jobs.get(key) === job) jobs.delete(key);
    return job.outcome;
  }
  return pendingOutcome(job);
}
