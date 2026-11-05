import { REPORTING_NOTICE, usageReporter } from '../../core/util/usage-reporting.mjs';
import { defineTool, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'usage_reporting',
  title: 'Optional usage counts',
  description: `Read or change optional usage counts. ${REPORTING_NOTICE} Read the notice to the person and get an explicit yes before action on. An install request is not consent. Do not ask again in later sessions after they chose on or off.`,
  input: { action: z.enum(['status', 'on', 'off']).default('status') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, ctx) {
    if (ctx.demo) return ok({ enabled: false }, 'This is a sample. Usage counts stay off.');
    const state = args.action === 'status' ? await usageReporter.status() : await usageReporter.setEnabled(args.action === 'on');
    if (state.enabled) await usageReporter.installed();
    return ok(state, `${state.blocked ? 'Usage counts are off for this run.' : state.enabled ? 'Optional usage counts are on.' : 'Optional usage counts are off.'} ${REPORTING_NOTICE}`);
  },
});
