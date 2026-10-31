#!/usr/bin/env node
// Copy check. Fails when a text file has an em dash, an en dash, or a banned word.
//   node scripts/check-copy.mjs            check this repo
//   node scripts/check-copy.mjs --dir <p>  check another folder (used by tests)
// Scans .md .mjs .js .json .html .css. Skips node_modules, .git, test fixtures and package-lock.json.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = /\.(md|mjs|js|json|html|css)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'fixtures']);
const SKIP_FILES = new Set(['package-lock.json']);

/** Em dash and en dash, built from char codes so this file stays clean. */
const DASHES = [
  { name: 'em dash', char: String.fromCharCode(0x2014) },
  { name: 'en dash', char: String.fromCharCode(0x2013) },
];

/**
 * Words the kit never uses in its own copy. Built from pieces so this file does not trip its own check.
 * Use the plain words from the plan's vocabulary list instead.
 */
const BANNED_WORDS = [
  ['beat', 'sheet'],
  ['style', 'plan'],
  ['trial', 'reels'],
  ['auto', 'pilot'],
  ['chin', 'lock'],
  ['stu', 'dio'],
  ['render', 'lock'],
  ['reel', 'gate'],
].map((parts) => ({
  name: parts.join(' '),
  re: new RegExp(`\\b${parts.join('[\\s_-]*')}\\b`, 'i'),
}));

/** @param {string} dir @param {string[]} out */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile() && EXT.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Scan one folder.
 * @param {string} root
 * @returns {{scanned: number, findings: string[]}}
 */
export function scanCopy(root) {
  const base = resolve(root);
  const findings = [];
  const files = walk(base);
  for (const file of files) {
    const rel = relative(base, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const d of DASHES) {
        if (line.includes(d.char)) findings.push(`${rel}:${i + 1}: ${d.name}`);
      }
      for (const w of BANNED_WORDS) {
        if (w.re.test(line)) findings.push(`${rel}:${i + 1}: banned word "${w.name}"`);
      }
    });
  }
  return { scanned: files.length, findings };
}

function main() {
  const i = process.argv.indexOf('--dir');
  const root = i > -1 ? process.argv[i + 1] : join(fileURLToPath(import.meta.url), '..', '..');
  if (!root) {
    console.error('[check-copy] --dir needs a folder');
    process.exit(2);
  }
  const { scanned, findings } = scanCopy(root);
  if (findings.length) {
    console.error(`[check-copy] FAILED (${findings.length}) in ${scanned} files:`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[check-copy] ok: ${scanned} files checked`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
