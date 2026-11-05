import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setupPlan, installClient, setupCommand, SETUP_CLIENTS } from '../bin/setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMMY_VALUE = 'unit-test-value-that-must-not-be-shown';
let home;
let previousHome;
let previousModels;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'kit-setup-test-'));
  previousHome = process.env.DANDELION_KIT_HOME;
  previousModels = process.env.DANDELION_KIT_MODELS;
  process.env.DANDELION_KIT_HOME = join(home, 'isolated-kit');
  process.env.DANDELION_KIT_MODELS = join(home, 'isolated-models');
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previousHome;
  if (previousModels === undefined) delete process.env.DANDELION_KIT_MODELS; else process.env.DANDELION_KIT_MODELS = previousModels;
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const actualOptions = () => ({ home, root: ROOT, node: process.execPath, platform: process.platform, env: { APPDATA: join(home, 'roaming') } });
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
async function seed(file, value) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); }


test('setup plans use full native paths for Windows Mac and Linux clients', () => {
  const fixtures = [
    { platform: 'win32', home: 'C:\\People\\Mia', root: 'C:\\Kit Folder', node: 'C:\\Program Files\\nodejs\\node.exe', env: { APPDATA: 'C:\\People\\Mia\\AppData\\Roaming' }, desktop: 'C:\\People\\Mia\\AppData\\Roaming\\Claude\\claude_desktop_config.json', cursor: 'C:\\People\\Mia\\.cursor\\mcp.json', path: win32 },
    { platform: 'darwin', home: '/Users/mia', root: '/Users/mia/Kit Folder', node: '/opt/homebrew/bin/node', env: {}, desktop: '/Users/mia/Library/Application Support/Claude/claude_desktop_config.json', cursor: '/Users/mia/.cursor/mcp.json', path: posix },
    { platform: 'linux', home: '/home/mia', root: '/home/mia/Kit Folder', node: '/usr/bin/node', env: {}, desktop: '/home/mia/.config/Claude/claude_desktop_config.json', cursor: '/home/mia/.cursor/mcp.json', path: posix },
  ];
  assert.deepEqual(SETUP_CLIENTS, ['claude-desktop', 'claude-code', 'codex', 'cursor', 'vscode', 'generic']);
  for (const fixture of fixtures) {
    const desktop = setupPlan('claude-desktop', fixture);
    const cursor = setupPlan('cursor', fixture);
    assert.equal(desktop.file, fixture.desktop);
    assert.equal(cursor.file, fixture.cursor);
    for (const plan of [desktop, cursor]) {
      assert.equal(plan.mode, 'file');
      assert.equal(plan.entry.type, 'stdio');
      assert.equal(plan.entry.command, fixture.node);
      assert.deepEqual(plan.entry.args, [fixture.path.join(fixture.root, 'bin', 'kit.mjs'), 'serve']);
      assert.ok(fixture.path.isAbsolute(plan.entry.command));
      assert.ok(fixture.path.isAbsolute(plan.entry.args[0]));
    }
    const custom = setupPlan('vscode', { ...fixture, config: 'work/mcp.json', cwd: fixture.home });
    assert.equal(custom.file, fixture.path.resolve(fixture.home, 'work/mcp.json'));
    assert.equal(custom.key, 'servers');
  }
  assert.throws(() => setupPlan('generic', { platform: 'linux', root: 'relative', node: '/usr/bin/node' }), /full paths/);
  assert.throws(() => setupPlan('generic', { platform: 'linux', root: '/kit', node: 'node' }), /full paths/);
  assert.throws(() => setupPlan('claude-desktop', { platform: 'win32', root: 'C:\\Kit', node: 'C:\\node.exe', env: {} }), /APPDATA.*--config/);
});

test('Desktop and Cursor merges keep other settings and do not return their values', async () => {
  for (const client of ['claude-desktop', 'cursor']) {
    const plan = setupPlan(client, actualOptions());
    assert.ok(plan.file);
    const original = { theme: 'dark', privateSetting: DUMMY_VALUE, mcpServers: { other: { command: 'other-command', args: ['serve'], env: { VALUE: DUMMY_VALUE } } } };
    await seed(plan.file, original);
    const result = await installClient(plan);
    assert.equal(result.written, true);
    assert.equal(result.unchanged, false);
    const stored = await readJson(plan.file);
    assert.equal(stored.theme, original.theme);
    assert.equal(stored.privateSetting, DUMMY_VALUE);
    assert.deepEqual(stored.mcpServers.other, original.mcpServers.other);
    assert.deepEqual(stored.mcpServers['dandelion-kit'], plan.entry);
    const written = await readFile(plan.file, 'utf8');
    assert.deepEqual(await installClient(plan), { written: false, unchanged: true });
    assert.equal(await readFile(plan.file, 'utf8'), written);
    const output = await setupCommand([client], actualOptions());
    assert.match(output.text, /already set up/);
    assert.ok(!output.text.includes(DUMMY_VALUE));
    assert.ok(!JSON.stringify(result).includes(DUMMY_VALUE));
  }
});

