// Content hashing helpers.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** sha256 of a string, hex. */
export function hashString(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** JSON with sorted keys, so equal values always give the same text. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

/** sha256 of a JSON-able value, hex. */
export function hashJson(value) {
  return hashString(stableStringify(value));
}

/**
 * sha256 of a file, hex. Streams, so large videos do not fill memory.
 * @param {string} path
 * @returns {Promise<string>}
 */
export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** A short stable id such as "a_3f9c1d2e" built from a prefix and a seed. */
export function shortId(prefix, seed, length = 8) {
  return `${prefix}_${hashString(String(seed)).slice(0, length)}`;
}
