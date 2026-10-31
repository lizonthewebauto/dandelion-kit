import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  detectFfmpeg,
  installHint,
  parseFilterNames,
  parseVersion,
  downloadFfmpeg,
  requireFfmpeg,
} from '../core/media/ffmpeg.mjs';
import { mediaInfoFromProbe, parseRate, probeMedia, probeAudio } from '../core/media/probe.mjs';
import { ingestVideo, workVideoFilter, PROXY_MAX_BYTES_PER_MINUTE } from '../core/media/ingest.mjs';
import { sampleFrames, sampleFramesEvery } from '../core/media/frames.mjs';
import { makeTempDir } from '../core/util/fs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'fixture-6s.mp4');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');

/** @type {string} */
let temp;

async function bin(name) {
  const status = await detectFfmpeg();
  return /** @type {string} */ (name === 'ffprobe' ? status.ffprobe_path : status.path);
}
before(() => {
  temp = makeTempDir('kit-media-test-');
});
after(() => {
  rmSync(temp, { recursive: true, force: true });
});

function jpegInfo(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes[0], 0xff, `${path} is not a JPEG`);
  assert.equal(bytes[1], 0xd8, `${path} is not a JPEG`);
  return bytes.length;
}

test('install hints name the right command for each OS', () => {
  assert.equal(installHint('win32'), 'winget install Gyan.FFmpeg');
  assert.equal(installHint('darwin'), 'brew install ffmpeg');
  assert.equal(installHint('linux'), 'sudo apt install ffmpeg');
  assert.match(installHint(), /ffmpeg|FFmpeg/);
});

test('downloadFfmpeg is a documented not_supported stub', async () => {
  const result = await downloadFfmpeg();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_supported');
});

test('filter and version parsers read ffmpeg output', () => {
  const filters = parseFilterNames(
    [
      'Filters:',
      '  T.. = Timeline support',
      ' .. ass               V->V       Render ASS subtitles onto input video using the libass library.',
      ' T. loudnorm          A->A       EBU R128 loudness normalization',
      ' .. whisper           A->A       Transcribe audio using whisper.cpp.',
    ].join('\n'),
  );
  assert.ok(filters.has('ass'));
  assert.ok(filters.has('loudnorm'));
  assert.ok(filters.has('whisper'));
  assert.ok(!filters.has('subtitles'));
  assert.equal(
    parseVersion('ffmpeg version 8.1.1-full_build-www.gyan.dev Copyright (c)'),
    '8.1.1-full_build-www.gyan.dev',
  );
  assert.equal(parseVersion('nothing here'), undefined);
});

test('ffmpeg is found, with the features the kit needs', async () => {
  const status = await detectFfmpeg({ refresh: true });
  assert.equal(status.found, true, status.problem ?? '');
  assert.ok(status.version);
  assert.equal(status.has_ass, true, 'this ffmpeg has no ass filter (libass)');
  assert.equal(status.has_loudnorm, true);
  assert.equal(typeof status.has_whisper, 'boolean');
});

test('FFMPEG_PATH wins over PATH, and a bad FFMPEG_PATH falls back', async () => {
  const good = await detectFfmpeg({ refresh: true });
  const previous = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = dirname(/** @type {string} */ (good.path));
    const fromDir = await detectFfmpeg({ refresh: true });
    assert.equal(fromDir.source, 'env');
    process.env.FFMPEG_PATH = join(temp, 'does-not-exist');
    const fallback = await detectFfmpeg({ refresh: true });
    assert.equal(fallback.found, true);
    assert.notEqual(fallback.source, 'env');
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
    await detectFfmpeg({ refresh: true });
  }
});

test('a missing ffmpeg gives a plain message with the install command', async () => {
  const savedPath = process.env.PATH;
  const savedKey = process.env.Path;
  const savedFfmpeg = process.env.FFMPEG_PATH;
  const savedHome = process.env.DANDELION_KIT_HOME;
  try {
    process.env.PATH = temp;
    if (savedKey !== undefined) process.env.Path = temp;
    delete process.env.FFMPEG_PATH;
    process.env.DANDELION_KIT_HOME = join(temp, 'empty-home');
    const status = await detectFfmpeg({ refresh: true });
    assert.equal(status.found, false);
    assert.equal(status.install_hint, installHint());
    await assert.rejects(() => requireFfmpeg(), /Install it with: /);
  } finally {
    process.env.PATH = savedPath;
    if (savedKey !== undefined) process.env.Path = savedKey;
    if (savedFfmpeg !== undefined) process.env.FFMPEG_PATH = savedFfmpeg;
    if (savedHome === undefined) delete process.env.DANDELION_KIT_HOME;
    else process.env.DANDELION_KIT_HOME = savedHome;
    await detectFfmpeg({ refresh: true });
  }
});

test('parseRate reads fractions', () => {
  assert.equal(parseRate('30/1'), 30);
  assert.ok(Math.abs(parseRate('30000/1001') - 29.97) < 0.01);
  assert.equal(parseRate('0/0'), 0);
  assert.equal(parseRate(undefined), 0);
});

test('mediaInfoFromProbe swaps width and height for rotated video', () => {
  const info = mediaInfoFromProbe({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30/1',
        side_data_list: [{ rotation: -90 }],
      },
      { codec_type: 'audio', sample_rate: '44100' },
    ],
    format: { duration: '2.5' },
  });
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.equal(info.duration_ms, 2500);
  assert.equal(info.has_audio, true);
  assert.equal(info.audio_rate, 44100);
  assert.throws(() => mediaInfoFromProbe({ streams: [{ codec_type: 'audio' }], format: {} }), /no video/);
});

