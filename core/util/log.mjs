// Logging to stderr and the kit log file. Never to stdout (stdout carries MCP frames).
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, kitHome } from './fs.mjs';

let fileFailed = false;

function write(level, parts) {
  const text = parts
    .map((part) =>
      typeof part === 'string' ? part : part instanceof Error ? part.message : JSON.stringify(part),
    )
    .join(' ');
  process.stderr.write(`[kit] ${text}\n`);
  if (fileFailed) return;
  try {
    const dir = ensureDir(join(kitHome(), 'logs'));
    appendFileSync(join(dir, 'kit.log'), `${new Date().toISOString()} ${level} ${text}\n`);
  } catch {
    fileFailed = true;
  }
}

/** @param {...any} parts */
export function info(...parts) {
  write('info', parts);
}

/** @param {...any} parts */
export function warn(...parts) {
  write('warn', parts);
}

/** @param {...any} parts */
export function error(...parts) {
  write('error', parts);
}

/** Only prints when KIT_DEBUG is set. @param {...any} parts */
export function debug(...parts) {
  if (process.env.KIT_DEBUG) write('debug', parts);
}
