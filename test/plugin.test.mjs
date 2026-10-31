import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL_IDS, TOOL_NAMES } from '../core/types.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string} rel */
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** @param {string} rel */
const readJson = (rel) => JSON.parse(readText(rel));
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const SKILLS = ['reels-editor', 'carousel-maker', 'post-anything'];
const PKG = readJson('package.json');

test('the plugin files are valid JSON and agree on name and version', () => {
  const claude = readJson('.claude-plugin/plugin.json');
  const codex = readJson('.codex-plugin/plugin.json');
  const mcpb = readJson('mcpb/manifest.json');
  for (const m of [claude, codex, mcpb]) {
    assert.equal(m.name, 'dandelion-kit');
    assert.equal(m.version, PKG.version);
  }
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, 'dandelion-kit');
  assert.deepEqual(
    marketplace.plugins.map((p) => p.name),
    ['dandelion-kit'],
  );
  assert.equal(marketplace.plugins[0].source, './');
  const codexMarket = readJson('.agents/plugins/marketplace.json');
  assert.equal(codexMarket.name, 'dandelion-kit');
  assert.equal(codexMarket.plugins[0].name, 'dandelion-kit');
  assert.equal(codexMarket.plugins[0].source.path, './');
});

test('the MCP server entry starts bin/kit.mjs serve', () => {
  const mcp = readJson('.mcp.json');
  const server = mcp.mcpServers['dandelion-kit'];
  assert.equal(server.command, 'node');
  assert.match(server.args[0], /bin\/kit\.mjs$/);
  assert.equal(server.args[1], 'serve');
  assert.ok(existsSync(join(ROOT, 'bin', 'kit.mjs')));
  const mcpb = readJson('mcpb/manifest.json');
  assert.equal(mcpb.server.entry_point, 'bin/kit.mjs');
  assert.deepEqual(mcpb.server.mcp_config.args.slice(1), ['serve']);
});

test('the Codex plugin starts the kit without a plugin root variable', () => {
  const codex = readJson('.codex-plugin/plugin.json');
  assert.equal(codex.mcpServers, './mcp.json');
  const server = readJson('mcp.json').mcpServers['dandelion-kit'];
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'github:lizonthewebauto/dandelion-kit', 'serve']);
  assert.ok(!JSON.stringify(server).includes('PLUGIN_ROOT'));
});

test('each skill has front matter that matches its folder', () => {
  for (const name of SKILLS) {
    const text = readText(`skills/${name}/SKILL.md`);
    const m = /^---\r?\nname: ([^\r\n]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(text);
    assert.ok(m, `${name} needs name and description front matter`);
    assert.equal(m[1], name);
    assert.ok(m[2].length > 60, `${name} needs a description that says when to use it`);
  }
  assert.match(readText('skills/post-anything/SKILL.md'), /ANY social media content/);
});

test('every tool a skill, the hook or AGENTS.md names is a real tool', () => {
  const known = new Set(TOOL_NAMES);
  const files = [...SKILLS.map((n) => `skills/${n}/SKILL.md`), 'AGENTS.md', 'hooks/session-start.mjs'];
  for (const rel of files) {
    const text = readText(rel);
    const names = new Set([...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]));
    for (const name of names) {
      const looksLikeTool = /^(open|rough|pick|plan|render|check|make|update|offer|set|connect|send|approve|skip|read|get|list|dandelion|export)_/.test(name) || name === 'open_path';
      if (looksLikeTool) assert.ok(known.has(name), `${rel} names "${name}", which is not a kit tool`);
    }
  }
  // The reel skill walks the whole editing order.
  const reels = readText('skills/reels-editor/SKILL.md');
  for (const t of ['doctor', 'open_video', 'rough_cut', 'pick_look', 'plan_shots', 'render_reel', 'make_variants', 'export', 'offer_post']) {
    assert.ok(reels.includes(`\`${t}\``), `reels-editor should mention ${t}`);
  }
});

test('the post-anything rule names every app and says never post without a yes', () => {
  const text = readText('skills/post-anything/SKILL.md');
  for (const id of CHANNEL_IDS) assert.ok(text.includes(`\`${id}\``), `post-anything should list ${id}`);
  assert.match(text, /Never post without an explicit yes/);
  assert.match(text, /before they have a Dandelion account|works before sign-up/i);
});

test('the session start hook prints one JSON object with the rule as added context', () => {
  const hooks = readJson('hooks/hooks.json');
  const entry = hooks.hooks.SessionStart[0].hooks[0];
  assert.equal(entry.type, 'command');
  assert.match(entry.args[0], /hooks\/session-start\.mjs$/);
  const run = spawnSync(process.execPath, [join(ROOT, 'hooks', 'session-start.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const out = JSON.parse(run.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const context = out.hookSpecificOutput.additionalContext;
  assert.match(context, /offer_post/);
  assert.match(context, /explicit yes/);
  assert.ok(context.length < 2000);
});

test('plugin text has no em or en dashes', () => {
  const files = [
    'README.md',
    'AGENTS.md',
    'INSTALL.md',
    ...SKILLS.map((n) => `skills/${n}/SKILL.md`),
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.codex-plugin/plugin.json',
    'mcpb/manifest.json',
    'hooks/session-start.mjs',
  ];
  for (const rel of files) {
    const text = readText(rel);
    assert.ok(!text.includes(EM) && !text.includes(EN), `${rel} has a dash to replace`);
  }
});
