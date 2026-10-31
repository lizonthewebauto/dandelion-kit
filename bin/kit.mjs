#!/usr/bin/env node
// Zero-dependency bootstrap. Installs the packages on first run, then starts the MCP server (serve)
// or runs a command line step (doctor, edit, carousel, offer, connect).
//
//   kit serve [--demo]                  MCP server over stdio. Hosts run this. stdout carries MCP frames only.
//   kit doctor                          check this computer
//   kit edit <video> [options]          open, cut, plan, build and export a reel
//   kit edit <video> --transcribe-only  just print the transcript
//   kit carousel <spec.json> [--out]    render a carousel from a spec file
//   kit offer <bundle.json>             build the per-app versions for a post
//   kit connect                         sign in to Dandelion
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createForwarder } from './shim-forward.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

const USAGE = `Dandelion Kit: edit videos into Reels, make carousels and images, post with Dandelion.

Usage:
  kit serve [--demo]                    Start the MCP server (hosts run this).
  kit doctor                            Check ffmpeg, Node, disk and models.
  kit edit <video> [--look <id>] [--caption-theme <id>] [--accent #RRGGBB] [--preset gentle|standard|punchy]
                   [--hook "text"] [--out <folder>] [--draft-only] [--variants <2-4>]
  kit edit <video> --transcribe-only    Print the transcript only.
  kit carousel <spec.json> [--out <folder>]
  kit offer <bundle.json>               Per-app versions for a post: {kind, text, files, channels}
  kit connect                           Sign in to Dandelion.
  kit version
`;

/** @param {string} text */
function err(text) {
  process.stderr.write(`${text}\n`);
}

/** Wait without busy looping. @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** True when the packages are installed. */
function depsReady() {
  return existsSync(join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
}

/**
 * Install the packages once (a plugin install does not run npm). Output goes to stderr, never stdout.
 * @returns {boolean}
 */
function ensureDependencies() {
  if (depsReady()) return true;
  const npm = IS_WIN ? 'npm.cmd' : 'npm';
  const check = spawnSync(npm, ['--version'], { shell: IS_WIN, stdio: 'ignore' });
  if (check.status !== 0) {
    err('Dandelion Kit needs npm to finish setup. Install Node.js from https://nodejs.org, then run: npm install --omit=dev');
    err(`(in the folder ${ROOT})`);
    return false;
  }
  const lock = join(ROOT, '.kit-install.lock');
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Another start is installing. Wait for it; a lock older than 5 minutes is stale.
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > 5 * 60 * 1000) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (depsReady()) return true;
      if (Date.now() - started > 6 * 60 * 1000) {
        err('Waited too long for another install to finish. Remove the folder .kit-install.lock and try again.');
        return false;
      }
      sleep(1000);
    }
  }
  try {
    if (depsReady()) return true;
    err('Dandelion Kit: installing its packages (once, about a minute)...');
    const run = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: ROOT,
      shell: IS_WIN,
      stdio: ['ignore', 2, 2],
    });
    if (run.status !== 0 || !depsReady()) {
      err(`Dandelion Kit: the install did not finish. Run "npm install --omit=dev" in ${ROOT} and look at the message.`);
      return false;
    }
    err('Dandelion Kit: packages installed.');
    return true;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// First run: answer the host right away while the packages install
// ---------------------------------------------------------------------------

/**
 * A plugin install has no node_modules, and npm takes a minute. A host waits only about 30 seconds for an MCP server to
 * answer "initialize", so on a first run this answers the handshake itself with one small tool, installs the packages in a
 * child process, then loads the real server onto the same stdin and stdout and tells the host the tool list changed.
 * Zero dependencies. stdout carries MCP messages only.
 * @param {boolean} demo
 */
