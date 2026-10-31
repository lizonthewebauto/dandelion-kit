import { connect } from '../dandelion/client.mjs';
import { defineTool, fail, ok } from '../lib/kit.mjs';
import { asFail } from '../dandelion/outcome.mjs';

/** How long the tool waits for the person in the browser before it answers "still waiting". The sign-in itself stays open for 3 minutes. */
function waitMs() {
  const fromEnv = Number(process.env.DANDELION_KIT_CONNECT_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 50_000;
}

export const tool = defineTool({
  name: 'connect_dandelion',
  title: 'Connect Dandelion',
  description:
    'Sign the person in to Dandelion (free) in their browser, so they can send this to Dandelion and approve or schedule posts. Opens the browser, waits up to 3 minutes, stores the sign-in on this computer, and returns the account, plan, brands and connected apps. The person types their password in the browser, never here.',
  input: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(_args, ctx) {
    try {
      ctx.progress(0.05, 'Opening Dandelion sign-in in your browser');
      const r = await connect({ waitMs: waitMs() });
      if (r.connected) return ok({ dandelion: r.state });
      return ok(
        { dandelion: { connected: false }, pending: true, connect_url: r.connect_url },
        [
          'Waiting for you to finish signing in to Dandelion in your browser.',
          r.connect_url ? `If the browser did not open, go to: ${r.connect_url}` : 'The sign-in link is not ready yet.',
          'It stays open for 3 minutes. Then call dandelion_status to see that you are signed in. Nothing has been sent.',
        ].join('\n'),
      );
    } catch (error) {
      return asFail(error) ?? fail('Signing in to Dandelion did not work. Try "connect Dandelion" again.');
    }
  },
});
