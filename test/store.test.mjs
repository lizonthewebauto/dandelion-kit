import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';

process.env.DANDELION_KIT_MODELS ??= join(homedir(), '.dandelion-kit', 'models');

const { makeTempDir, kitHome } = await import('../core/util/fs.mjs');
const store = await import('../server/store/project.mjs');
const { openVideo, transcribeProject, titleFromPath } = await import('../server/store/video.mjs');
const { hashFile } = await import('../core/util/hash.mjs');
const { ASSET_KINDS } = await import('../core/types.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'fixture-6s.mp4');
const SPEECH = join(ROOT, 'test', 'fixtures', 'speech-11s.mp4');

let home;
let previousHome;
before(() => {
  previousHome = process.env.DANDELION_KIT_HOME;
  home = makeTempDir('kit-store-test-');
  process.env.DANDELION_KIT_HOME = home;
});
after(() => {
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

test('the kit home follows DANDELION_KIT_HOME', () => {
  assert.equal(kitHome(), home);
  assert.equal(store.projectsDir(), join(home, 'projects'));
});

test('project ids that could leave the projects folder are refused', () => {
  for (const bad of ['../x', 'p_', 'p_../../etc', '', 'abc', 'p_UPPER', 'p_a/b']) {
    assert.throws(() => store.projectDir(bad), /not a project id/, bad);
  }
  assert.ok(store.projectDir('p_abcd1234').endsWith(join('projects', 'p_abcd1234')));
});

test('create, load, save, list', async () => {
  const a = await store.createProject({ type: 'carousel', title: 'First' });
  assert.match(a.id, /^p_[0-9a-f]{8}$/);
  assert.equal(a.type, 'carousel');
  assert.deepEqual(a.assets, {});
  assert.equal(a.transcript_ready, false);
  assert.equal(a.cut_applied, false);

  const loaded = await store.loadProject(a.id);
  assert.deepEqual(loaded, a);
  assert.equal(await store.loadProject('p_00000000'), null);
  await assert.rejects(() => store.requireProject('p_00000000'), /could not find project/);

  await new Promise((r) => setTimeout(r, 5));
  const b = await store.createProject({ type: 'video', title: 'Second' });
  a.title = 'First, renamed';
  await store.saveProject(a);
  const list = await store.listProjects();
  assert.deepEqual(
    list.map((p) => p.id),
    [a.id, b.id],
    'most recently changed first',
  );
  assert.equal(list[0].title, 'First, renamed');
  assert.ok(list[0].updated_at >= a.created_at);
});

test('updateProject runs changes one at a time, so none are lost', async () => {
  const p = await store.createProject({ type: 'video', title: 'Counter' });
  await store.updateProject(p.id, (project) => {
    project.look_id = 'karaoke-clean';
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.updateProject(p.id, async (project) => {
        await new Promise((r) => setTimeout(r, 2));
        project.accent = `#00${String(i).padStart(2, '0')}00`;
        const renders = (project.renders ??= {});
        renders[`r${i}`] = /** @type {any} */ ({ quality: 'draft' });
      }),
    ),
  );
  const after = await store.requireProject(p.id);
  assert.equal(Object.keys(after.renders ?? {}).length, 12, 'a change was lost');
  assert.equal(after.look_id, 'karaoke-clean');
  assert.equal(
    JSON.parse(readFileSync(join(store.projectDir(p.id), 'project.json'), 'utf8')).id,
    p.id,
    'file is valid json',
  );
});

test('assets: stable ids, kinds checked, only registered files are served', async () => {
  const p = await store.createProject({ type: 'video', title: 'Assets' });
  const file = join(store.projectDir(p.id), 'sample.txt');
  const content = Buffer.alloc(450000);
  for (let i = 0; i < content.length; i++) content[i] = (i * 31 + 7) % 251;
  writeFileSync(file, content);

  const asset = await store.registerAsset(p, { path: file, kind: 'sample', label: 'A sample' });
  assert.match(asset.id, /^a_[0-9a-f]{8}$/);
  assert.equal(asset.bytes, content.length);
  assert.equal(asset.mime, 'text/plain');
  assert.equal(asset.label, 'A sample');
  const again = await store.registerAsset(p, { path: file, kind: 'sample' });
  assert.equal(again.id, asset.id, 'same kind and path gives the same id');
  assert.equal(Object.keys(p.assets).length, 1);
  assert.ok(ASSET_KINDS.includes(asset.kind));
  await assert.rejects(
    () => store.registerAsset(p, { path: file, kind: /** @type {any} */ ('nonsense') }),
    /not a kind/,
  );
  await assert.rejects(
    () => store.registerAsset(p, { path: join(home, 'missing.jpg'), kind: 'frame' }),
    /could not find the file/,
  );
  assert.equal(store.mimeFor('x.JPG'), 'image/jpeg');
  assert.equal(store.mimeFor('x.mp4'), 'video/mp4');
  assert.equal(store.mimeFor('x.unknown'), 'application/octet-stream');

  // Reassemble the file from chunks.
  const parts = [];
  let offset = 0;
  let calls = 0;
  for (;;) {
    const chunk = await store.readAssetChunk(p, asset.id, offset, 999999);
    calls++;
    assert.equal(chunk.total, content.length);
    assert.equal(chunk.mime, 'text/plain');
    const bytes = Buffer.from(chunk.data, 'base64');
    assert.ok(bytes.length <= store.MAX_CHUNK_BYTES, 'chunk is over the limit');
    parts.push(bytes);
    offset += bytes.length;
    if (!chunk.has_more) break;
  }
  assert.equal(calls, 3, '450000 bytes in 200000 byte chunks');
  assert.ok(Buffer.concat(parts).equals(content));

  const small = await store.readAssetChunk(p, asset.id, 10, 5);
  assert.deepEqual(Buffer.from(small.data, 'base64'), content.subarray(10, 15));
  assert.equal(small.has_more, true);
  const tail = await store.readAssetChunk(p, asset.id, content.length - 3, 100);
  assert.equal(Buffer.from(tail.data, 'base64').length, 3);
  assert.equal(tail.has_more, false);
  const end = await store.readAssetChunk(p, asset.id, content.length, 100);
  assert.equal(end.data, '');
  assert.equal(end.has_more, false);

  await assert.rejects(() => store.readAssetChunk(p, asset.id, content.length + 1, 10), /past the end/);
  await assert.rejects(() => store.readAssetChunk(p, asset.id, -1, 10), /whole number/);
  await assert.rejects(() => store.readAssetChunk(p, asset.id, 1.5, 10), /whole number/);
  await assert.rejects(() => store.readAssetChunk(p, 'a_deadbeef', 0, 10), /no file with id/);
  // A path is never a valid asset id.
  await assert.rejects(() => store.readAssetChunk(p, file, 0, 10), /no file with id/);

  rmSync(file);
  await assert.rejects(() => store.readAssetChunk(p, asset.id, 0, 10), /gone from disk/);
});

test('titleFromPath makes a readable title', () => {
  assert.equal(titleFromPath('C:\\clips\\my-clip_v2.mp4'), 'my clip v2');
  assert.equal(titleFromPath('/a/b/.mp4'), '.mp4');
});

test('openVideo: project, ingest, registered assets, then the same file reuses everything', async () => {
  const stages = new Set();
  const first = await openVideo({ path: FIXTURE, title: 'Fixture clip', onProgress: (s) => stages.add(s) });
  assert.equal(first.reused, false);
  const project = first.project;
  assert.match(project.id, /^p_[0-9a-f]{10}$/);
  assert.equal(project.type, 'video');
  assert.equal(project.title, 'Fixture clip');
  assert.equal(project.source_hash, await hashFile(FIXTURE));
  assert.equal(project.media?.width, 1080);
  assert.equal(project.media?.height, 1920);
  assert.equal(project.media?.fps, 30);
  const kinds = Object.values(project.assets)
    .map((a) => a.kind)
    .sort();
  assert.deepEqual(kinds, ['audio', 'proxy', 'source', 'work']);
  for (const asset of Object.values(project.assets)) assert.ok(existsSync(asset.path), asset.path);

  // The proxy streams out through the chunk reader, in order, and is a real mp4.
  const proxy = /** @type {any} */ (Object.values(project.assets).find((a) => a.kind === 'proxy'));
  const head = await store.readAssetChunk(project, proxy.id, 0, 64);
  assert.equal(Buffer.from(head.data, 'base64').subarray(4, 8).toString('latin1'), 'ftyp');
  assert.equal(head.mime, 'video/mp4');

  const second = await openVideo({ path: FIXTURE });
  assert.equal(second.reused, true);
  assert.equal(second.project.id, project.id);
  assert.equal((await store.listProjects()).filter((p) => p.source_hash === project.source_hash).length, 1);
  assert.equal((await store.findBySourceHash(/** @type {string} */ (project.source_hash)))?.id, project.id);

  await assert.rejects(() => openVideo({ path: join(home, 'missing.mp4') }), /could not find a video/);
});

test('transcribeProject: saves the transcript on the project, and the second call reuses it', async (t) => {
  if (process.env.KIT_TEST_SKIP_ASR) return t.skip('KIT_TEST_SKIP_ASR is set');
  const { project } = await openVideo({ path: SPEECH });
  let result;
  try {
    result = await transcribeProject(project.id, { engine: 'transformers' });
  } catch (error) {
    if (/fetch|network|ENOTFOUND|EAI_AGAIN|ECONN|download/i.test(String(/** @type {any} */ (error)?.message)))
      return t.skip(`speech model unavailable: ${/** @type {any} */ (error).message}`);
    throw error;
  }
  assert.equal(result.reused, false);
  assert.ok(result.transcript.words.length >= 3);
  const saved = await store.requireProject(project.id);
  assert.equal(saved.transcript_ready, true);
  assert.deepEqual(saved.transcript, result.transcript);
  const again = await transcribeProject(project.id);
  assert.equal(again.reused, true);
  assert.equal(again.elapsed_ms, 0);
});

test('transcribeProject on a silent video says there is no sound', async () => {
  const { spawnSync } = await import('node:child_process');
  const { detectFfmpeg } = await import('../core/media/ffmpeg.mjs');
  const silent = join(home, 'silent.mp4');
  const made = spawnSync(
    /** @type {string} */ ((await detectFfmpeg()).path),
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=270x480:rate=15:duration=1',
      '-pix_fmt',
      'yuv420p',
      silent,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
  const { project } = await openVideo({ path: silent });
  await assert.rejects(() => transcribeProject(project.id), /no sound/);
});

test('deleteProject removes only that project', async () => {
  const keep = await store.createProject({ type: 'carousel', title: 'Keep' });
  const drop = await store.createProject({ type: 'carousel', title: 'Drop' });
  await store.deleteProject(drop.id);
  assert.equal(await store.loadProject(drop.id), null);
  assert.ok(await store.loadProject(keep.id));
});
