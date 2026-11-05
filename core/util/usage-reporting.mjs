// Optional, first-party adoption counts. Off until the person explicitly agrees.
// Never send account details, file names, content, paths, or a computer name.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { kitHome, readJson, writeJson } from './fs.mjs';

export const REPORTING_NOTICE = 'Optional usage counts tell Dandelion when this Kit is ready and when you first make a finished image, carousel or video. They send a random Kit ID, version and system type. No files, words, email or computer name are sent. This is off until you say yes. You can turn it off at any time and keep editing offline.';
const ENDPOINT = 'https://dandelionapp.io/api/kit/events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An isolated reporter; injected paths and fetch keep tests off the real service.
 * @param {{home?: string, fetchImpl?: typeof fetch, platform?: string, version?: string, disabled?: boolean}} [options]
 */
export function createUsageReporter(options = {}) {
  let queue = Promise.resolve();
  const file = () => join(options.home ?? kitHome(), 'usage-reporting.json');
  // Only consent actions write this file. A concurrent event write cannot undo an opt-out.
  const consentFile = () => join(options.home ?? kitHome(), 'usage-reporting-consent.json');
  const disabled = () => options.disabled ?? (process.env.DANDELION_KIT_TELEMETRY === '0' || process.env.CI === 'true' || process.env.NODE_ENV === 'test');
  const version = () => options.version ?? JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const platform = () => ({ win32: 'windows', darwin: 'macos', linux: 'linux' })[options.platform ?? process.platform];
  const read = async () => {
    const raw = await readJson(file(), /** @type {any} */ ({}));
    const consent = await readJson(consentFile(), /** @type {any} */ ({}));
    return { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), enabled: consent?.enabled };
  };
  // Serialize this process's state changes and sends. Server uniqueness also covers retries and other processes.
  const serial = (/** @type {() => Promise<any>} */ fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };
  const status = async () => {
    const state = await read();
    return { enabled: state.enabled === true && !disabled(), chosen: typeof state.enabled === 'boolean', blocked: Boolean(disabled()), notice: REPORTING_NOTICE };
  };
  /** @param {'install_completed'|'first_use'} event */
  const send = async (event) => {
    try {
      if (disabled() || !platform()) return false;
      const state = await read();
      if (state.enabled !== true || !UUID.test(state.installation_id ?? '') || state.sent?.[event] === true) return false;
      const payload = { event, installation_id: state.installation_id, version: version(), platform: platform() };
      const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1500), redirect: 'error',
      });
      await response.body?.cancel().catch(() => {});
      if (!response.ok) return false;
      // Never re-enable reporting when another process turned it off during the request.
      const latest = await read();
      if (latest.installation_id === state.installation_id) {
        await writeJson(file(), { ...latest, sent: { ...latest.sent, [event]: true }, pending: { ...latest.pending, [event]: false } }, { mode: 0o600 });
      }
      return true;
    } catch {
      // A network or disk failure must never fail setup, rendering, or export.
      return false;
    }
  };
  return {
    status,
    /** Only call after the person has agreed to the notice. Keeps sent flags on disable/re-enable.
     * @param {boolean} enabled */
    setEnabled(enabled) {
      return serial(async () => {
        if (disabled()) return status();
        const state = await read();
        // A declined offer must not mint an identifier.
        const installation_id = UUID.test(state.installation_id ?? '') ? state.installation_id : enabled ? randomUUID() : undefined;
        if (enabled && installation_id !== state.installation_id) {
          await writeJson(file(), { ...state, installation_id }, { mode: 0o600 });
        }
        await writeJson(consentFile(), { enabled }, { mode: 0o600 });
        return status();
      });
    },
    /** Install = full local Kit is ready; not a downloaded file or a saved config. */
    installed() {
      return serial(async () => {
        const ready = await send('install_completed');
        try {
          const state = await read();
          if (state.pending?.first_use === true) await send('first_use');
        } catch { /* Reporting must not affect startup. */ }
        return ready;
      });
    },
    /** First use = a finished local output, only after reporting was enabled. */
    firstUse() {
      return serial(async () => {
        try {
          if (disabled()) return false;
          const state = await read();
          if (state.enabled !== true || !UUID.test(state.installation_id ?? '') || state.sent?.first_use === true) return false;
          // Keep only a pending boolean, never the output or its date. Retry on the next ready session.
          await writeJson(file(), { ...state, pending: { ...state.pending, first_use: true } }, { mode: 0o600 });
        } catch { return false; }
        // Preserve ordering even if the first ready report failed while offline.
        await send('install_completed');
        return send('first_use');
      });
    },
  };
}

export const usageReporter = createUsageReporter();
