import { defineTool, notBuilt } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'dandelion_status',
  title: 'Dandelion status',
  description:
    'Check whether Dandelion is signed in and show the workspace, plan, monthly use, brands, connected apps (with which can post) and a connect link for each app.',
  input: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run() {
    return notBuilt('Checking Dandelion');
  },
});
