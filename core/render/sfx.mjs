// Deterministic sound effect synth. Ten short sounds, built from sine waves and smoothed noise, so the kit
// ships no audio files and every machine makes byte-identical WAVs. Written to <kit home>/sfx.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SFX_NAMES } from '../types.mjs';
import { kitHome } from '../util/fs.mjs';

export const SFX_SAMPLE_RATE = 48000;
/** Bump when the synth changes, so old WAVs are rebuilt. */
export const SFX_VERSION = 'dandelion-kit-sfx-v1';

/** name: [length in seconds, target peak 0..1] */
const SPECS = Object.freeze({
  tap: [0.1, 0.28],
  submit: [0.2, 0.3],
  pop: [0.07, 0.3],
  whoosh: [0.28, 0.22],
  ding: [0.5, 0.22],
  riser: [1.2, 0.2],
  'bass-hit': [0.35, 0.32],
  snap: [0.12, 0.27],
  page: [0.24, 0.23],
  complete: [0.42, 0.29],
});

const TAU = 2 * Math.PI;
const smoothstep = (v) => {
  const n = Math.max(0, Math.min(1, v));
  return n * n * (3 - 2 * n);
};
const attackRelease = (t, dur, attack, release) => smoothstep(t / attack) * smoothstep((dur - t) / release);

/** Plucked sine with a little second harmonic. */
function pluck(t, dur, freq, attack = 0.006, decay = 12) {
  if (t < 0 || t >= dur) return 0;
  const env = attackRelease(t, dur, attack, 0.025) * Math.exp(-decay * t);
  return env * (Math.sin(TAU * freq * t) + 0.12 * Math.sin(2 * TAU * freq * t));
}

/** Repeatable noise in [-1, 1] for sample index i. */
function noise(i) {
  let v = ((i + 1) * 0x45d9f3b) >>> 0;
  v = (((v >>> 16) ^ v) * 0x45d9f3b) >>> 0;
  v = ((v >>> 16) ^ v) >>> 0;
  return (v / 0xffffffff) * 2 - 1;
}

/** Noise averaged over a few samples, so the hiss stays soft under speech. */
function softNoise(i, taps) {
  let sum = 0;
  for (let k = 0; k < taps; k++) sum += noise(i - k);
  return sum / taps;
}

/** Phase of a straight frequency sweep from f0 to f1 over `dur` seconds. */
const sweepPhase = (t, f0, f1, dur) => TAU * (f0 * t + ((f1 - f0) * t * t) / (2 * dur));

/** One raw sample (before level fitting). */
function sample(name, dur, t, i) {
  switch (name) {
    case 'tap':
      return (
        attackRelease(t, dur, 0.003, 0.025) *
        Math.exp(-30 * t) *
        (Math.sin(TAU * 620 * t) + 0.28 * Math.sin(TAU * 930 * t))
      );
    case 'submit':
      return pluck(t, 0.14, 440, 0.006, 15) * 0.72 + pluck(t - 0.068, 0.132, 660, 0.006, 14);
    case 'snap': {
      const env = attackRelease(t, dur, 0.0018, 0.018) * Math.exp(-39 * t);
      return env * (Math.sin(TAU * 1080 * t) + 0.32 * Math.sin(TAU * 1680 * t) + noise(i) * 0.14);
    }
    case 'page': {
      const p = t / dur;
      const env = Math.pow(Math.sin(Math.PI * p), 1.35);
      const f = 520 - 310 * smoothstep(p);
      const tex = Math.sin(TAU * f * t) + 0.24 * Math.sin(TAU * f * 1.7 * t) + 0.08 * noise(i);
      return attackRelease(t, dur, 0.012, 0.035) * env * tex;
    }
    case 'whoosh': {
      const p = t / dur;
      const env = Math.pow(Math.sin(Math.PI * p), 1.25);
      let cluster = 0;
      for (let k = 0; k < 6; k++) {
        const d = 0.82 + 0.072 * k;
        cluster += Math.sin(sweepPhase(t, 400 * d, 2400 * d, dur) + k * 1.947) / 6;
      }
      return attackRelease(t, dur, 0.02, 0.045) * env * (cluster + softNoise(i, 3) * (0.3 + 0.35 * p));
    }
    case 'pop': {
      const env = attackRelease(t, dur, 0.0022, 0.02) * Math.exp(-38 * t);
      const ph = sweepPhase(t, 900, 500, dur);
      return env * (Math.sin(ph) + 0.18 * Math.sin(2 * ph));
    }
    case 'ding': {
      const env = attackRelease(t, dur, 0.004, 0.05);
      return (
        env *
        (Math.exp(-6.5 * t) * Math.sin(TAU * 1318.51 * t) +
          0.42 * Math.exp(-9 * t) * Math.sin(TAU * 2637.02 * t))
      );
    }
    case 'riser': {
      const p = t / dur;
      const build = Math.pow(smoothstep(p), 1.35);
      const tone =
        Math.sin(sweepPhase(t, 220, 880, dur)) + 0.22 * Math.sin(sweepPhase(t, 440, 1760, dur) + 1.113);
      const tex = softNoise(i, 6) * (1 - 0.55 * p) + softNoise(i, 2) * 0.55 * p;
      return attackRelease(t, dur, 0.03, 0.006) * build * (tone + 0.5 * tex);
    }
    case 'bass-hit': {
      const ph = TAU * (40 * t + 15 * 0.055 * (1 - Math.exp(-t / 0.055)));
      return (
        attackRelease(t, dur, 0.0035, 0.04) *
        (Math.sin(ph) * Math.exp(-8.5 * t) + 0.3 * Math.sin(TAU * 1750 * t) * Math.exp(-330 * t))
      );
    }
    default: // complete: two rising notes
      return pluck(t, 0.31, 523.251, 0.012, 7) * 0.66 + pluck(t - 0.105, 0.315, 659.255, 0.014, 7.5);
  }
}

