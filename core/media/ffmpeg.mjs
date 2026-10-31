// Finds ffmpeg (FFMPEG_PATH, kit bin folder, PATH), checks features, shows the install command,
// and runs ffmpeg / ffprobe with plain-word errors.
import { spawn } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { kitHome, isFile } from '../util/fs.mjs';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

/**
 * @typedef {object} FfmpegStatus
 * @property {boolean} found                 True when both ffmpeg and ffprobe were found and run.
 * @property {string} [path]                 Absolute path of ffmpeg.
 * @property {string} [ffprobe_path]
 * @property {string} [version]
 * @property {'env'|'kit-bin'|'path'} [source]
 * @property {boolean} has_ass               The libass "ass" filter (captions).
 * @property {boolean} has_loudnorm
 * @property {boolean} has_whisper           The "whisper" filter (whisper.cpp inside ffmpeg).
 * @property {string} [install_hint]         A command to run when something is missing.
 * @property {string} [problem]              One plain sentence when found is false.
 */

/** The command that installs a full ffmpeg build on each OS. @param {string} [os] */
export function installHint(os = process.platform) {
  if (os === 'win32') return 'winget install Gyan.FFmpeg';
  if (os === 'darwin') return 'brew install ffmpeg';
  return 'sudo apt install ffmpeg';
}

/** Placeholder for a future guided download. v1 never downloads ffmpeg; use installHint(). */
export async function downloadFfmpeg() {
  return { ok: false, reason: 'not_supported', install_hint: installHint() };
}

/** Find an executable on PATH. @param {string} name without extension */
function findOnPath(name) {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir.replace(/^"|"$/g, ''), name + EXE);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Find an executable on PATH by name. Used for optional tools such as whisper-cli. @param {string} name */
export function findExecutable(name) {
  return findOnPath(name);
}

/** Candidate ffmpeg locations in priority order. */
function ffmpegCandidates() {
  /** @type {{path:string, source:'env'|'kit-bin'|'path'}[]} */
  const list = [];
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    // FFMPEG_PATH may be the exe itself or the folder that holds it.
    list.push({ path: isFile(fromEnv) ? fromEnv : join(fromEnv, 'ffmpeg' + EXE), source: 'env' });
  }
  list.push({ path: join(kitHome(), 'bin', 'ffmpeg' + EXE), source: 'kit-bin' });
  const onPath = findOnPath('ffmpeg');
  if (onPath) list.push({ path: onPath, source: 'path' });
  return list;
}

function findFfprobeFor(ffmpegPath) {
  const sibling = join(dirname(ffmpegPath), 'ffprobe' + EXE);
  if (isFile(sibling)) return sibling;
  return findOnPath('ffprobe');
}

/**
 * Run a command, collect stdout and stderr as text.
 * @param {string} command
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<{code:number, out:string, err:string}>}
 */
export function runCommand(command, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, out, err: String(error) });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** Parse the filter names out of `ffmpeg -filters` text. @param {string} text */
export function parseFilterNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[A-Z.|]{2,4}\s+([a-z0-9_]+)\s/i.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Pull the version out of the first line of `ffmpeg -version`. @param {string} text */
export function parseVersion(text) {
  const match = /ffmpeg version\s+(\S+)/i.exec(text);
  return match ? match[1] : undefined;
}

/** @type {FfmpegStatus | null} */
let cached = null;

/**
 * Find ffmpeg and report what it can do. Cached for the life of the process.
 * @param {{refresh?: boolean}} [options]
 * @returns {Promise<FfmpegStatus>}
 */
export async function detectFfmpeg(options = {}) {
  if (cached && !options.refresh) return cached;
  const hint = installHint();
  for (const candidate of ffmpegCandidates()) {
    if (!isFile(candidate.path)) continue;
    const versionRun = await runCommand(candidate.path, ['-hide_banner', '-version']);
    const version = parseVersion(versionRun.out);
    if (versionRun.code !== 0 || !version) continue;
    const ffprobe = findFfprobeFor(candidate.path);
    if (!ffprobe) {
      cached = {
        found: false,
        path: candidate.path,
        version,
        source: candidate.source,
        has_ass: false,
        has_loudnorm: false,
        has_whisper: false,
        install_hint: hint,
        problem: 'ffmpeg is here but ffprobe is missing. Install the full ffmpeg build.',
      };
      return cached;
    }
    const filtersRun = await runCommand(candidate.path, ['-hide_banner', '-filters']);
    const filters = parseFilterNames(filtersRun.out);
    const has_ass = filters.has('ass');
    cached = {
      found: true,
      path: candidate.path,
      ffprobe_path: ffprobe,
      version,
      source: candidate.source,
      has_ass,
      has_loudnorm: filters.has('loudnorm'),
      has_whisper: filters.has('whisper'),
      // A build without libass cannot draw captions, so point at the full build.
      ...(has_ass ? {} : { install_hint: hint }),
    };
    return cached;
  }
  cached = {
    found: false,
    has_ass: false,
    has_loudnorm: false,
    has_whisper: false,
    install_hint: hint,
    problem: 'ffmpeg was not found on this computer.',
  };
  return cached;
}

