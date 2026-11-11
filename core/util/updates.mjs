// Public release metadata only. No account, content, device ID or installed version leaves this computer.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitHome } from './fs.mjs';

export const RELEASE_URL = 'https://api.github.com/repos/lizonthewebauto/dandelion-kit/releases/latest';
export const UPDATE_GUIDE = 'https://dandelionapp.io/freekit/update';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TTL = 6 * 60 * 60 * 1000;
const RETRY = 15 * 60 * 1000;
const valid = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
function readInstalledVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
}
export function newerVersion(latest, installed) {
  if (!valid(latest) || !valid(installed)) return false;
  const a = latest.split('.').map(Number), b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
const RUNNING_VERSION = readInstalledVersion();
export function installedVersion() { return RUNNING_VERSION; }
/** Static host steps only. Never run commands supplied by release metadata. */
export function updateAction(root = ROOT) {
  if (/[\\/]plugins[\\/]cache[\\/]/.test(root) && /[\\/]\.codex[\\/]/.test(root)) return 'Codex: run codex plugin marketplace upgrade dandelion-kit, then codex plugin add dandelion-kit@dandelion-kit. Restart Codex, then call doctor to confirm the running version.';
  if (/[\\/]\.claude[\\/]plugins[\\/]cache[\\/]/.test(root)) return 'Claude Code: run claude plugin marketplace update dandelion-kit, then claude plugin update dandelion-kit@dandelion-kit. Restart the session, then call doctor to confirm the running version.';
  if (existsSync(join(root, 'manifest.json'))) return 'Claude Desktop: download the matching new desktop extension from the update guide, open it and accept the normal update prompt. Restart Claude, then call doctor to confirm the running version.';
  return 'Source setup: follow the update guide for your existing source folder. Preserve local changes and check the repository before updating. Restart the MCP app, then call doctor to confirm the running version.';
}
/** @type {any} */
let last;
/** @type {Promise<any>|undefined} */
let pending;
export function currentUpdateNotice() {
  return last?.available ? updateText(last) : '';
}
export function updateText(status) {
  const versions = `Dandelion Studio running version ${status.installed}.`;
  if (status.available) return `${versions} Update available: ${status.latest}. ${status.action} Guide: ${UPDATE_GUIDE}. Editing can continue. An update request lets your agent use the host's normal update steps; this check never installs anything.`;
  return `${versions} ${status.latest ? `Latest stable release: ${status.latest}.` : 'The update check is unavailable. Editing can continue.'}`;
}
/** Bounded check, cached on disk. Injection is for tests; production always uses the fixed public URL. */
export async function checkUpdates(options = {}) {
  const { fetchImpl = fetch, now = Date.now(), cacheFile = join(kitHome(), 'cache', 'release.json'), installed = installedVersion(), root = ROOT, timeoutMs = 1200 } = options;
  let cached;
  try { cached = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch {}
  const result = (latest, checked) => ({ installed, latest, available: newerVersion(latest, installed), checked, action: updateAction(root), guide: UPDATE_GUIDE });
  const age = now - cached?.at;
  if (Number.isFinite(age) && age >= 0 && age < (cached.ok ? TTL : RETRY) && (valid(cached.latest) || (!cached.ok && cached.latest === null))) return result(cached.latest, cached.ok);
  const controller = new AbortController();
  let timer;
  let latest = valid(cached?.latest) ? cached.latest : null;
  let ok = false;
  try {
    const response = await Promise.race([
      (async () => {
        const r = await fetchImpl(RELEASE_URL, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' }, redirect: 'error' });
        if (!r.ok) throw new Error('Release unavailable');
        const text = await r.text();
        if (text.length > 65536) throw new Error('Release too large');
        return JSON.parse(text);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Update check timed out')); }, timeoutMs); }),
    ]);
    const version = response?.tag_name?.replace(/^v/, '');
    if (!valid(version) || response.draft || response.prerelease) throw new Error('Invalid stable release');
    latest = version;
    ok = true;
  } catch {} finally { clearTimeout(timer); }
  try { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ at: now, latest, ok }) + '\n', { mode: 0o600 }); } catch {}
  return result(latest, ok);
}
/** Deduplicate simultaneous startup and doctor checks. Failures never escape into editing. */
export function studioUpdateStatus() {
  if (!pending) pending = checkUpdates().then((value) => { last = value; return value; }).finally(() => { pending = undefined; });
  return pending;
}
