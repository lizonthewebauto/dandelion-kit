// Shared pieces for the tool files: how a tool is described, how it answers, and how errors become plain words.
// A tool file exports `tool = defineTool({...})`. server/index.mjs turns it into an MCP tool.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { KitMediaError } from '../../core/media/ffmpeg.mjs';
import { ProjectError } from '../store/project.mjs';

export { z };

/**
 * What a tool run gets besides its arguments.
 * @typedef {object} ToolContext
 * @property {(fraction: number, message?: string) => void} progress   0 to 1. Sends a progress notification when the host asked for one.
 * @property {AbortSignal} [signal]
 * @property {boolean} [demo]
 */

/**
 * What a tool run hands back. The server adds the card data (structuredContent) and the text.
 * @typedef {object} ToolOutcome
 * @property {Record<string, any>} [data]    Becomes structuredContent. Cards read it. Under 50 KB.
 * @property {string} [text]                 Overrides the text that server/text.mjs would write from data.
 * @property {boolean} [isError]
 */

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} title
 * @property {string} description         Written for the model: when to call it and what it gives back.
 * @property {Record<string, import('zod').ZodType>} input   A zod shape (object of fields).
 * @property {{readOnlyHint?: boolean, destructiveHint?: boolean, idempotentHint?: boolean, openWorldHint?: boolean}} annotations
 * @property {(args: any, ctx: ToolContext) => Promise<ToolOutcome>} run
 */

/** @param {ToolDef} def */
export function defineTool(def) {
  return def;
}

/**
 * A good answer.
 * @param {Record<string, any>} data
 * @param {string} [text]
 * @returns {ToolOutcome}
 */
export function ok(data, text) {
  return text === undefined ? { data } : { data, text };
}

/**
 * A plain-words failure (isError true). Pass data when a card or the model can use the details.
 * @param {string} text
 * @param {Record<string, any>} [data]
 * @returns {ToolOutcome}
 */
export function fail(text, data) {
  return data ? { isError: true, text, data } : { isError: true, text };
}

/** An error that already carries a message meant for a person. */
export class ToolFailure extends Error {
  /** @param {string} message @param {Record<string, any>} [data] */
  constructor(message, data) {
    super(message);
    this.name = 'ToolFailure';
    this.data = data;
  }
}

/**
 * The answer for a tool whose real work arrives in a later milestone.
 * @param {string} what   For example "Signing in to Dandelion".
 */
export function notBuilt(what) {
  return fail(`${what} is not built into this version of the kit yet. It arrives in a coming update. Nothing was changed.`, {
    error: 'not_built',
  });
}

/**
 * Turn anything thrown into one or two plain sentences. No stack traces, no file internals.
 * @param {unknown} error
 * @returns {{text: string, data?: Record<string, any>, known: boolean}}
 */
export function friendlyError(error) {
  const e = /** @type {any} */ (error);
  if (e instanceof ToolFailure) return { text: e.message, data: e.data, known: true };
  if (e instanceof ProjectError || e instanceof KitMediaError) return { text: e.message, known: true };
  if (e && e.name === 'CarouselError') return { text: e.message, known: true };
  if (e && e.code === 'hook_rejected') {
    return { text: e.message, data: { error: 'hook_rejected', reasons: e.reasons ?? [] }, known: true };
  }
  if (e && (e.name === 'ZodError' || Array.isArray(e.issues))) {
    const issue = e.issues?.[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return { text: `The input is not right. ${where}${issue?.message ?? 'Check the fields and try again.'}`, known: true };
  }
  // Plain errors thrown by core code are written for people (for example the edit brain), so show them.
  if (e instanceof Error && e.message && e.message.length < 400 && !/\n/.test(e.message)) {
    return { text: e.message, known: false };
  }
  return { text: 'Something went wrong. The details are in the kit log.', known: false };
}

/** @param {string} id */
export function isProjectId(id) {
  return /^p_[a-z0-9]{4,32}$/.test(String(id));
}

/**
 * The render code reports progress as (stage, fraction, message). Accept (fraction, message) and ({fraction, message}) too.
 * @param {ToolContext} ctx
 */
export function progressAdapter(ctx) {
  const norm = (/** @type {any} */ f) => (Number(f) > 1 ? Number(f) / 100 : Number(f) || 0);
  return (/** @type {any} */ a, /** @type {any} */ b, /** @type {any} */ c) => {
    if (typeof a === 'string') ctx.progress(norm(b), typeof c === 'string' ? c : a);
    else if (typeof a === 'number') ctx.progress(norm(a), typeof b === 'string' ? b : undefined);
    else if (a && typeof a === 'object') ctx.progress(norm(a.fraction ?? a.progress), typeof a.message === 'string' ? a.message : undefined);
  };
}

/** Clean up a path a person typed or pasted: quotes and a leading ~. @param {string} raw */
export function cleanPath(raw) {
  let p = String(raw).trim().replace(/^["']|["']$/g, '');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1));
  return p;
}
