import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineTool, fail, ok, z } from '../lib/kit.mjs';

/**
 * Open the folder (or show the file inside its folder) in the OS file manager. Never runs a file.
 * @param {string} path
 * @returns {boolean} False when the path does not exist.
 */
export function revealInFileManager(path) {
  const full = resolve(path);
  let isDir = false;
  try {
    isDir = statSync(full).isDirectory();
  } catch {
    return false;
  }
  /** @type {string} */
  let program;
  /** @type {string[]} */
  let args;
  if (process.platform === 'win32') {
    program = 'explorer.exe';
    args = isDir ? [full] : [`/select,${full}`];
  } else if (process.platform === 'darwin') {
    program = 'open';
    args = isDir ? [full] : ['-R', full];
  } else {
    program = 'xdg-open';
    args = [isDir ? full : dirname(full)];
  }
  try {
    const child = spawn(program, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The folder could not be shown. The path is still in the text for the person to open by hand.
  }
  return true;
}

export const tool = defineTool({
  name: 'open_path',
  title: 'Show in folder',
  description:
    "Show a file or folder in the computer's file manager (File Explorer, Finder). It only shows the location; it never opens or runs the file.",
  input: { path: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    if (ctx.demo) return ok({ ok: true, path: args.path }, `Demo mode: would show ${args.path} in the file manager.`);
    if (!revealInFileManager(args.path)) return fail(`I could not find ${args.path} on this computer.`);
    return ok({ ok: true, path: resolve(args.path) });
  },
});
