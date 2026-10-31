// ffmpeg helpers for the render path that the shared media code does not cover:
// runs with normal log output (loudness numbers are printed there), and a streaming raw-frame reader.
import { spawn } from 'node:child_process';
import { requireFfmpeg, KitMediaError } from '../media/ffmpeg.mjs';

/** Last few lines of ffmpeg's error text. @param {string} text */
function tailOf(text) {
  return text.split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
}

/**
 * Run ffmpeg with info-level logging and return everything it wrote to stderr.
 * @param {string[]} args
 * @param {{cwd?: string, signal?: AbortSignal, onProgress?: (p:{time_ms:number}) => void}} [options]
 * @returns {Promise<string>}
 */
export async function ffmpegLog(args, options = {}) {
  const { ffmpeg } = await requireFfmpeg();
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-y'];
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
    let buffer = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.stdout.on('data', (chunk) => {
      if (!options.onProgress) return;
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const m = /^out_time_(?:us|ms)=(-?\d+)/.exec(line);
        if (m && Number(m[1]) >= 0) options.onProgress?.({ time_ms: Math.round(Number(m[1]) / 1000) });
      }
    });
    child.on('error', (e) => reject(new KitMediaError(`ffmpeg could not start: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else
        reject(
          new KitMediaError(`ffmpeg stopped with code ${code}. ${tailOf(stderr)}`.trim(), { detail: stderr }),
        );
    });
  });
}

/**
 * Run ffmpeg that writes raw frames to stdout and hand each whole frame to a callback as it arrives.
 * Frames are handled one at a time (the callback may be async) and ffmpeg is paused while a handler is busy,
 * so a long video never fills memory.
 * @param {string[]} args  Must end with "-f rawvideo ... pipe:1".
 * @param {number} frameBytes
 * @param {(frame: Buffer, index: number) => void | Promise<void>} onFrame
 * @param {{signal?: AbortSignal, cwd?: string}} [options]
 * @returns {Promise<number>} number of frames read
 */
export async function streamRawFrames(args, frameBytes, onFrame, options = {}) {
  const { ffmpeg } = await requireFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], {
      cwd: options.cwd,
      windowsHide: true,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let carry = Buffer.alloc(0);
    let index = 0;
    let stderr = '';
    /** @type {Buffer[]} */
    const queue = [];
    let busy = false;
    let closed = false;
    /** @type {any} */
    let failure = null;
    let exitCode = 0;
    const finish = () => {
      if (!closed || busy || queue.length) return;
      if (failure) reject(failure);
      else if (exitCode === 0) resolve(index);
      else
        reject(
          new KitMediaError(`ffmpeg stopped with code ${exitCode}. ${tailOf(stderr)}`.trim(), {
            detail: stderr,
          }),
        );
    };
    const pump = async () => {
      if (busy) return;
      busy = true;
      try {
        while (queue.length && !failure) await onFrame(/** @type {Buffer} */ (queue.shift()), index++);
      } catch (error) {
        failure = error;
        child.kill();
      }
      busy = false;
      if (!closed && !failure) child.stdout.resume();
      finish();
    };
    child.stderr.on('data', (c) => (stderr += c));
    child.stdout.on('data', (chunk) => {
      carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      while (carry.length >= frameBytes) {
        queue.push(Buffer.from(carry.subarray(0, frameBytes)));
        carry = carry.subarray(frameBytes);
      }
      if (queue.length) {
        if (queue.length >= 2) child.stdout.pause();
        void pump();
      }
    });
    child.on('error', (e) => reject(new KitMediaError(`ffmpeg could not start: ${e.message}`)));
    child.on('close', (code) => {
      closed = true;
      exitCode = code ?? 1;
      finish();
    });
  });
}
