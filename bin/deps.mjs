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
 * True when every runtime dependency in the Kit's package.json is reachable from `root`.
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
  return names.every((name) => packageReachable(root, name));
}
