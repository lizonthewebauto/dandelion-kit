import { listProjects, loadProject, MAX_CHUNK_BYTES, readAssetChunk, ProjectError } from '../store/project.mjs';
import { defineTool, z } from '../lib/kit.mjs';

/** @type {Map<string, string>} */
const owners = new Map();

/**
 * Find the project that registered an asset id. Remembers the answer; scans the projects when it is new.
 * @param {string} assetId
 */
export async function findAssetProject(assetId) {
  const known = owners.get(assetId);
  if (known) {
    const project = await loadProject(known);
    if (project?.assets?.[assetId]) return project;
    owners.delete(assetId);
  }
  for (const project of await listProjects()) {
    if (project.assets?.[assetId]) {
      owners.set(assetId, project.id);
      return project;
    }
  }
  throw new ProjectError(`I have no file with id ${assetId}.`);
}

export const tool = defineTool({
  name: 'read_asset',
  title: 'Read a project file',
  description:
    'Used by the cards to load pictures and video in pieces (up to 200,000 bytes per call, base64). Only files that belong to a kit project can be read. You do not need to call this.',
  input: {
    asset_id: z.string(),
    offset: z.number().int().min(0).default(0),
    bytes: z.number().int().min(1).max(MAX_CHUNK_BYTES).default(MAX_CHUNK_BYTES),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const project = await findAssetProject(args.asset_id);
    const chunk = await readAssetChunk(project, args.asset_id, args.offset, args.bytes);
    const end = args.offset + Math.ceil((chunk.data.length * 3) / 4);
    return {
      data: chunk,
      text: `${chunk.mime}, bytes ${args.offset} to ${Math.min(end, chunk.total)} of ${chunk.total}${chunk.has_more ? ', more to read' : ''}.`,
    };
  },
});
