// Are the Kit's packages installed? Zero dependencies, so the bootstrap and the hooks can both use it.
// Looks the way Node does: in the Kit's own node_modules, then in every parent folder's node_modules.
// npx and some plugin installers put the packages one level up, next to the Kit, not inside it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * True when a package folder for `name` is reachable from `root` by Node's lookup.
 * @param {string} root
 * @param {string} name
 */
export function packageReachable(root, name) {
  let dir = root;
  for (;;) {
    if (existsSync(join(dir, 'node_modules', ...name.split('/'), 'package.json'))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * Where to install the packages. Codex replaces a plugin's whole version folder at the start of every session, which
 * wipes a node_modules inside it, sometimes while the Kit is already running. So inside a plugin cache
 * (.../plugins/cache/<marketplace>/<plugin>/<version>) they go in the plugins folder. Node's lookup still finds them there.
 * @param {string} root
 */
export function depsHome(root) {
  const match = /^(.*[\\/]plugins)[\\/]cache[\\/]/.exec(root);
  return match ? match[1] : root;
}

/** @param {string} dir */
function readVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return undefined;
  }
}

/**
 * True when every runtime dependency in the Kit's package.json is reachable from `root`. Packages shared outside the
 * version folder must also come from this Kit version, so an update installs its own.
 * @param {string} root
 */
export function depsReady(root) {
  /** @type {string[]} */
  let names;
  try {
    names = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    names = ['@modelcontextprotocol/sdk'];
  }
  const home = depsHome(root);
  if (home !== root && readVersion(home) !== readVersion(root)) return false;
  return names.every((name) => packageReachable(root, name));
}
