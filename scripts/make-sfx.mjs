// Regenerate the sound effect WAV files: node scripts/make-sfx.mjs [--out <folder>]
import { resolve } from 'node:path';
import { ensureSfx, sfxDir } from '../core/render/sfx.mjs';

const at = process.argv.indexOf('--out');
const dir = at >= 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : sfxDir();
const library = ensureSfx(dir, { force: true });
for (const [name, file] of Object.entries(library.files)) {
  process.stdout.write(
    `${name.padEnd(9)} ${String(file.duration_ms).padStart(5)} ms  peak ${file.peak.toFixed(3)}  ${file.sha256.slice(0, 12)}\n`,
  );
}
process.stdout.write(`Wrote ${Object.keys(library.files).length} sounds to ${library.dir}\n`);
