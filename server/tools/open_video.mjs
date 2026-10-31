import { openVideo } from '../store/video.mjs';
import { requireProject } from '../store/project.mjs';
import { projectCardData, ensurePoster } from '../lib/data.mjs';
import { startTranscription, transcribeJob } from '../lib/jobs.mjs';
import { cleanPath, defineTool, ok, z } from '../lib/kit.mjs';

export const tool = defineTool({
  name: 'open_video',
  title: 'Open a video',
  description:
    'Start a reel project from a video file on this computer. Reads the video, makes a 1080 by 1920 working copy and a small preview, and starts listening to the speech in the background. Returns the project id. Opening the same file again finds the same project. Next: rough_cut (it waits for the words if they are not ready).',
  input: {
    path: z.string().min(1).describe('Full path of the video file on this computer.'),
    title: z.string().optional().describe('A name for the project. Defaults to the file name.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, ctx) {
    const { project, reused } = await openVideo({
      path: cleanPath(args.path),
      title: args.title,
      signal: ctx.signal,
      onProgress: (_stage, fraction, message) => ctx.progress(fraction, message),
    });
    await ensurePoster(project.id);
    await startTranscription(project.id);
    const fresh = await requireProject(project.id);
    const job = transcribeJob(project.id);
    const data = projectCardData(fresh, {
      transcript_error: job?.error,
      transcribing: fresh.transcript_ready || !job ? undefined : job.progress,
    });
    return ok({ ...data, reused });
  },
});
