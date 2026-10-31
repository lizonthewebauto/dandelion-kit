// The real thing: bin/kit.mjs serve over stdio (stdout must be MCP frames only), and --demo mode answering every tool.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_NAMES } from '../core/types.mjs';
import { makeTempDir } from '../core/util/fs.mjs';
import { INSTRUCTIONS } from '../server/index.mjs';
import { connectKit, textOf, DASH_RE } from './server-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'kit.mjs');

let home;
before(() => {
  home = makeTempDir('kit-stdio-test-');
});
after(() => rmSync(home, { recursive: true, force: true }));

/** @param {string[]} args */
async function stdioClient(args) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, 'serve', ...args],
    env: { ...process.env, DANDELION_KIT_HOME: home },
    stderr: 'pipe',
  });
  const errors = /** @type {Error[]} */ ([]);
  const client = new Client({ name: 'kit-stdio-test', version: '1.0.0' });
  client.onerror = (e) => errors.push(e);
  await client.connect(transport);
  return { client, errors, transport };
}

test('serve over stdio: stdout is MCP frames only, tools and cards are listed, doctor answers', async () => {
  const { client, errors } = await stdioClient([]);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), [...TOOL_NAMES]);
    assert.equal((await client.listResources()).resources.length, 8);
    const info = client.getServerVersion();
    assert.equal(info?.name, 'dandelion-kit');
    assert.equal(client.getInstructions(), INSTRUCTIONS);
    const doc = /** @type {any} */ (await client.callTool({ name: 'doctor', arguments: {} }));
    assert.equal(doc.structuredContent.mode, 'status');
    assert.equal(doc.structuredContent.doctor.home, home);
    assert.equal(errors.length, 0, errors.map((e) => e.message).join('; '));
  } finally {
    await client.close();
  }
});

test('the server instructions cover the phases, the post offer and the brand rules', () => {
  assert.match(INSTRUCTIONS, /doctor.*open_video.*rough_cut.*pick_look.*plan_shots.*render_reel/s);
  assert.match(INSTRUCTIONS, /Plan, then build once/);
  assert.match(INSTRUCTIONS, /call offer_post/);
  assert.match(INSTRUCTIONS, /Never post without their clear yes/);
  assert.match(INSTRUCTIONS, /female voice/);
  assert.match(INSTRUCTIONS, /JPEG/);
  assert.ok(!DASH_RE.test(INSTRUCTIONS));
});

test('serve --demo answers with sample data, including pictures through read_asset', async () => {
  const { client, errors } = await stdioClient(['--demo']);
  try {
    const cut = /** @type {any} */ (await client.callTool({ name: 'rough_cut', arguments: { project_id: 'p_demo' } }));
    assert.equal(cut.structuredContent.removed.length, 12);
    assert.match(textOf(cut), /Rough cut \(standard\)/);
    const poster = /** @type {any} */ (await client.callTool({ name: 'read_asset', arguments: { asset_id: 'a_poster', offset: 0 } }));
    assert.equal(poster.structuredContent.mime, 'image/jpeg');
    assert.match(poster.structuredContent.data, /^\/9j\//);
    const slide = /** @type {any} */ (await client.callTool({ name: 'read_asset', arguments: { asset_id: 'a_slide_1', offset: 0, bytes: 100 } }));
    assert.equal(slide.structuredContent.has_more, true);
    assert.equal(errors.length, 0);
  } finally {
    await client.close();
  }
});

test('demo mode answers all 25 tools with text and, for tools with a card, the sample data', async () => {
  const kit = await connectKit({ demo: true });
  try {
    /** @type {Record<string, Record<string, any>>} */
    const args = {
      open_video: { path: 'x.mp4' },
      get_project: { project_id: 'p_demo' },
      rough_cut: { project_id: 'p_demo' },
      update_cut: { project_id: 'p_demo', keep_ids: ['r1'] },
      pick_look: { project_id: 'p_demo', look: 'bold-value' },
      plan_shots: { project_id: 'p_demo' },
      update_shot_plan: { project_id: 'p_demo', beats: [{ id: 'b2', text: 'New text' }] },
      render_reel: { project_id: 'p_demo', quality: 'final' },
      check_reel: { project_id: 'p_demo' },
      make_variants: { project_id: 'p_demo', count: 2 },
      make_carousel: { title: 'T', slides: [{ layout: 'cover', fields: { title: 'Hi' } }] },
      update_slides: { project_id: 'p_car', slides: [{ layout: 'cover', fields: { title: 'Hi' } }] },
      make_image: { layout: 'cover', fields: { title: 'Hi' } },
      export: { project_id: 'p_demo' },
      offer_post: { kind: 'video', text: 'Hello' },
      set_channel_copy: { bundle_id: 'bundle_demo', channel: 'instagram', copy: { caption: 'Hi' } },
      connect_dandelion: {},
      dandelion_status: {},
      send_to_dandelion: { bundle_id: 'bundle_demo', brand_id: 'b', mode: 'review', channels: ['instagram'] },
      approve_post: { job_id: 'j1', post_at: '2026-12-02T14:00:00.000Z' },
      skip_post: { job_id: 'j1' },
      read_asset: { asset_id: 'a_frame_1', offset: 0 },
      open_path: { path: 'C:\\x' },
    };
    for (const name of TOOL_NAMES) {
      const r = await kit.call(name, args[name] ?? {});
      assert.ok(!r.isError, `${name}: ${textOf(r)}`);
      assert.ok(textOf(r).length > 5, name);
      assert.ok(!DASH_RE.test(textOf(r)), `${name} text has a dash`);
    }
    assert.equal((await kit.call('doctor')).structuredContent.mode, 'status');
    // The demo keeps state like a real project: a kept piece is remembered.
    const cut = await kit.call('update_cut', { project_id: 'p_demo', keep_ids: ['r1', 'r2'] });
    assert.equal(cut.structuredContent.removed.filter((s) => s.keep).length, 2);
    const tooLong = await kit.call('set_channel_copy', { bundle_id: 'bundle_demo', channel: 'x', copy: { caption: 'y'.repeat(400) } });
    assert.equal(tooLong.isError, true);
  } finally {
    await kit.close();
  }
});

test('the command line: help, version and an unknown command', () => {
  const run = (/** @type {string[]} */ ...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', env: { ...process.env, DANDELION_KIT_HOME: home } });
  const help = run();
  assert.equal(help.status, 0);
  assert.match(help.stdout, /kit serve \[--demo\]/);
  assert.ok(!DASH_RE.test(help.stdout));
  const version = run('version');
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
  const unknown = run('frobnicate');
  assert.equal(unknown.status, 2);
  const doctor = run('doctor');
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /ffmpeg:/);
  // connect with nothing to talk to: a plain failure, no browser, no waiting.
  const connect = spawnSync(process.execPath, [BIN, 'connect'], {
    encoding: 'utf8',
    env: { ...process.env, DANDELION_KIT_HOME: home, DANDELION_URL: 'http://127.0.0.1:9', DANDELION_KIT_NO_BROWSER: '1' },
  });
  assert.equal(connect.status, 1);
  assert.match(connect.stdout, /could not reach Dandelion/);
});
