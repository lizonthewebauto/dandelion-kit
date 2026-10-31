// Dandelion's public rules for each app (limits, formats, style). Fetched live, kept for a day on disk,
// and backed by the copy saved in assets/platform-rules.snapshot.json when the network is down.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNEL_IDS } from '../../core/types.mjs';
import { ensureDir, kitHome, readJson, writeJson } from '../../core/util/fs.mjs';
import * as log from '../../core/util/log.mjs';
import { isOffline, rulesUrl } from './config.mjs';

/** How long a fetched copy is good for. */
export const RULES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 6000;

const SNAPSHOT_URL = new URL('../../assets/platform-rules.snapshot.json', import.meta.url);

/** The copy saved inside the kit. @returns {import('../../core/types.mjs').PlatformRules} */
export function snapshotRules() {
  return JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
}

/** Where the fetched copy is kept. */
export function rulesCachePath() {
  return join(kitHome(), 'cache', 'platform-rules.json');
}

/**
 * Is this a rules document we can use? Needs at least one app with a name, formats and limits.
 * @param {any} doc
 */
export function isUsableRules(doc) {
  if (!doc || typeof doc !== 'object' || !doc.platforms || typeof doc.platforms !== 'object') return false;
  const entries = Object.values(doc.platforms);
  if (!entries.length) return false;
  return entries.every((p) => p && typeof p === 'object' && typeof (/** @type {any} */ (p).name) === 'string' && Array.isArray(/** @type {any} */ (p).formats) && typeof (/** @type {any} */ (p).limits) === 'object' && /** @type {any} */ (p).limits !== null);
}

/**
 * Fill any of the eight apps a document is missing from the saved copy, so the offer always has all eight.
 * @param {import('../../core/types.mjs').PlatformRules} doc
 */
function withAllApps(doc) {
  const saved = snapshotRules();
  const platforms = { ...doc.platforms };
  for (const id of CHANNEL_IDS) if (!platforms[id] && saved.platforms[id]) platforms[id] = saved.platforms[id];
  return { ...doc, platforms };
}

/**
 * @typedef {object} LoadOptions
 * @property {boolean} [force]            Skip the one-day cache.
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [now]               Unix ms, for tests.
 * @property {number} [maxAgeMs]
 */

/**
 * The rules to use. Fresh cache, else a live fetch, else an older cache, else the saved copy (which has no fetched_at).
 * @param {LoadOptions} [options]
 * @returns {Promise<import('../../core/types.mjs').PlatformRules>}
 */
export async function loadPlatformRules(options = {}) {
  const now = options.now ?? Date.now();
  const maxAge = options.maxAgeMs ?? RULES_MAX_AGE_MS;
  const cachePath = rulesCachePath();
  /** @type {{fetched_at?: string, rules?: any} | null} */
  const cached = await readJson(cachePath, null);
  const cachedAt = cached?.fetched_at ? Date.parse(cached.fetched_at) : NaN;
  const cacheUsable = Boolean(cached?.rules) && isUsableRules(cached?.rules) && Number.isFinite(cachedAt);

  if (cacheUsable && !options.force && now - cachedAt < maxAge && now >= cachedAt) {
    return withAllApps({ ...cached?.rules, fetched_at: cached?.fetched_at });
  }

  // The test runner and DANDELION_KIT_OFFLINE keep the kit off the network. A test that sets DANDELION_URL means it.
  const underTestRunner = Boolean(process.env.NODE_TEST_CONTEXT) && !process.env.DANDELION_URL;
  const canFetch = !isOffline() && !underTestRunner;

  if (canFetch) {
    try {
      const doc = await fetchRules(options.fetchImpl ?? fetch);
      const fetchedAt = new Date(now).toISOString();
      ensureDir(join(kitHome(), 'cache'));
      await writeJson(cachePath, { fetched_at: fetchedAt, source: rulesUrl(), rules: doc }).catch((error) => log.debug('Could not save the rules cache:', error));
      return withAllApps({ ...doc, fetched_at: fetchedAt });
    } catch (error) {
      log.warn('Could not fetch the live platform rules:', error);
    }
  }
  if (cacheUsable) return withAllApps({ ...cached?.rules, fetched_at: cached?.fetched_at });
  return snapshotRules();
}

/** @param {typeof fetch} fetchImpl @returns {Promise<import('../../core/types.mjs').PlatformRules>} */
async function fetchRules(fetchImpl) {
  const response = await fetchImpl(rulesUrl(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`rules endpoint answered ${response.status}`);
  const doc = await response.json();
  if (!isUsableRules(doc)) throw new Error('rules endpoint sent something unexpected');
  const { fetched_at: _ignore, ...rest } = doc;
  return /** @type {any} */ (rest);
}
