// Project store under the kit home folder, plus the asset registry used by read_asset.
// Layout: <kit home>/projects/<id>/project.json, with the project's files beside it.
import { open, readdir, stat, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ASSET_KINDS } from '../../core/types.mjs';
import { ensureDir, isFile, kitHome, readJson, writeJson } from '../../core/util/fs.mjs';
import { shortId } from '../../core/util/hash.mjs';

/** The most bytes read_asset hands back in one call. */
export const MAX_CHUNK_BYTES = 200000;

const ID_PATTERN = /^p_[a-z0-9]{4,32}$/;

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ass': 'text/x-ssa',
  '.srt': 'application/x-subrip',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/** A plain-words failure from the store. */
export class ProjectError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ProjectError';
  }
}

/** The mime type for a file name, by extension. @param {string} path */
export function mimeFor(path) {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** <kit home>/projects */
export function projectsDir() {
  return join(kitHome(), 'projects');
}

/**
 * The folder for a project. Throws on an id that could point outside the projects folder.
 * @param {string} id
 */
export function projectDir(id) {
  if (!ID_PATTERN.test(String(id))) throw new ProjectError(`"${id}" is not a project id.`);
  return join(projectsDir(), id);
}

function projectFile(id) {
  return join(projectDir(id), 'project.json');
}

/** A new random project id such as "p_3fa91c07". */
export function newProjectId() {
  return `p_${randomBytes(4).toString('hex')}`;
}

/** The project id for a video, from its content hash. Opening the same video again finds the same project. @param {string} sourceHash */
export function videoProjectId(sourceHash) {
  return `p_${sourceHash.slice(0, 10)}`;
}

/**
 * Make and save a project.
 * @param {{type: 'video'|'carousel', title: string, id?: string, source_path?: string, source_hash?: string}} fields
 * @returns {Promise<import('../../core/types.mjs').Project>}
 */
export async function createProject(fields) {
  const id = fields.id ?? newProjectId();
  const now = Date.now();
  /** @type {import('../../core/types.mjs').Project} */
  const project = {
    id,
    type: fields.type,
    title: fields.title,
    created_at: now,
    updated_at: now,
    assets: {},
    transcript_ready: false,
    cut_applied: false,
  };
  if (fields.source_path) project.source_path = fields.source_path;
  if (fields.source_hash) project.source_hash = fields.source_hash;
  ensureDir(projectDir(id));
  await writeJson(projectFile(id), project);
  return project;
}

/**
 * Read a project. Returns null when it does not exist.
 * @param {string} id
 * @returns {Promise<import('../../core/types.mjs').Project | null>}
 */
export async function loadProject(id) {
  return /** @type {any} */ (await readJson(projectFile(id), null));
}

/** Read a project or throw a plain error. @param {string} id */
export async function requireProject(id) {
  const project = await loadProject(id);
  if (!project)
    throw new ProjectError(`I could not find project ${id}. Open the video again to start a new one.`);
  return project;
}

/** Save a project (updates updated_at). @param {import('../../core/types.mjs').Project} project */
export async function saveProject(project) {
  project.updated_at = Date.now();
  ensureDir(projectDir(project.id));
  await writeJson(projectFile(project.id), project);
  return project;
}

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();

/**
 * Change a project safely: read, run the change, save. Changes to one project run one at a time.
 * The change may edit the project in place or return a replacement.
 * @template T
 * @param {string} id
 * @param {(project: import('../../core/types.mjs').Project) => T | Promise<T>} change
 * @returns {Promise<{project: import('../../core/types.mjs').Project, result: Awaited<T>}>}
 */
export function updateProject(id, change) {
  const previous = queues.get(id) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const project = await requireProject(id);
      const result = await change(project);
      const saved =
        result && typeof result === 'object' && 'id' in result && 'assets' in result
          ? /** @type {any} */ (result)
          : project;
      await saveProject(saved);
      return { project: saved, result: /** @type {Awaited<T>} */ (result) };
    });
  queues.set(id, run);
  run
    .finally(() => {
      if (queues.get(id) === run) queues.delete(id);
    })
    .catch(() => {});
  return run;
}