test('a different Kit entry needs replace and replacement keeps local options but drops old HTTP settings', async () => {
  const plan = setupPlan('cursor', actualOptions());
  assert.ok(plan.file);
  const original = { mcpServers: { other: { command: 'kept' }, 'dandelion-kit': { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: DUMMY_VALUE }, http_headers: { key: DUMMY_VALUE }, bearer_token_env_var: 'TEST_ONLY_NAME', env: { KEEP: DUMMY_VALUE }, timeout: 120000, requestTimeout: 90000 } }, keep: true };
  await seed(plan.file, original);
  const before = await readFile(plan.file, 'utf8');
  await assert.rejects(installClient(plan), /--replace/);
  assert.equal(await readFile(plan.file, 'utf8'), before);
  const result = await setupCommand(['cursor', '--replace'], actualOptions());
  assert.equal(result.code, 0);
  assert.ok(!result.text.includes(DUMMY_VALUE));
  const config = await readJson(plan.file);
  const entry = config.mcpServers['dandelion-kit'];
  assert.equal(entry.command, plan.entry.command);
  assert.deepEqual(entry.args, plan.entry.args);
  assert.equal(entry.type, 'stdio');
  assert.deepEqual(entry.env, original.mcpServers['dandelion-kit'].env);
  assert.equal(entry.timeout, 120000);
  assert.equal(entry.requestTimeout, 90000);
  for (const field of ['url', 'headers', 'http_headers', 'bearer_token_env_var']) assert.equal(entry[field], undefined, field);
  assert.deepEqual(config.mcpServers.other, original.mcpServers.other);
  assert.equal(config.keep, true);
  assert.deepEqual(await installClient(plan), { written: false, unchanged: true });
});

test('invalid JSON roots and server maps are refused without rewriting files', async () => {
  const file = join(home, 'config.json');
  const plan = setupPlan('cursor', { ...actualOptions(), config: file });
  for (const source of ['{', 'null', '[]', '42', '{"mcpServers":null}', '{"mcpServers":[]}', '{"mcpServers":"wrong"}']) {
    await seed(file, source);
    await assert.rejects(installClient(plan), /plain JSON|object of servers/);
    assert.equal(await readFile(file, 'utf8'), source);
  }
  await seed(file, { mcpServers: { 'dandelion-kit': 'wrong' } });
  const badEntry = await readFile(file, 'utf8');
  await assert.rejects(installClient(plan, { replace: true }), /must be an object/);
  assert.equal(await readFile(file, 'utf8'), badEntry);
  const folder = join(home, 'folder');
  await mkdir(folder);
  await assert.rejects(installClient(setupPlan('cursor', { ...actualOptions(), config: folder })), /plain config file/);
});

test('auth file names are refused before their contents are read', async () => {
  const file = join(home, 'AuTh.JsOn');
  await seed(file, 'not JSON '+DUMMY_VALUE);
  assert.throws(() => setupPlan('cursor', { ...actualOptions(), config: file }), /will not read or change auth.json/);
  await assert.rejects(setupCommand(['claude-desktop', '--config', file], actualOptions()), /will not read or change auth.json/);
  assert.equal(await readFile(file, 'utf8'), 'not JSON '+DUMMY_VALUE);
});

test('a linked config file is refused without changing its target', { skip: process.platform === 'win32' ? 'Windows link rights vary by install' : false }, async () => {
  const target = join(home, 'target.json');
  const link = join(home, 'link.json');
  await seed(target, { keep: true });
  await symlink(target, link);
  const plan = setupPlan('cursor', { ...actualOptions(), config: link });
  await assert.rejects(installClient(plan), /plain config file/);
  assert.deepEqual(await readJson(target), { keep: true });
});