/**
 * Make one sound as a 16 bit mono WAV buffer.
 * @param {typeof SFX_NAMES[number]} name
 * @returns {{bytes: Buffer, peak: number, duration_ms: number}}
 */
export function synthSfx(name) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`There is no sound called "${name}".`);
  const [dur, targetPeak] = spec;
  const n = Math.round(dur * SFX_SAMPLE_RATE);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = sample(name, dur, i / SFX_SAMPLE_RATE, i);
  let mean = 0;
  for (const v of raw) mean += v;
  mean /= n;
  let top = 0;
  for (let i = 0; i < n; i++) {
    raw[i] -= mean;
    top = Math.max(top, Math.abs(raw[i]));
  }
  top = top || 1;
  const pcm = new Int16Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = i === 0 || i === n - 1 ? 0 : Math.max(-1, Math.min(1, (raw[i] / top) * targetPeak));
    pcm[i] = Math.round(v * 32767);
    peak = Math.max(peak, Math.abs(v));
  }
  const data = n * 2;
  const bytes = Buffer.alloc(44 + data);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + data, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SFX_SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SFX_SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(data, 40);
  for (let i = 0; i < n; i++) bytes.writeInt16LE(pcm[i], 44 + i * 2);
  return { bytes, peak, duration_ms: Math.round(dur * 1000) };
}

/** <kit home>/sfx */
export function sfxDir() {
  return join(kitHome(), 'sfx');
}

/**
 * @typedef {object} SfxLibrary
 * @property {string} dir
 * @property {Record<string, {path: string, peak: number, duration_ms: number, sha256: string}>} files
 */

/**
 * Write the ten WAVs (and a manifest) into a folder. Skips the work when they are already there and current.
 * @param {string} [dir]
 * @param {{force?: boolean}} [options]
 * @returns {SfxLibrary}
 */
export function ensureSfx(dir = sfxDir(), options = {}) {
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  if (!options.force && existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (
        m.version === SFX_VERSION &&
        SFX_NAMES.every((n) => m.files?.[n] && existsSync(join(dir, `${n}.wav`)))
      ) {
        /** @type {SfxLibrary['files']} */
        const files = {};
        for (const n of SFX_NAMES) files[n] = { ...m.files[n], path: join(dir, `${n}.wav`) };
        return { dir, files };
      }
    } catch {
      // Rebuild below.
    }
  }
  /** @type {SfxLibrary['files']} */
  const files = {};
  /** @type {Record<string, object>} */
  const manifestFiles = {};
  for (const name of SFX_NAMES) {
    const { bytes, peak, duration_ms } = synthSfx(name);
    const path = join(dir, `${name}.wav`);
    writeFileSync(path, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    files[name] = { path, peak, duration_ms, sha256 };
    manifestFiles[name] = { peak, duration_ms, sha256, bytes: bytes.length };
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({ version: SFX_VERSION, sample_rate: SFX_SAMPLE_RATE, files: manifestFiles }, null, 2) +
      '\n',
  );
  return { dir, files };
}
