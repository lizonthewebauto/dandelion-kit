// How a Dandelion failure becomes a tool answer.

/**
 * A Dandelion failure as a tool answer in plain words, or null when the error is something else.
 * @param {unknown} error
 * @returns {import('../lib/kit.mjs').ToolOutcome | null}
 */
export function asFail(error) {
  const e = /** @type {any} */ (error);
  if (e && (e.name === 'DandelionError' || e.name === 'NotSignedInError')) {
    return { isError: true, text: e.message, data: { error: e.code ?? 'dandelion_error' } };
  }
  return null;
}