test('probe reads the 6 second fixture', async () => {
  const info = await probeMedia(FIXTURE);
  assert.equal(info.width, 540);
  assert.equal(info.height, 960);
  assert.equal(Math.round(info.fps), 30);
  assert.equal(info.has_audio, true);
  assert.equal(info.audio_rate, 48000);
  assert.equal(info.video_codec, 'h264');
  assert.ok(Math.abs(info.duration_ms - 6000) < 150, `duration ${info.duration_ms}`);
});

test('probe says so when the file is not media', async () => {
  const bad = join(temp, 'not-a-video.mp4');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(bad, 'this is not a video');
  await assert.rejects(() => probeMedia(bad), /ffprobe could not read/);
});

test('work filter covers crop and pad', () => {
  assert.match(workVideoFilter('crop'), /increase.*crop=1080:1920.*fps=30/);
  assert.match(workVideoFilter('pad'), /decrease.*pad=1080:1920.*fps=30/);
});

test('ingest makes the work copy, proxy and wav, then reuses them', async () => {
  const out = join(temp, 'ingest-fixture');
  const stages = [];
  const first = await ingestVideo(FIXTURE, out, { onProgress: (stage) => stages.push(stage) });
  assert.equal(first.reused, false);
  assert.match(first.source_hash, /^[0-9a-f]{64}$/);
  for (const stage of ['probe', 'hash', 'work', 'proxy', 'audio', 'done'])
    assert.ok(stages.includes(stage), `no ${stage} stage`);

  const work = await probeMedia(first.files.work);
  assert.equal(work.width, 1080);
  assert.equal(work.height, 1920);
  assert.equal(work.fps, 30);
  assert.equal(work.has_audio, true);
  assert.ok(Math.abs(work.duration_ms - 6000) < 150, `work duration ${work.duration_ms}`);
  assert.deepEqual(first.work_media.width, 1080);

  const proxy = await probeMedia(first.files.proxy);
  assert.equal(proxy.width, 540);
  assert.equal(proxy.height, 960);
  assert.equal(proxy.fps, 15);
  const minutes = proxy.duration_ms / 60000;
  assert.ok(
    statSync(first.files.proxy).size <= PROXY_MAX_BYTES_PER_MINUTE * Math.max(minutes, 0.2),
    'proxy is over the size target',
  );

  const audioPath = /** @type {string} */ (first.files.audio);
  const wav = await probeAudio(audioPath);
  assert.equal(wav.audio_rate, 48000);
  assert.equal(wav.channels, 1);
  assert.ok(Math.abs(wav.duration_ms - 6000) < 150, `wav duration ${wav.duration_ms}`);
  const header = readFileSync(audioPath).subarray(0, 4).toString('latin1');
  assert.equal(header, 'RIFF');

  // Second run: same source, same options, nothing is encoded again.
  const mtimes = ['work', 'proxy', 'audio'].map((k) => statSync(/** @type {any} */ (first.files)[k]).mtimeMs);
  const second = await ingestVideo(FIXTURE, out);
  assert.equal(second.reused, true);
  assert.deepEqual(
    ['work', 'proxy', 'audio'].map((k) => statSync(/** @type {any} */ (second.files)[k]).mtimeMs),
    mtimes,
  );

  // Different fit means new work.
  const third = await ingestVideo(FIXTURE, out, { fit: 'pad' });
  assert.equal(third.reused, false);
  assert.equal(third.fit, 'pad');
  assert.deepEqual(
    readdirSync(out).filter((n) => n.includes('partial')),
    [],
    'partial files were left behind',
  );
});

test('ingest turns a wide, silent video into a 1080x1920 work copy with no wav', async () => {
  const wide = join(temp, 'wide-silent.mp4');
  const made = spawnSync(
    await bin('ffmpeg'),
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=24:duration=2',
      '-pix_fmt',
      'yuv420p',
      wide,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
  const out = join(temp, 'ingest-wide');
  const result = await ingestVideo(wide, out);
  assert.equal(result.files.audio, null);
  assert.equal(result.source_media.has_audio, false);
  const work = await probeMedia(result.files.work);
  assert.equal(work.width, 1080);
  assert.equal(work.height, 1920);
  assert.equal(work.fps, 30);
  assert.equal(work.has_audio, false);
  assert.ok(!readdirSync(out).includes('audio.wav'));
});

test('ingest says so when the video is missing', async () => {
  await assert.rejects(() => ingestVideo(join(temp, 'nope.mp4'), join(temp, 'x')), /could not find a video/);
});

test('sampleFrames writes JPEGs at the asked times', async () => {
  const dir = join(temp, 'frames');
  const frames = await sampleFrames(FIXTURE, [500, 3000, 5500], dir, { width: 270 });
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((f) => f.t_ms),
    [500, 3000, 5500],
  );
  for (const frame of frames) assert.ok(jpegInfo(frame.path) > 500);
});

test('sampleFramesEvery writes one JPEG per interval', async () => {
  const dir = join(temp, 'ticks');
  const frames = await sampleFramesEvery(SPEECH, 500, dir, { width: 160 });
  // 11.1 seconds at 2 frames per second.
  assert.ok(frames.length >= 21 && frames.length <= 24, `got ${frames.length} frames`);
  assert.equal(frames[1].t_ms, 500);
  jpegInfo(frames[0].path);
});
