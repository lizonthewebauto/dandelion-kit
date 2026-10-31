// Where Dandelion lives, and the plain-word errors the kit shows when talking to it.
import { readFileSync } from 'node:fs';

/** The public site. DANDELION_URL points the kit at a staging or local copy for tests. */
export const DEFAULT_BASE = 'https://dandelionapp.io';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The Dandelion site address with no trailing slash.
 * http is only allowed for this computer, so a sign-in is never sent over a plain connection to someone else.
 * @returns {string}
 */
export function dandelionBase() {
  const raw = (process.env.DANDELION_URL ?? '').trim();
  if (!raw) return DEFAULT_BASE;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DandelionError(`DANDELION_URL is not a web address: ${raw}`, 'bad_config');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new DandelionError('DANDELION_URL must start with https:// (http:// only works for localhost).', 'bad_config');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** The MCP address. */
export function mcpUrl() {
  return `${dandelionBase()}/api/mcp`;
}

/** The public rules address. */
export function rulesUrl() {
  return `${dandelionBase()}/api/kit/platform-rules`;
}

/** True when the person asked the kit to stay off the network (tests, offline work). */
export function isOffline() {
  const v = (process.env.DANDELION_KIT_OFFLINE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** The kit version, for the client name Dandelion sees. */
export function kitVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/**
 * An error with words written for a person. `code` is Dandelion's own error code when it sent one.
 */
export class DandelionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {number} [status]
   */
  constructor(message, code = 'error', status) {
    super(message);
    this.name = 'DandelionError';
    this.code = code;
    this.status = status;
  }
}

/** The person has not signed in, or the sign-in no longer works. */
export class NotSignedInError extends DandelionError {
  constructor(message = 'Dandelion is not signed in yet. Say "connect Dandelion" and finish the sign-in in your browser.') {
    super(message, 'not_signed_in', 401);
    this.name = 'NotSignedInError';
  }
}

/**
 * Turn the error Dandelion sent into one or two plain sentences.
 * @param {string} code
 * @param {string} message   Dandelion's own words.
 */
export function plainDandelionError(code, message) {
  switch (code) {
    case 'plan_required':
      return 'Dandelion says this plan cannot use the API yet. Look at the plan in Dandelion settings (https://dandelionapp.io/app/settings), then try again.';
    case 'invalid_key':
    case 'missing_key':
      return 'Dandelion is not signed in (or the sign-in ran out). Say "connect Dandelion" and finish the sign-in in your browser.';
    case 'rate_limited':
      return 'Dandelion asked us to slow down. Wait a minute and try again.';
    default:
      return message && message.length < 600 ? message : 'Dandelion could not do that. Try again in a minute.';
  }
}
