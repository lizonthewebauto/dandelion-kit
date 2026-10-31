import { listProjects } from '../store/project.mjs';
import { lookName, renderIsFresh } from '../lib/data.mjs';
import { defineTool, ok } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'list_projects',
  title: 'Recent projects',
  description: 'List recent kit projects (videos and carousels), newest first, so you can pick one up again.',
  input: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run() {
    const all = (await listProjects()).filter((p) => !(/** @type {any} */ (p).hidden));
    return ok({
      projects: all.slice(0, 30).map((p) => ({
        id: p.id,
        title: p.title,
        type: p.type,
        updated_at: p.updated_at,
        duration_ms: p.media?.duration_ms,
        transcript_ready: p.transcript_ready,
        look_id: p.look_id,
        look_name: lookName(p.look_id),
        has_final: renderIsFresh(p, 'final'),
        slides: p.carousel?.rendered?.length,
      })),
    });
  },
});
