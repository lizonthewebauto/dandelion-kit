import { defineTool, notBuilt, z } from '../lib/kit.mjs';
export const tool = defineTool({
  name: 'analyze_samples', title: 'Learn from samples',
  description: 'Measure one or more sample images or videos and show a picture for your AI to look at. Samples stay on this computer. Ask what the person likes before saving a style.',
  input: { paths: z.array(z.string()).min(1).max(20) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run() { return notBuilt('Reading sample styles'); },
});
