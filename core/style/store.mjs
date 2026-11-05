// Only named choices and a logo copy live here. Samples are never stored.
import { readdir, readFile, rm, mkdir, chmod, lstat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
import { kitHome, atomicWriteFile } from '../util/fs.mjs';
import { parseStyle, nameSchema, likedSchema, notesSchema } from './schema.mjs';

const root = () => join(kitHome(), 'styles');
const pathFor = (slug) => join(root(), `${slug}.json`);
const pointer = () => join(root(), '_default.json');
const run = promisify(execFile);

export function slugify(name) {
  const clean = nameSchema.parse(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  if (!clean) throw new Error('name needs at least one letter from a to z or a digit.');
  return clean;
}

async function ensureRoot() {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  if ((await lstat(root())).isSymbolicLink()) throw new Error('The styles folder must be a plain folder.');
  await chmod(root(), 0o700);
  // File modes do not set Windows access rights. Child files inherit this user-only rule.
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${userInfo().username}`;
    await run('icacls.exe', [root(), '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true });
  }
}

async function load(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Style files must be plain files.');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

function validateSaved(saved) {
  if (!saved || saved.version !== 1 || slugify(saved.name) !== saved.slug) throw new Error('This style file is not valid. Save the style again.');
  const { version, name, slug, created_at, updated_at, ...choices } = saved;
  return { version, name, slug, created_at, updated_at, ...parseStyle(choices) };
}

export async function listStyles() {
  let files;
  try { files = await readdir(root()); } catch (error) { if (/** @type {any} */ (error).code === 'ENOENT') return []; throw error; }
  const out = [];
  for (const file of files.sort()) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}\.json$/.test(file)) continue;
    const saved = await load(join(root(), file));
    if (saved) out.push(validateSaved(saved));
  }
  return out;
}

export async function readStyle(name) {
  const saved = await load(pathFor(slugify(name)));
  if (!saved) throw new Error(`No saved style named ${name} was found. Call list_styles to see the names.`);
  return validateSaved(saved);
}

export async function defaultStyle() {
  const p = await load(pointer());
  if (!p || typeof p.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(p.slug)) return null;
  const saved = await load(pathFor(p.slug));
  return saved ? validateSaved(saved) : null;
}

/** @param {string} name @param {any} input @param {{liked?:any, notes?:string, make_default?:boolean}} [options] */
export async function saveStyle(name, input, options = {}) {
  name = nameSchema.parse(name);
  const slug = slugify(name);
  const choices = parseStyle(input);
  if (options.liked !== undefined) choices.liked = likedSchema.parse(options.liked);
  if (options.notes !== undefined) choices.notes = notesSchema.parse(options.notes);
  const styles = await listStyles();
  const old = styles.find((s) => s.slug === slug);
  if (!old && styles.length >= 50) throw new Error('You can save at most 50 styles. Remove one before you add another.');
  await ensureRoot();
  if (choices.brand?.logo) {
    const source = resolve(choices.brand.logo);
    try {
      const metadata = await sharp(source).metadata();
      if (!metadata.width || !metadata.height) throw new Error('No image size.');
      const extension = extname(source).toLowerCase();
      const safeExt = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.img';
      const dir = join(root(), slug);
      const dest = join(dir, `logo${safeExt}`);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await atomicWriteFile(dest, await readFile(source), { mode: 0o600 });
      choices.brand.logo = dest;
    } catch {
      throw new Error('brand.logo could not be read. Use a PNG, JPEG or WebP image file.');
    }
  }
  const now = new Date().toISOString();
  const style = { version: 1, name, slug, created_at: old?.created_at ?? now, updated_at: now, ...choices };
  const file = pathFor(slug);
  await atomicWriteFile(file, JSON.stringify(style, null, 2) + '\n', { mode: 0o600 });
  if (options.make_default ?? styles.length === 0) await atomicWriteFile(pointer(), JSON.stringify({ slug }) + '\n', { mode: 0o600 });
  return { style, file, is_default: (await defaultStyle())?.slug === slug, replaced: Boolean(old) };
}

export async function removeStyle(name) {
  const slug = slugify(name);
  if (!await load(pathFor(slug))) return { name, slug, removed: false, was_default: false };
  const style = await readStyle(name);
  const was_default = (await defaultStyle())?.slug === style.slug;
  await rm(pathFor(style.slug));
  // The slug cannot contain a path separator. Remove only this store's logo folder.
  await rm(join(root(), style.slug), { recursive: true, force: true });
  if (was_default) await rm(pointer(), { force: true });
  return { name: style.name, slug: style.slug, removed: true, was_default };
}