test('dry run creates no config file or parent folders', async () => {
  const file = join(home, 'not-created', 'deep', 'mcp.json');
  const plan = setupPlan('cursor', { ...actualOptions(), config: file });
  assert.deepEqual(await installClient(plan, { dryRun: true }), { written: false, unchanged: false });
  assert.equal(existsSync(dirname(file)), false);
  const result = await setupCommand(['cursor', '--config', file, '--dry-run'], actualOptions());
  assert.equal(result.code, 0);
  assert.match(result.text, /Preview only/);
  assert.equal(existsSync(dirname(file)), false);
  assert.deepEqual(await readdir(home), []);
});

test('CLI and generic routes print complete registration instructions without executing a command', async () => {
  const options = { platform: 'linux', home: '/home/test-person', root: '/tmp/Kit folder', node: '/does-not-exist/node', env: {} };
  const claude = setupPlan('claude-code', options);
  assert.deepEqual(claude.command, { file: 'claude', args: ['mcp', 'add', '--transport', 'stdio', '--scope', 'user', 'dandelion-kit', '--', options.node, '/tmp/Kit folder/bin/kit.mjs', 'serve'] });
  const codex = setupPlan('codex', options);
  assert.deepEqual(codex.command, { file: 'codex', args: ['mcp', 'add', 'dandelion-kit', '--', options.node, '/tmp/Kit folder/bin/kit.mjs', 'serve'] });
  const vscode = setupPlan('vscode', options);
  assert.equal(vscode.command?.file, 'code');
  assert.equal(vscode.command?.args[0], '--add-mcp');
  assert.deepEqual(JSON.parse(vscode.command?.args[1] ?? ''), { name: 'dandelion-kit', ...vscode.entry });
  for (const client of ['claude-code', 'codex', 'vscode']) {
    const plan = setupPlan(client, options);
    assert.deepEqual(await installClient(plan), { written: false, unchanged: false });
    const result = await setupCommand([client], options);
    assert.equal(result.code, 0);
    assert.match(result.text, /Registration was not run/);
    assert.ok(result.text.includes("/does-not-exist/node"));
    assert.ok(result.text.includes("'/tmp/Kit folder/bin/kit.mjs'") || client === 'vscode');
  }
  const generic = await setupCommand(['generic'], options);
  assert.match(generic.text, /Nothing was changed/);
  const config = JSON.parse(generic.text.slice(generic.text.indexOf('{'), generic.text.lastIndexOf('}')+1));
  assert.deepEqual(config, { mcpServers: { 'dandelion-kit': setupPlan('generic', options).entry } });
  const windows = await setupCommand(['codex'], { platform: 'win32', home: 'C:\\test', root: 'C:\\Kit Folder', node: 'C:\\node.exe', env: {} });
  assert.ok(windows.text.includes("& 'codex' 'mcp' 'add'"));
  assert.deepEqual(await readdir(home), []);
});

test('a chosen VS Code file uses servers and keeps other JSON settings', async () => {
  const file = join(home, 'vscode.json');
  await seed(file, { inputs: [{ id: 'kept' }], servers: { other: { type: 'stdio', command: 'other' } } });
  const result = await setupCommand(['vscode', '--config', file], actualOptions());
  assert.equal(result.code, 0);
  const stored = await readJson(file);
  assert.deepEqual(stored.inputs, [{ id: 'kept' }]);
  assert.equal(stored.servers.other.command, 'other');
  assert.equal(stored.servers['dandelion-kit'].command, process.execPath);
  assert.equal(stored.mcpServers, undefined);
});

test('unknown clients flags and missing config values fail in plain words', async () => {
  for (const args of [['wrong'], ['cursor','--wrong'], ['cursor','--config'], ['cursor','--config','--dry-run'], ['codex','--config','file.json'], ['generic','--replace']]) {
    await assert.rejects(setupCommand(args, actualOptions()), error => error instanceof Error && error.message.length < 300 && !/\n\s+at /.test(error.message));
  }
  assert.match((await setupCommand([], actualOptions())).text, /Usage: kit setup/);
  assert.equal((await setupCommand(['--help'], actualOptions())).code, 0);
  assert.deepEqual(await readdir(home), []);
});

