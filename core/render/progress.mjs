// One overall progress number (0 to 1) for a render, from the stage the render code reports.
// The render code reports each stage from 0 to 1 on its own (faces, audio, video, checks). A person watching a bar
// wants one number that only goes up, so each stage gets a share of the whole. The video step is most of the time.

/** @type {Record<string, [number, number]>} */
const SHARES = {
  faces: [0, 0.05],
  audio: [0.05, 0.1],
  video: [0.1, 0.93],
  checks: [0.93, 0.99],
};

/**
 * @param {string} stage      "faces", "audio", "video", "checks" or "done".
 * @param {number} fraction   0 to 1 inside that stage.
 * @returns {number | null}   0 to 1 overall, or null for a stage this does not know.
 */
export function overallProgress(stage, fraction) {
  if (stage === 'done') return 1;
  const share = SHARES[stage];
  if (!share) return null;
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return share[0] + (share[1] - share[0]) * f;
}
