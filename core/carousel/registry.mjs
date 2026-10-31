// The twelve layouts in one place.
import { LAYOUT_IDS } from '../types.mjs';
import { shapeToZod } from './fields.mjs';
import { layout as cover } from './layouts/cover.mjs';
import { layout as list } from './layouts/list.mjs';
import { layout as steps } from './layouts/steps.mjs';
import { layout as stat } from './layouts/stat.mjs';
import { layout as comparison } from './layouts/comparison.mjs';
import { layout as quote } from './layouts/quote.mjs';
import { layout as checklist } from './layouts/checklist.mjs';
import { layout as mythFact } from './layouts/myth-fact.mjs';
import { layout as beforeAfter } from './layouts/before-after.mjs';
import { layout as cta } from './layouts/cta.mjs';
import { layout as photoHero } from './layouts/photo-hero.mjs';
import { layout as framework } from './layouts/framework.mjs';

/**
 * @typedef {object} Layout
 * @property {string} id
 * @property {'default'|'accent'|'photo'} theme
 * @property {boolean} [needsImage]
 * @property {{footer?: boolean}} [chrome]
 * @property {Record<string, import('./fields.mjs').FieldNode>} fields
 * @property {Record<string, any>} sample    Example fields that fit the budgets.
 * @property {(f: Record<string, any>, ctx: import('./ui.mjs').Ctx) => {main: any, bleed?: any[], align?: 'center'|'end'}} render
 */

/** @type {Record<string, Layout>} */
export const LAYOUTS = Object.fromEntries(
  [cover, list, steps, stat, comparison, quote, checklist, mythFact, beforeAfter, cta, photoHero, framework].map((l) => [l.id, /** @type {Layout} */ (l)]),
);

for (const id of LAYOUT_IDS) {
  if (!LAYOUTS[id]) throw new Error(`carousel layout "${id}" is missing`);
}

/** The zod schema for one layout's fields. @param {string} id */
export function layoutSchema(id) {
  return shapeToZod(LAYOUTS[id].fields);
}

/** A plain-words summary of one layout's fields and limits, for tool descriptions and error help. @param {string} id */
export function describeLayout(id) {
  const l = LAYOUTS[id];
  /** @param {import('./fields.mjs').FieldNode} n @returns {string} */
  const one = (n) => {
    if (n.kind === 'text') return `text up to ${n.max} characters${n.optional ? ' (optional)' : ''}`;
    if (n.kind === 'path') return 'path to an image file';
    if (n.kind === 'list') return `${n.min === n.max ? n.max : `${n.min} to ${n.max}`} x [${one(n.of)}]`;
    return `{ ${Object.entries(n.shape)
      .map(([k, v]) => `${k}: ${one(v)}`)
      .join('; ')} }`;
  };
  return Object.entries(l.fields)
    .map(([k, v]) => `${k}: ${one(v)}`)
    .join('\n');
}