test('a copied bootstrap can print setup with no packages npm or server files', { timeout: 30000 }, async () => {
  const copy = join(home, 'Kit copy');
  await mkdir(join(copy, 'bin'), { recursive: true });
  await mkdir(join(copy, 'core', 'util'), { recursive: true });
  for (const name of (await readdir(join(ROOT, 'bin'))).filter(name => name.endsWith('.mjs'))) await copyFile(join(ROOT, 'bin', name), join(copy, 'bin', name));
  await copyFile(join(ROOT, 'core', 'util', 'fs.mjs'), join(copy, 'core', 'util', 'fs.mjs'));
  await writeFile(join(copy, 'package.json'), JSON.stringify({ name: 'setup-fixture', version: '1.0.0', type: 'module', dependencies: {} }));
  const isolatedHome = join(home, 'subprocess-home');
  const models = join(home, 'subprocess-models');
  const env = { ...process.env, PATH: '', HOME: home, USERPROFILE: home, APPDATA: join(home, 'subprocess-roaming'), DANDELION_KIT_HOME: isolatedHome, DANDELION_KIT_MODELS: models, npm_config_cache: join(home, 'npm-cache') };
  const result = spawnSync(process.execPath, [join(copy, 'bin', 'kit.mjs'), 'setup', 'generic'], { cwd: copy, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Nothing was changed/);
  const config = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}')+1));
  assert.equal(config.mcpServers['dandelion-kit'].command, process.execPath);
  assert.deepEqual(config.mcpServers['dandelion-kit'].args, [await realpath(join(copy, 'bin', 'kit.mjs')), 'serve']);
  for (const file of [isolatedHome, models, join(copy, 'node_modules'), join(copy, 'server'), join(home, 'npm-cache')]) assert.equal(existsSync(file), false, file);
  const failed = spawnSync(process.execPath, [join(copy, 'bin', 'kit.mjs'), 'setup', 'generic', '--wrong'], { cwd: copy, env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Unknown or missing setup option/);
  assert.doesNotMatch(failed.stderr, /\n\s+at /);
});

test('Windows commands name PowerShell and shell marks use fixed plugin steps', async () => {
  const plain = { platform: 'win32', home: 'C:\\test', root: 'C:\\Kit Folder', node: 'C:\\Program Files\\nodejs\\node.exe', env: {} };
  for (const client of ['claude-code', 'codex']) {
    const output = await setupCommand([client], plain);
    assert.match(output.text, /Run this command in PowerShell:/);
    assert.match(output.text, /mcp' 'add/);
    for (const mark of ['&', '|', '<', '>', '^', '%', '!', '"']) {
      const root = `C:\\Kit${mark}Folder`;
      const fallback = await setupCommand([client], { ...plain, root });
      assert.match(fallback.text, /shell marks.*plugin route.*PowerShell/s);
      assert.ok(!fallback.text.includes(root));
      assert.ok(!fallback.text.includes("'mcp' 'add'"));
      assert.ok(fallback.text.includes(`${client === 'codex' ? 'codex' : 'claude'} plugin marketplace add lizonthewebauto/dandelion-kit`));
      assert.ok(fallback.text.includes(`${client === 'codex' ? 'codex plugin add' : 'claude plugin install'} dandelion-kit@dandelion-kit`));
    }
    const unsafeNode = await setupCommand([client], { ...plain, node: 'C:\\Node&Tools\\node.exe' });
    assert.match(unsafeNode.text, /plugin route/);
    assert.ok(!unsafeNode.text.includes('Node&Tools'));
  }
});

test('Windows VS Code prints servers JSON and config steps without a JSON shim command', async () => {
  const options = { platform: 'win32', home: 'C:\\test', root: 'C:\\Kit&Folder', node: 'C:\\node.exe', env: {} };
  const output = await setupCommand(['vscode'], options);
  assert.match(output.text, /Registration was not run/);
  assert.match(output.text, /setup vscode with --config/);
  assert.ok(!output.text.includes('--add-mcp'));
  const config = JSON.parse(output.text.slice(output.text.indexOf('{'), output.text.lastIndexOf('}')+1));
  assert.deepEqual(config, { servers: { 'dandelion-kit': setupPlan('vscode', options).entry } });
});

test('POSIX commands quote apostrophes in local paths', async () => {
  const options = { platform: 'linux', home: '/home/test', root: "/tmp/Kit's folder", node: "/tmp/Node's tools/node", env: {} };
  for (const client of ['claude-code', 'codex', 'vscode']) {
    const output = await setupCommand([client], options);
    assert.match(output.text, /Run this command in your terminal:/);
    assert.ok(output.text.includes("Kit'\"'\"'s folder/bin/kit.mjs"));
    assert.ok(output.text.includes("Node'\"'\"'s tools/node"));
    assert.ok(!output.text.includes('plugin route'));
    if (client === 'vscode') assert.ok(output.text.includes('--add-mcp'));
  }
});
