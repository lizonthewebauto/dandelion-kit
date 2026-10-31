// File helpers: the kit home folder, atomic writes, temp dirs.
import { mkdirSync, mkdtempSync, existsSync, statSync } from 'node:fs';
import { writeFile, rename, rm, readFile, copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** The kit home folder: DANDELION_KIT_HOME, or ~/.dandelion-kit. */
export function kitHome() {
  const fromEnv = process.env.DANDELION_KIT_HOME;
  return fromEnv && fromEnv.trim() ? fromEnv : join(homedir(), '.dandelion-kit');
}

/** Where model files live. DANDELION_KIT_MODELS overrides, mostly so tests can share one download. */
export function modelsDir() {
  const fromEnv = process.env.DANDELION_KIT_MODELS;
  return fromEnv && fromEnv.trim() ? fromEnv : join(kitHome(), 'models');
}

/** Make a folder (and its parents) if it is missing. Returns the path. */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** True when the path is an existing regular file. */
export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when the path exists (file or folder). */
export function pathExists(path) {
  return existsSync(path);
}

/** Make a fresh temp folder under the OS temp dir. */
export function makeTempDir(prefix = 'dandelion-kit-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Rename with a few short retries. Windows can briefly lock a file a reader just closed. */
export async function renameWithRetry(from, to, tries = 6) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!RETRY_CODES.has(/** @type {any} */ (error)?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30 * (i + 1)));
    }
  }
  throw lastError;
}

/**
 * Write a file atomically: write a sibling temp file, then rename over the target.
 * @param {string} path
 * @param {string | Uint8Array} data
 * @param {{mode?: number}} [options]
 */
export async function atomicWriteFile(path, data, options = {}) {
  ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, data, options.mode === undefined ? undefined : { mode: options.mode });
    await renameWithRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Write JSON atomically (pretty, with a trailing newline). */
export async function writeJson(path, value, options = {}) {
  await atomicWriteFile(path, JSON.stringify(value, null, 2) + '\n', options);
}

/** Read JSON, or return the fallback when the file is missing or unreadable. */
export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Copy a file, making the target folder first. */
export async function copyFileInto(from, to) {
  ensureDir(dirname(to));
  await copyFile(from, to);
}
