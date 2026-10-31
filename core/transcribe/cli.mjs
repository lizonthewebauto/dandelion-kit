// `kit edit <video> --transcribe-only [--model base|tiny] [--engine auto|whisper-cli|transformers|ffmpeg] [--json]`
// Prints how long it took, how many words it heard, and the first words. Used for manual checks.
import { openVideo, transcribeProject } from '../../server/store/video.mjs';
import { transcriptText } from './types.mjs';

/** Pull "--name value" and "--flag" options out of an argument list. @param {string[]} args */
function parseArgs(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (
        next !== undefined &&
        !next.startsWith('--') &&
        ['model', 'engine', 'language', 'fit'].includes(name)
      ) {
        flags[name] = next;
        i++;
      } else flags[name] = true;
    } else positional.push(arg);
  }
  return { flags, positional };
}

/**
 * @param {string[]} args  Everything after "edit".
 * @returns {Promise<number>} exit code
 */
export async function runTranscribeOnly(args) {
  const { flags, positional } = parseArgs(args);
  const videoPath = positional[0];
  if (!videoPath) {
    process.stderr.write(
      'Usage: kit edit <video> --transcribe-only [--model base|tiny] [--engine auto|whisper-cli|transformers|ffmpeg]\n',
    );
    return 2;
  }
  const progress = (stage, fraction, message) => {
    if (message) process.stderr.write(`[kit] ${stage} ${Math.round(fraction * 100)}% ${message}\n`);
  };
  const started = Date.now();
  const { project, reused } = await openVideo({
    path: videoPath,
    onProgress: progress,
    fit: flags.fit === 'pad' ? 'pad' : 'crop',
  });
  const openedMs = Date.now() - started;
  const result = await transcribeProject(project.id, {
    model: flags.model === 'tiny' ? 'tiny' : 'base',
    engine: /** @type {any} */ (typeof flags.engine === 'string' ? flags.engine : 'auto'),
    language: typeof flags.language === 'string' ? flags.language : 'en',
    force: true,
    onProgress: progress,
  });
  const words = result.transcript.words;
  const summary = {
    project_id: project.id,
    engine: result.transcript.engine,
    quality: result.transcript.quality,
    open_ms: openedMs,
    reused_media: reused,
    transcribe_ms: result.elapsed_ms,
    total_ms: Date.now() - started,
    words: words.length,
    segments: result.transcript.segments.length,
    first_30_words: words
      .slice(0, 30)
      .map((w) => w.text)
      .join(' '),
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify({ summary, transcript: result.transcript }, null, 2) + '\n');
  } else {
    process.stdout.write(
      [
        `Project: ${summary.project_id}`,
        `Engine: ${summary.engine} (${summary.quality})`,
        `Prepare media: ${(openedMs / 1000).toFixed(1)} s${reused ? ' (reused)' : ''}`,
        `Transcribe: ${(result.elapsed_ms / 1000).toFixed(1)} s`,
        `Total: ${(summary.total_ms / 1000).toFixed(1)} s`,
        `Words: ${summary.words} in ${summary.segments} segments`,
        `First 30 words: ${summary.first_30_words}`,
        '',
        transcriptText(result.transcript),
        '',
      ].join('\n'),
    );
  }
  return 0;
}
