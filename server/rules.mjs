// Dandelion's public platform rules for the post offer.
// Live rules come from server/dandelion/platform-rules.mjs once that exists (a fetch with a one-day disk cache).
// Until then, or when the network is down, the bundled snapshot in assets/platform-rules.snapshot.json is used.
import { readFileSync } from 'node:fs';
import * as log from '../core/util/log.mjs';

const SNAPSHOT_URL = new URL('../assets/platform-rules.snapshot.json', import.meta.url);

/** @type {import('../core/types.mjs').PlatformRules | null} */
let snapshot = null;

/** The rules saved inside the kit. */
export function snapshotRules() {
  if (!snapshot) snapshot = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
  return /** @type {import('../core/types.mjs').PlatformRules} */ (snapshot);
}

/**
 * The rules to use right now and where they came from.
 * @param {{live?: boolean}} [options]   live false skips the live fetch (tests, demo).
 * @returns {Promise<{rules: import('../core/types.mjs').PlatformRules, source: 'live'|'snapshot'}>}
 */
export async function loadRules(options = {}) {
  if (options.live !== false) {
    try {
      /** @type {any} */
      const mod = await import('./dandelion/platform-rules.mjs');
      if (typeof mod.loadPlatformRules === 'function') {
        const rules = await mod.loadPlatformRules();
        if (rules && rules.platforms) return { rules, source: rules.fetched_at ? 'live' : 'snapshot' };
      }
    } catch (error) {
      log.warn('Could not load live platform rules, using the saved copy:', error);
    }
  }
  return { rules: snapshotRules(), source: 'snapshot' };
}