/**
 * All projects, most recently changed first.
 * @returns {Promise<import('../../core/types.mjs').Project[]>}
 */
export async function listProjects() {
  let names = [];
  try {
    names = await readdir(projectsDir());
  } catch {
    return [];
  }
  const projects = [];
  for (const name of names) {
    if (!ID_PATTERN.test(name)) continue;
    const project = await loadProject(name);
    if (project) projects.push(project);
  }
  return projects.sort((a, b) => b.updated_at - a.updated_at);
}

/**
 * Find the video project made from this exact file content, if there is one.
 * @param {string} sourceHash
 * @returns {Promise<import('../../core/types.mjs').Project | null>}
 */
export async function findBySourceHash(sourceHash) {
  const direct = await loadProject(videoProjectId(sourceHash));
  if (direct?.source_hash === sourceHash) return direct;
  const all = await listProjects();
  return all.find((project) => project.source_hash === sourceHash) ?? null;
}

/** Delete one project folder. Only the kit's own project folders can be removed. @param {string} id */
export async function deleteProject(id) {
  await rm(projectDir(id), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

/**
 * Register a file on a project so read_asset can serve it. The same kind and path always give the same id.
 * Edits the project in memory; save it afterwards (or call this inside updateProject).
 * @param {import('../../core/types.mjs').Project} project
 * @param {{path: string, kind: typeof ASSET_KINDS[number], label?: string, mime?: string}} entry
 * @returns {Promise<import('../../core/types.mjs').Asset>}
 */
export async function registerAsset(project, entry) {
  if (!ASSET_KINDS.includes(entry.kind))
    throw new ProjectError(`"${entry.kind}" is not a kind of project file.`);
  const path = resolve(entry.path);
  if (!isFile(path)) throw new ProjectError(`I could not find the file ${path} to add to the project.`);
  const info = await stat(path);
  /** @type {import('../../core/types.mjs').Asset} */
  const asset = {
    id: shortId('a', `${entry.kind}:${path}`),
    path,
    mime: entry.mime ?? mimeFor(path),
    bytes: info.size,
    kind: entry.kind,
  };
  if (entry.label) asset.label = entry.label;
  project.assets[asset.id] = asset;
  return asset;
}

/**
 * Find a registered asset. Only files registered on the project can be read.
 * @param {import('../../core/types.mjs').Project} project
 * @param {string} assetId
 */
export function getAsset(project, assetId) {
  const asset = project.assets?.[assetId];
  if (!asset) throw new ProjectError(`This project has no file with id ${assetId}.`);
  return asset;
}

/**
 * Read one chunk of a registered asset, base64. At most MAX_CHUNK_BYTES per call.
 * @param {import('../../core/types.mjs').Project} project
 * @param {string} assetId
 * @param {number} offset
 * @param {number} [bytes]
 * @returns {Promise<import('../../core/types.mjs').AssetChunk>}
 */
export async function readAssetChunk(project, assetId, offset, bytes = MAX_CHUNK_BYTES) {
  const asset = getAsset(project, assetId);
  if (!Number.isInteger(offset) || offset < 0)
    throw new ProjectError('The offset must be a whole number, zero or more.');
  const want = Math.max(1, Math.min(MAX_CHUNK_BYTES, Math.floor(bytes) || MAX_CHUNK_BYTES));
  let handle;
  try {
    handle = await open(asset.path, 'r');
  } catch {
    throw new ProjectError(`The file for ${assetId} is gone from disk (${asset.path}).`);
  }
  try {
    const total = (await handle.stat()).size;
    if (offset > total)
      throw new ProjectError(`The offset ${offset} is past the end of the file (${total} bytes).`);
    const length = Math.min(want, total - offset);
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, offset);
    return {
      data: buffer.toString('base64'),
      mime: asset.mime,
      total,
      has_more: offset + length < total,
    };
  } finally {
    await handle.close();
  }
}
