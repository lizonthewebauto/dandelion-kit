// The Dandelion sign-in, saved on this computer: <kit home>/auth.json, readable by you only (mode 0600), written atomically.
// Holds the OAuth client Dandelion gave us and the tokens. Tokens are never logged, printed or returned by a tool.
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile, ensureDir, kitHome } from '../../core/util/fs.mjs';

const FILE_VERSION = 1;

/** The sign-in file. */
export function authFilePath() {
  return join(kitHome(), 'auth.json');
}

/** @param {string} serverUrl */
function keyFor(serverUrl) {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

/**
 * @typedef {object} ServerRecord
 * @property {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationMixed} [client]
 * @property {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthTokens & {saved_at?: number}} [tokens]
 */

/** @returns {{version: number, servers: Record<string, ServerRecord>}} */
function readAllSync() {
  try {
    const parsed = JSON.parse(readFileSync(authFilePath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
      return { version: FILE_VERSION, servers: parsed.servers };
    }
  } catch {
    // Missing or unreadable: same as empty.
  }
  return { version: FILE_VERSION, servers: {} };
}

/** What is saved for one Dandelion address. @param {string} serverUrl @returns {ServerRecord} */
export function readRecord(serverUrl) {
  return readAllSync().servers[keyFor(serverUrl)] ?? {};
}

/** True when a sign-in is saved for this address. @param {string} serverUrl */
export function hasSavedSignIn(serverUrl) {
  const t = readRecord(serverUrl).tokens;
  return Boolean(t && (t.access_token || t.refresh_token));
}

/** One write at a time inside this process. */
let queue = Promise.resolve();

/**
 * Change what is saved for one address. Return the new record, or null to remove it.
 * @param {string} serverUrl
 * @param {(current: ServerRecord) => ServerRecord | null} change
 */
export function updateRecord(serverUrl, change) {
  const run = async () => {
    const all = readAllSync();
    const key = keyFor(serverUrl);
    const next = change(all.servers[key] ?? {});
    if (next === null || (!next.client && !next.tokens)) delete all.servers[key];
    else all.servers[key] = next;
    ensureDir(kitHome());
    await atomicWriteFile(authFilePath(), JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
    // writeFile only sets the mode on a new file and the umask can narrow it. Make it exact. (A no-op on Windows,
    // where the folder under your user profile is already private to you.)
    try {
      chmodSync(authFilePath(), 0o600);
    } catch {
      // Not supported here.
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/** Forget the saved sign-in for one address (the OAuth client too when `all`). @param {string} serverUrl @param {boolean} [all] */
export function clearRecord(serverUrl, all = true) {
  return updateRecord(serverUrl, (current) => (all ? null : { client: current.client }));
}

/** Does the file exist at all? (For the permission test.) */
export function authFileExists() {
  return existsSync(authFilePath());
}