/** Forget the cached detection (tests, or after the person installs ffmpeg). */
export function resetFfmpegCache() {
  cached = null;
}

/** A media failure with a message meant for a person. */
export class KitMediaError extends Error {
  /** @param {string} message @param {{detail?: string}} [extra] */
  constructor(message, extra = {}) {
    super(message);
    this.name = 'KitMediaError';
    /** @type {string | undefined} */
    this.detail = extra.detail;
  }
}

/** Return the ffmpeg paths or throw a plain error. */
export async function requireFfmpeg() {
  const status = await detectFfmpeg();
  if (!status.found || !status.path || !status.ffprobe_path) {
    throw new KitMediaError(
      `${status.problem ?? 'ffmpeg was not found.'} Install it with: ${status.install_hint ?? installHint()}`,
    );
  }
  return { ffmpeg: status.path, ffprobe: status.ffprobe_path, status };
}

function lastLines(text, count = 6) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-count)
    .join('\n');
}

/**
 * Run ffmpeg. Resolves when it exits 0. Rejects with a plain message and the last log lines.
 * @param {string[]} args
 * @param {{cwd?: string, signal?: AbortSignal, onProgress?: (p:{time_ms:number}) => void}} [options]
 * @returns {Promise<{stderr: string}>}
 */
export async function runFfmpeg(args, options = {}) {
  const { ffmpeg } = await requireFfmpeg();
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  if (options.onProgress) full.push('-progress', 'pipe:1', '-nostats');
  full.push(...args);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, full, {
      cwd: options.cwd,
      windowsHide: true,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let progressBuffer = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    child.stdout.on('data', (chunk) => {
      if (!options.onProgress) return;
      progressBuffer += chunk;
      let newline;
      while ((newline = progressBuffer.indexOf('\n')) >= 0) {
        const line = progressBuffer.slice(0, newline).trim();
        progressBuffer = progressBuffer.slice(newline + 1);
        // out_time_us and out_time_ms are both microseconds in ffmpeg's progress output.
        const match = /^out_time_(?:us|ms)=(-?\d+)/.exec(line);
        if (match && Number(match[1]) >= 0)
          options.onProgress?.({ time_ms: Math.round(Number(match[1]) / 1000) });
      }
    });
    child.on('error', (error) => {
      if (/** @type {any} */ (error).name === 'AbortError') reject(new KitMediaError('Stopped.'));
      else reject(new KitMediaError(`ffmpeg could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else {
        reject(
          new KitMediaError(`ffmpeg stopped with code ${code}. ${lastLines(stderr)}`.trim(), {
            detail: stderr,
          }),
        );
      }
    });
  });
}

/**
 * Run ffmpeg and return what it writes to stdout (for raw audio pipes).
 * @param {string[]} args  Must end with an output of "pipe:1".
 * @param {{signal?: AbortSignal, maxBytes?: number}} [options]
 * @returns {Promise<Buffer>}
 */
export async function captureFfmpeg(args, options = {}) {
  const { ffmpeg } = await requireFfmpeg();
  const maxBytes = options.maxBytes ?? 1024 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
      windowsHide: true,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let stderr = '';
    let failed = false;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        child.kill();
        reject(new KitMediaError('That audio is too long to read in one go.'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => reject(new KitMediaError(`ffmpeg could not start: ${error.message}`)));
    child.on('close', (code) => {
      if (failed) return;
      if (code === 0) resolve(Buffer.concat(chunks));
      else {
        reject(
          new KitMediaError(`ffmpeg stopped with code ${code}. ${lastLines(stderr)}`.trim(), {
            detail: stderr,
          }),
        );
      }
    });
  });
}

/**
 * Run ffprobe and return stdout text.
 * @param {string[]} args
 * @returns {Promise<string>}
 */
export async function runFfprobe(args) {
  const { ffprobe } = await requireFfmpeg();
  const result = await runCommand(ffprobe, ['-hide_banner', '-v', 'error', ...args], 60000);
  if (result.code !== 0) {
    throw new KitMediaError(`ffprobe could not read that file. ${lastLines(result.err)}`.trim(), {
      detail: result.err,
    });
  }
  return result.out;
}
