import { statfs } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectFfmpeg, installHint } from '../../core/media/ffmpeg.mjs';
import { transformersModelStatus } from '../../core/transcribe/whisper.mjs';
import { ensureDir, isFile, kitHome, modelsDir } from '../../core/util/fs.mjs';
import { dandelionState } from '../lib/dandelion.mjs';
import { defineTool, ok } from '../lib/kit.mjs';

const MIN_FREE_BYTES = 3 * 1024 * 1024 * 1024;
const MIN_NODE_MAJOR = 20;

/** True when a face model file is already downloaded. */
function hasFaceModel() {
  const dir = modelsDir();
  const names = ['face_detection_yunet_2023mar.onnx', join('yunet', 'face_detection_yunet_2023mar.onnx')];
  if (names.some((n) => isFile(join(dir, n)))) return true;
  try {
    return readdirSync(dir).some((n) => /yunet.*\.onnx$/i.test(n));
  } catch {
    return false;
  }
}

/** Free bytes on the drive that holds the kit home folder. */
async function freeBytes() {
  try {
    const s = await statfs(ensureDir(kitHome()));
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return 0;
  }
}

/**
 * Everything doctor reports. Exported so the command line and tests can use it.
 * @returns {Promise<import('../../core/types.mjs').DoctorReport>}
 */
export async function buildDoctorReport() {
  const ff = await detectFfmpeg({ refresh: true });
  const models = transformersModelStatus();
  const free = await freeBytes();
  const major = Number(process.versions.node.split('.')[0]);
  const dandelion = await dandelionState();
  /** @type {import('../../core/types.mjs').DoctorReport} */
  const report = {
    ok: false,
    ffmpeg: {
      found: ff.found,
      ...(ff.path ? { path: ff.path } : {}),
      ...(ff.version ? { version: ff.version } : {}),
      has_ass: ff.has_ass,
      has_loudnorm: ff.has_loudnorm,
      has_whisper: ff.has_whisper,
      ...(ff.install_hint ? { install_hint: ff.install_hint } : {}),
    },
    node: { version: process.versions.node, ok: major >= MIN_NODE_MAJOR },
    disk: { free_bytes: free, ok: free >= MIN_FREE_BYTES },
    models: { dir: modelsDir(), whisper: models.base || models.tiny, yunet: hasFaceModel() },
    home: kitHome(),
    dandelion,
    next_steps: [],
  };
  report.ok = report.ffmpeg.found && report.ffmpeg.has_ass && report.ffmpeg.has_loudnorm && report.node.ok && report.disk.ok;

  const steps = report.next_steps;
  if (!ff.found) {
    steps.push(`Install ffmpeg with this command, then ask me to check again: ${ff.install_hint ?? installHint()}`);
    steps.push('Carousels and images work now, even without ffmpeg.');
  } else if (!ff.has_ass || !ff.has_loudnorm) {
    steps.push(`This ffmpeg cannot draw captions or set loudness. Install the full build with: ${ff.install_hint ?? installHint()}`);
  }
  if (!report.node.ok) steps.push(`Node ${MIN_NODE_MAJOR} or newer is needed. This is ${process.versions.node}.`);
  if (!report.disk.ok) steps.push('Free up some disk space. Reels need at least 3 GB free.');
  if (report.ok) {
    steps.push('Drop a video path and I will open it.');
    steps.push('Or tell me what carousel or image to make.');
  }
  if (!report.models.whisper) steps.push('The first video downloads a small speech model (about 80 MB). It happens once.');
  if (!dandelion.connected) steps.push('Optional: connect Dandelion (free) when you want to post. You can look at the versions first.');
  return report;
}

export const tool = defineTool({
  name: 'doctor',
  title: 'Check the kit',
  description:
    'Check this computer for what the kit needs: ffmpeg, Node, disk space, the speech and face models, and whether Dandelion is signed in. Call it first in a new session. A missing ffmpeg is a status with the install command, not an error.',
  input: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run() {
    return ok({ mode: 'status', doctor: await buildDoctorReport() });
  },
});
