// A tiny field language for layouts: one description gives the zod schema, the character budgets
// and the plain-words error messages. Nothing is truncated. A field over its budget is an error.
import { z } from 'zod';

/**
 * @typedef {{kind:'text', max:number, optional:boolean}} TextField
 * @typedef {{kind:'path', optional:boolean}} PathField
 * @typedef {{kind:'list', of: FieldNode, min:number, max:number}} ListField
 * @typedef {{kind:'object', shape: Record<string, FieldNode>, optional:boolean}} ObjectField
 * @typedef {TextField | PathField | ListField | ObjectField} FieldNode
 */

/** Short text with a character budget. @param {number} max @param {{optional?:boolean}} [o] @returns {TextField} */
export const text = (max, o = {}) => ({ kind: 'text', max, optional: !!o.optional });

/** A file path (an image on disk). @param {{optional?:boolean}} [o] @returns {PathField} */
export const path = (o = {}) => ({ kind: 'path', optional: !!o.optional });

/** A list with a size range. @param {FieldNode} of @param {number} min @param {number} max @returns {ListField} */
export const list = (of, min, max) => ({ kind: 'list', of, min, max });

/** A group of named fields. @param {Record<string, FieldNode>} shape @param {{optional?:boolean}} [o] @returns {ObjectField} */
export const obj = (shape, o = {}) => ({ kind: 'object', shape, optional: !!o.optional });

/** Count characters the way a person does (emoji and accents count once). */
export function charCount(s) {
  return [...s].length;
}

/**
 * The zod schema for a field node.
 * @param {FieldNode} node
 * @returns {z.ZodType}
 */
export function toZod(node) {
  /** @type {z.ZodType} */
  let t;
  if (node.kind === 'text') t = z.string().trim().min(1).max(node.max);
  else if (node.kind === 'path') t = z.string().trim().min(1);
  else if (node.kind === 'list') t = z.array(toZod(node.of)).min(node.min).max(node.max);
  else t = z.strictObject(Object.fromEntries(Object.entries(node.shape).map(([k, v]) => [k, toZod(v)])));
  return 'optional' in node && node.optional ? t.optional() : t;
}

/** @param {Record<string, FieldNode>} shape */
export function shapeToZod(shape) {
  return z.strictObject(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, toZod(v)])));
}

/** "items, entry 3, text" from ['items', 2, 'text'] @param {(string|number)[]} p */
function describe(p) {
  const parts = [];
  for (const seg of p) parts.push(typeof seg === 'number' ? `entry ${seg + 1}` : seg);
  return parts.join(', ');
}

/**
 * Check a layout's fields and return a cleaned copy plus plain-words issues.
 * @param {Record<string, FieldNode>} shape
 * @param {any} input
 * @param {{layout: string, budgets?: boolean}} opts   budgets=false skips the length limits (allow-overflow).
 * @returns {{value: Record<string, any>, issues: string[], over: string[]}}  over lists the length problems only.
 */
export function checkFields(shape, input, opts) {
  /** @type {string[]} */
  const issues = [];
  /** @type {string[]} */
  const over = [];
  const budgets = opts.budgets !== false;
  const allowed = Object.keys(shape).join(', ');

  /** @param {FieldNode} node @param {any} v @param {(string|number)[]} p @returns {any} */
  const walk = (node, v, p) => {
    const name = describe(p);
    const absent = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (absent) {
      const optional = 'optional' in node && node.optional;
      if (!optional) issues.push(`"${name}" is missing.`);
      return undefined;
    }
    if (node.kind === 'text') {
      if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
      if (typeof v !== 'string') {
        issues.push(`"${name}" must be text.`);
        return undefined;
      }
      const s = v.trim();
      const n = charCount(s);
      if (budgets && n > node.max) {
        const msg = `"${name}" is ${n} characters; the limit is ${node.max}. Cut ${n - node.max}.`;
        issues.push(msg);
        over.push(msg);
      }
      return s;
    }
    if (node.kind === 'path') {
      if (typeof v !== 'string') {
        issues.push(`"${name}" must be a file path.`);
        return undefined;
      }
      return v.trim();
    }
    if (node.kind === 'list') {
      if (!Array.isArray(v)) {
        issues.push(`"${name}" must be a list.`);
        return undefined;
      }
      if (v.length < node.min) issues.push(`"${name}" needs at least ${node.min} ${node.min === 1 ? 'entry' : 'entries'}.`);
      if (budgets && v.length > node.max) {
        const msg = `"${name}" has ${v.length} entries; the limit is ${node.max}.`;
        issues.push(msg);
        over.push(msg);
      }
      return v.map((item, i) => walk(node.of, item, [...p, i]));
    }
    // object
    if (typeof v !== 'object' || Array.isArray(v)) {
      issues.push(`"${name}" must be a group of fields (${Object.keys(node.shape).join(', ')}).`);
      return undefined;
    }
    for (const key of Object.keys(v)) {
      if (!(key in node.shape)) issues.push(`"${[...p, key].join(', ')}" is not a field here. Use: ${Object.keys(node.shape).join(', ')}.`);
    }
    return Object.fromEntries(Object.entries(node.shape).map(([k, child]) => [k, walk(child, v[k], [...p, k])]));
  };

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push(`The fields must be an object. The ${opts.layout} layout uses: ${allowed}.`);
    return { value: {}, issues, over };
  }
  for (const key of Object.keys(input)) {
    if (!(key in shape)) issues.push(`"${key}" is not a field of the ${opts.layout} layout. Use: ${allowed}.`);
  }
  const value = Object.fromEntries(Object.entries(shape).map(([k, node]) => [k, walk(node, input[k], [k])]));
  return { value, issues, over };
}