async function serveWithSetup(demo) {
  const version = (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    } catch {
      return '0.0.0';
    }
  })();
  const send = (/** @type {any} */ obj) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`);
  let status = 'Dandelion Kit is setting up for the first time. This takes about a minute. Ask again shortly.';
  let failed = false;
  let handedOff = false;
  /** @type {string | null} */
  let initLine = null;
  let initId = null;
  let sawInitialized = false;
  let buf = '';

  const reply = (/** @type {any} */ msg) => {
    switch (msg.method) {
      case 'initialize':
        send({
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'dandelion-kit', version },
            instructions: 'Dandelion Kit is finishing its first-time setup (about a minute). The real tools appear when it is done.',
          },
        });
        break;
      case 'tools/list':
        send({
          id: msg.id,
          result: {
            tools: [
              {
                name: 'setup_status',
                description: 'Dandelion Kit is finishing its first-time setup. Call this to see how it is going. The editing tools appear when it is done.',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        });
        break;
      case 'tools/call':
        send({ id: msg.id, result: { content: [{ type: 'text', text: status }], isError: failed } });
        break;
      case 'resources/list':
        send({ id: msg.id, result: { resources: [] } });
        break;
      case 'resources/templates/list':
        send({ id: msg.id, result: { resourceTemplates: [] } });
        break;
      case 'prompts/list':
        send({ id: msg.id, result: { prompts: [] } });
        break;
      case 'ping':
        send({ id: msg.id, result: {} });
        break;
      default:
        if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: 'Dandelion Kit is still setting up.' } });
    }
  };

  /** @param {string} line */
  const onLine = (line) => {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method === 'initialize') {
      initLine = line;
      initId = msg.id;
    }
    if (msg.method === 'notifications/initialized') sawInitialized = true;
    reply(msg);
  };
  /** @param {string|Buffer} chunk */
  const onData = (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  process.stdin.on('end', () => {
    if (!handedOff) process.exit(0);
  });

  // Install in a child so the handshake keeps being answered. It reuses the lock logic in ensureDependencies.
  err('Dandelion Kit: first run, installing packages in the background...');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'install-deps'], { stdio: ['ignore', 2, 2] });
  child.on('exit', async (code) => {
    if (code !== 0 || !depsReady()) {
      failed = true;
      status = `Dandelion Kit could not finish its setup. Run "npm install --omit=dev" in ${ROOT} and look at the message, then start a new session.`;
      return;
    }
    try {
      const { PassThrough } = await import('node:stream');
      const inp = new PassThrough();
      const out = new PassThrough();
      const { startStdio } = await import('../server/index.mjs');
      await startStdio({ demo, stdin: inp, stdout: out });
      // The real server's answer to the replayed initialize is dropped: the host already got one.
      out.setEncoding('utf8');
      let outBuf = '';
      let dropped = initLine === null;
      out.on('data', (/** @type {string} */ chunk) => {
        outBuf += chunk;
        let i;
        while ((i = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, i);
          outBuf = outBuf.slice(i + 1);
          if (!line.trim()) continue;
          if (!dropped) {
            try {
              if (JSON.parse(line).id === initId) {
                dropped = true;
                continue;
              }
            } catch {
              // Not JSON; pass it on.
            }
          }
          process.stdout.write(`${line}\n`);
        }
      });
      handedOff = true;
      process.stdin.off('data', onData);
      if (initLine) inp.write(`${initLine}\n`);
      if (initLine && sawInitialized) inp.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      // Forward line by line (the unfinished line in buf included) so a setup_status call from a host that ignored
      // list_changed gets an answer here, since the real server has no such tool.
      const forward = createForwarder((l) => inp.write(l), send, buf);
      buf = '';
      process.stdin.on('data', (c) => forward.push(c));
      process.stdin.on('end', () => {
        forward.flush();
        inp.end();
      });
      send({ method: 'notifications/tools/list_changed' });
      err('Dandelion Kit: setup finished, tools are ready.');
    } catch (error) {
      failed = true;
      status = `Dandelion Kit installed but could not start: ${/** @type {any} */ (error)?.message ?? error}`;
      err(status);
    }
  });
}

/**
 * Read --flag and --key value pairs. Flags in `bools` take no value.
 * @param {string[]} args
 */
function parseArgs(args) {
  const bools = new Set(['demo', 'draft-only', 'json', 'allow-overflow', 'transcribe-only']);
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (bools.has(key) || i + 1 >= args.length || args[i + 1].startsWith('--')) flags[key] = true;
      else flags[key] = args[++i];
    } else positional.push(a);
  }
  return { flags, positional };
}

/** Run one tool from the command line and print its text. @returns {Promise<{ok: boolean, data?: any}>} */
async function runTool(/** @type {string} */ name, /** @type {any} */ args) {
  const { toolByName } = await import('../server/lib/tools.mjs');
  const { toMcpResult } = await import('../server/index.mjs');
  const { friendlyError } = await import('../server/lib/kit.mjs');
  const def = toolByName(name);
  if (!def) throw new Error(`There is no tool called ${name}.`);
  const parsed = (await import('zod')).z.object(def.input).safeParse(args);
  if (!parsed.success) {
    err(friendlyError(parsed.error).text);
    return { ok: false };
  }
  let last = -1;
  const ctx = {
    demo: false,
    progress(/** @type {number} */ fraction, /** @type {string|undefined} */ message) {
      const pct = Math.round(fraction * 100);
      if (message && pct !== last) {
        err(`[kit] ${pct}% ${message}`);
        last = pct;
      }
    },
  };
  let outcome;
  try {
    outcome = await def.run(parsed.data, ctx);
  } catch (error) {
    outcome = { isError: true, text: friendlyError(error).text };
  }
  const result = toMcpResult(name, outcome);
  process.stdout.write(`${result.content[0].text}\n`);
  return { ok: !result.isError, data: outcome.data };
}

/** @param {string[]} rest */
async function cmdEdit(rest) {
  const { flags, positional } = parseArgs(rest);
  const video = positional[0];
  if (!video) {
    err('Usage: kit edit <video> [--look <id>] [--out <folder>]. Run "kit" for all options.');
    return 2;
  }
  // On the command line there is no host timeout, so wait for each build to finish instead of answering "still building".
  process.env.DANDELION_KIT_RENDER_WAIT_MS = '2000000000';
  if (flags['transcribe-only']) {
    const { runTranscribeOnly } = await import('../core/transcribe/cli.mjs');
    return runTranscribeOnly(rest.filter((a) => a !== '--transcribe-only'));
  }
  // The render path may bring its own edit command. Use it when it exists.
  if (flags.look) {
    const file = join(ROOT, 'core', 'render', 'cli.mjs');
    if (existsSync(file)) {
      const mod = await import(pathToFileURL(file).href);
      const fn = mod.runEdit ?? mod.run ?? mod.default;
      if (typeof fn === 'function') return Number((await fn(rest)) ?? 0);
    }
  }

  const opened = await runTool('open_video', { path: video });
  if (!opened.ok) return 1;
  const projectId = opened.data.project.id;
  /** @type {[string, any][]} */
  const steps = [
    ['rough_cut', { project_id: projectId, ...(flags.preset ? { preset: flags.preset } : {}) }],
    [
      'pick_look',
      {
        project_id: projectId,
        look: typeof flags.look === 'string' ? flags.look : 'karaoke-clean',
        ...(flags['caption-theme'] ? { caption_theme: flags['caption-theme'] } : {}),
        ...(flags.accent ? { accent: flags.accent } : {}),
      },
    ],
    ['plan_shots', { project_id: projectId, ...(typeof flags.hook === 'string' ? { hook_text: flags.hook } : {}) }],
    ['render_reel', { project_id: projectId, quality: 'draft' }],
  ];
  if (!flags['draft-only']) steps.push(['render_reel', { project_id: projectId, quality: 'final' }]);
  if (flags.variants && !flags['draft-only']) steps.push(['make_variants', { project_id: projectId, count: Number(flags.variants) }]);
  if (!flags['draft-only']) steps.push(['export', { project_id: projectId, ...(typeof flags.out === 'string' ? { to_dir: flags.out } : {}) }]);
  for (const [name, args] of steps) {
    process.stdout.write(`\n== ${name} ==\n`);
    const r = await runTool(/** @type {string} */ (name), args);
    if (!r.ok) return 1;
  }
  return 0;
}

/**
 * @param {string[]} rest
 * @param {string} tool
 * @param {string} label
 */
async function cmdFromJson(rest, tool, label) {
  const { flags, positional } = parseArgs(rest);
  const file = positional[0];
  if (!file) {
    err(`Usage: kit ${label} <file.json>`);
    return 2;
  }
  let spec;
  try {
    spec = JSON.parse(readFileSync(resolve(file), 'utf8'));
  } catch {
    err(`I could not read ${resolve(file)} as JSON.`);
    return 2;
  }
  if (tool === 'make_carousel' && flags['allow-overflow']) spec.allow_overflow = true;
  const r = await runTool(tool, spec);
  return r.ok ? 0 : 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === 'version' || command === '--version') {
    process.stdout.write(`${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}\n`);
    return 0;
  }
  if (command === 'install-deps') return ensureDependencies() ? 0 : 1;
  if (command === 'serve' && !depsReady()) {
    await serveWithSetup(rest.includes('--demo'));
    return null; // keep running
  }
  if (!ensureDependencies()) return 1;

  switch (command) {
    case 'serve': {
      const { startStdio } = await import('../server/index.mjs');
      await startStdio({ demo: rest.includes('--demo') });
      return null; // keep running
    }
    case 'doctor':
      return (await runTool('doctor', {})).ok ? 0 : 1;
    case 'edit':
      return cmdEdit(rest);
    case 'carousel':
      return cmdFromJson(rest, 'make_carousel', 'carousel');
    case 'offer':
      return cmdFromJson(rest, 'offer_post', 'offer');
    case 'connect': {
      // From the command line there is no card to poll, so wait the full 3 minutes for the browser.
      process.env.DANDELION_KIT_CONNECT_WAIT_MS ??= String(3 * 60 * 1000);
      err('Opening Dandelion in your browser. Sign in there and allow the Dandelion Kit. This waits up to 3 minutes.');
      const connected = await runTool('connect_dandelion', {});
      try {
        const { closeSession } = await import('../server/dandelion/client.mjs');
        await closeSession();
      } catch {
        // Nothing to close.
      }
      return connected.ok ? 0 : 1;
    }
    default:
      err(`I do not know the command "${command}".\n`);
      process.stdout.write(USAGE);
      return 2;
  }
}

try {
  const code = await main();
  if (code !== null) process.exitCode = code;
} catch (error) {
  err(`${/** @type {any} */ (error)?.message ?? error}`);
  process.exitCode = 1;
}
