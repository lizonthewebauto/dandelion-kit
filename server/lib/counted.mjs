// How long an app counts a caption to be. Pure, no imports of the kit, so the post text, the checks and the card
// meter all agree on one number.

/** Count characters the way a person does: one emoji is one. @param {string|undefined} text */
function charCount(text) {
  return text ? [...text].length : 0;
}

/** Apps where the hashtags are written into the post text, so they count toward the caption limit. */
export const INLINE_HASHTAG_PLATFORMS = Object.freeze(['x', 'threads', 'tiktok', 'instagram']);

/** How many characters X counts for any link, however long. */
export const X_LINK_LENGTH = 23;

/**
 * The length an app counts for a caption. On apps where hashtags live in the post text this is the caption, a new
 * line, then the hashtags separated by spaces; on X every link counts 23. The card's meter, the
 * warning and the check all use this one number.
 * @param {string|undefined} platform   A channel id such as "x".
 * @param {{caption?: string, hashtags?: string[]}} copy
 * @returns {{total: number, with_hashtags: boolean}}
 */
export function countedLength(platform, copy) {
  let caption = copy.caption ?? '';
  if (platform === 'x') caption = caption.replace(/https?:\/\/\S+/gu, 'x'.repeat(X_LINK_LENGTH));
  let total = charCount(caption);
  const tags = (copy.hashtags ?? []).map((t) => String(t).trim()).filter(Boolean);
  const inline = !!platform && INLINE_HASHTAG_PLATFORMS.includes(platform) && tags.length > 0;
  if (inline) total += 1 + charCount(tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' '));
  return { total, with_hashtags: inline };
}
