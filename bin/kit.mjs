// Zero-dependency bootstrap. Installs dependencies on first run, then starts the server (serve) or runs a subcommand (doctor, edit, carousel, offer, connect).
// Stub from the scaffold. Built in milestone M5.
// M1 adds only the `edit <video> --transcribe-only` route below. M5 owns the rest of this file and should keep that route.

const [command, ...rest] = process.argv.slice(2);

if (command === 'edit' && rest.includes('--transcribe-only')) {
  const { runTranscribeOnly } = await import('../core/transcribe/cli.mjs');
  try {
    process.exitCode = await runTranscribeOnly(rest.filter((arg) => arg !== '--transcribe-only'));
  } catch (error) {
    process.stderr.write(`${/** @type {any} */ (error)?.message ?? error}\n`);
    process.exitCode = 1;
  }
}

export {};
