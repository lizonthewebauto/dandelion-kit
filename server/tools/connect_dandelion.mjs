import { defineTool, notBuilt } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'connect_dandelion',
  title: 'Connect Dandelion',
  description:
    'Sign the person in to Dandelion (free) in their browser, so they can send this to Dandelion and approve or schedule posts. Opens the browser, waits up to 3 minutes, stores the sign-in on this computer, and returns the account, plan, brands and connected apps. The person types their password in the browser, never here.',
  input: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run() {
    return notBuilt('Signing in to Dandelion');
  },
});
