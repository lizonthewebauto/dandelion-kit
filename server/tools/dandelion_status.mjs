import { getState, pendingConnect } from '../dandelion/client.mjs';
import { defineTool, ok } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

export const tool = defineTool({
  name: 'dandelion_status',
  title: 'Dandelion status',
  description:
    'Check whether Dandelion is signed in and show the workspace, plan, monthly use, brands, connected apps (with which can post) and a connect link for each app.',
  input: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run() {
    try {
      const dandelion = await getState({ fresh: true, strict: true });
      const waiting = pendingConnect();
      if (!dandelion.connected && waiting) {
        return ok(
          { dandelion, pending: true, connect_url: waiting.connect_url },
          `Waiting for you to finish signing in to Dandelion in your browser.${waiting.connect_url ? `\nIf the browser did not open, go to: ${waiting.connect_url}` : ''}`,
        );
      }
      return ok({ dandelion });
    } catch (error) {
      return asFail(error) ?? ok({ dandelion: { connected: false } });
    }
  },
});
