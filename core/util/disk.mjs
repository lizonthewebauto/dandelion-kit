// Free disk space check.
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathExists } from './fs.mjs';

const GB = 1024 * 1024 * 1024;

/** The most free space a render asks for. A two minute reel needs about this much while it builds. */
export const MIN_FREE_BYTES = 3 * GB;

/**
 * The free space a render of this length should start with: 1 GB plus 25 MB a second, up to MIN_FREE_BYTES,
 * so a person with little room can still make a short clip.
 * @param {number} [durationMs]  Leave out when the length is not known.
 */
export function renderSpaceBytes(durationMs) {
  if (!(Number(durationMs) > 0)) return MIN_FREE_BYTES;
  return Math.min(MIN_FREE_BYTES, GB + (Number(durationMs) / 1000) * 25 * 1024 * 1024);
}

/**
 * Free bytes on the disk that holds a path (the nearest folder that exists is used).
 * Returns Infinity when the platform cannot say, so a missing answer never blocks work.
 * @param {string} path
 * @returns {Promise<number>}
 */
export async function freeBytes(path) {
  let dir = path;
  while (!pathExists(dir) && dirname(dir) !== dir) dir = dirname(dir);
  try {
    const info = await statfs(dir);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return Infinity;
  }
}

/**
 * Throw a plain error when less than `needed` bytes are free where `path` lives.
 * @param {string} path
 * @param {number} [needed]
 */
export async function requireFreeSpace(path, needed = MIN_FREE_BYTES) {
  const free = await freeBytes(path);
  if (free < needed) {
    const gb = (n) => (n / 1024 / 1024 / 1024).toFixed(1);
    throw new Error(
      `There is only ${gb(free)} GB free on this disk and a render needs ${gb(needed)} GB. Free some space and try again.`,
    );
  }
}
