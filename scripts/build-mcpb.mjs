#!/usr/bin/env node
// Build the Claude Desktop bundle (.mcpb) for THIS computer's platform.
//   node scripts/build-mcpb.mjs [--out <folder>] [--keep]
// Steps: copy the runtime files into a staging folder, install production packages there (npm ci --omit=dev),
// drop native binaries for other systems, write the manifest, then pack with @anthropic-ai/mcpb.
// The bundle is platform specific because sharp and onnxruntime ship native code. Output:
//   <out>/dandelion-kit-<version>-<platform>-<arch>.mcpb   (default out folder: dist)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const PLATFORM_FOR_MANIFEST = process.platform; // darwin, win32, linux

/** @param {string} flag */
function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/**
 * Run a command and stop the build if it fails.
 * @param {string} cmd @param {string[]} args @param {string} cwd
 */
function run(cmd, args, cwd) {
  console.error(`> ${cmd} ${args.join(' ')}`);
  // With shell:true on Windows the arguments are joined as text, so quote any that hold a space.
  const safe = IS_WIN ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, safe, { cwd, stdio: 'inherit', shell: IS_WIN });
  if (r.status !== 0) {
    console.error(`[build-mcpb] "${cmd} ${args.join(' ')}" failed.`);
    process.exit(1);
  }
}

/** Total bytes under a folder. @param {string} dir */
function folderSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? folderSize(p) : statSync(p).size;
  }
  return total;
}

/**
 * Remove native binaries that belong to other systems so the bundle stays small.
 * @param {string} staging
 */
function pruneOtherPlatforms(staging) {
  const keepOs = process.platform;
  const keepArch = process.arch;
  const ort = join(staging, 'node_modules', 'onnxruntime-node', 'bin');
  if (existsSync(ort)) {
    for (const napi of readdirSync(ort)) {
      const napiDir = join(ort, napi);
      for (const os of readdirSync(napiDir)) {
        if (os !== keepOs) {
          rmSync(join(napiDir, os), { recursive: true, force: true });
          continue;
        }
        for (const arch of readdirSync(join(napiDir, os))) {
          if (arch !== keepArch) rmSync(join(napiDir, os, arch), { recursive: true, force: true });
        }
      }
    }
  }
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const out = resolve(arg('--out') ?? join(ROOT, 'dist'));
  const staging = join(ROOT, 'tmp', 'mcpb-staging');
  const file = join(out, `dandelion-kit-${version}-${process.platform}-${process.arch}.mcpb`);

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  mkdirSync(out, { recursive: true });

  for (const name of ['bin', 'core', 'server', 'assets']) cpSync(join(ROOT, name), join(staging, name), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'README.md']) {
    cpSync(join(ROOT, name), join(staging, name));
  }

  const manifest = JSON.parse(readFileSync(join(ROOT, 'mcpb', 'manifest.json'), 'utf8'));
  manifest.version = version;
  manifest.compatibility = { ...manifest.compatibility, platforms: [PLATFORM_FOR_MANIFEST] };
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  run(IS_WIN ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], staging);
  pruneOtherPlatforms(staging);
  console.error(`[build-mcpb] staging is ${(folderSize(staging) / 1048576).toFixed(0)} MB`);

  rmSync(file, { force: true });
  run(IS_WIN ? 'npx.cmd' : 'npx', ['-y', '@anthropic-ai/mcpb', 'pack', staging, file], ROOT);

  if (!existsSync(file)) {
    console.error('[build-mcpb] the bundle file was not created.');
    process.exit(1);
  }
  console.error(`[build-mcpb] wrote ${file} (${(statSync(file).size / 1048576).toFixed(1)} MB)`);
  console.log(file);
  if (!process.argv.includes('--keep')) rmSync(staging, { recursive: true, force: true });
}

main();
