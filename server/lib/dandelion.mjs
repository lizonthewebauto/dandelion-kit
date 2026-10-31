// How the tools in this milestone learn about the Dandelion account without depending on how it is built.
// server/dandelion/client.mjs (milestone M7) exports getState() when it exists. Until then the answer is "not signed in".
import * as log from '../../core/util/log.mjs';

/**
 * @returns {Promise<import('../../core/types.mjs').DandelionState>}
 */
export async function dandelionState() {
  try {
    /** @type {any} */
    const mod = await import('../dandelion/client.mjs');
    if (typeof mod.getState === 'function') {
      const state = await mod.getState();
      if (state && typeof state.connected === 'boolean') return state;
    }
  } catch (error) {
    log.debug('Dandelion state is not available yet:', error);
  }
  return { connected: false };
}
