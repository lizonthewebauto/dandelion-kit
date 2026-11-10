// Setup checks that run before any package is loaded.
export const MIN_NODE_VERSION = '20.9.0';

/** @param {string} [version] */
export function nodeVersionSupported(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 20 || (major === 20 && minor >= 9);
}

/** @param {string} [version] @returns {string|null} */
export function nodeVersionProblem(version = process.versions.node) {
  return nodeVersionSupported(version) ? null : `Dandelion Studio needs Node.js ${MIN_NODE_VERSION} or newer. This is ${version}. Install a current Node.js version from https://nodejs.org, then try again.`;
}

/** CPU use needs no extra GPU downloads. Keep a person's explicit install choice.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function installEnvironment(env = process.env) {
  return { ...env, ONNXRUNTIME_NODE_INSTALL: env.ONNXRUNTIME_NODE_INSTALL ?? 'skip' };
}
