// Set up one local MCP client. This module needs only Node's built-in tools.
import { homedir } from 'node:os';
import { dirname, resolve, win32, posix } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../core/util/fs.mjs';

export const SETUP_CLIENTS = Object.freeze(['claude-desktop', 'claude-code', 'codex', 'cursor', 'vscode', 'generic']);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Build a plan without reading or changing client settings.
 * @param {string} client
 * @param {{platform?:string,home?:string,env?:NodeJS.ProcessEnv,node?:string,root?:string,config?:string,cwd?:string}} [options]
 */
export function setupPlan(client, options = {}) {
  if (!SETUP_CLIENTS.includes(client)) throw new Error(`Choose a client: ${SETUP_CLIENTS.join(', ')}.`);
  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const root = options.root ?? ROOT;
  const node = options.node ?? process.execPath;
  if (!path.isAbsolute(root) || !path.isAbsolute(node)) throw new Error('The Node and Kit paths must be full paths.');
  const entry = { type: 'stdio', command: node, args: [path.join(root, 'bin', 'kit.mjs'), 'serve'] };
  let file = options.config ? path.resolve(options.cwd ?? process.cwd(), options.config) : undefined;
  if (file && !['claude-desktop','cursor','vscode'].includes(client)) throw new Error('--config is for claude-desktop, cursor or vscode.');
  if (!file && client === 'claude-desktop') {
    if (platform === 'win32') {
      if (!env.APPDATA) throw new Error('APPDATA is not set. Use --config with the full client config path.');
      file = path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
    } else if (platform === 'darwin') file = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    else if (platform === 'linux') file = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    else throw new Error('Use --config with the full client config path on this system.');
  }
  if (!file && client === 'cursor') file = path.join(home, '.cursor', 'mcp.json');
  if (file && path.basename(file).toLowerCase() === 'auth.json') throw new Error('Setup will not read or change auth.json. Choose the client MCP config file.');
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  let command;
  if (client === 'claude-code') command = { file: 'claude', args: ['mcp','add','--transport','stdio','--scope','user','dandelion-kit','--',node,entry.args[0],'serve'] };
  if (client === 'codex') command = { file: 'codex', args: ['mcp','add','dandelion-kit','--',node,entry.args[0],'serve'] };
  if (client === 'vscode' && !file) command = { file: 'code', args: ['--add-mcp', JSON.stringify({ name: 'dandelion-kit', ...entry })] };
  return { client, platform, entry, file, key, command, mode: file ? 'file' : command ? 'command' : 'json' };
}

/** Merge only this server. No old settings, credentials or tokens are returned.
 * @param {ReturnType<typeof setupPlan>} plan
 * @param {{dryRun?:boolean,replace?:boolean}} [options]
 */
export async function installClient(plan, options = {}) {
  if (plan.mode !== 'file' || !plan.file) return { written: false, unchanged: false };
  const file = plan.file;
  let config = {};
  let existed = false;
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Use a plain config file, not a folder or link.');
    existed = true;
    try { config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
    catch { throw new Error('The client file is not plain JSON. It was left as it is. Use setup generic to get an entry to add in the app.'); }
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
  }
  if (!object(config) || (config[plan.key] !== undefined && !object(config[plan.key]))) throw new Error('The client config needs an object of servers. It was left as it is.');
  const servers = config[plan.key] ?? {};
  const old = servers['dandelion-kit'];
  const same = old && old.command === plan.entry.command && JSON.stringify(old.args) === JSON.stringify(plan.entry.args) && (old.type === undefined || old.type === 'stdio');
  if (same) return { written: false, unchanged: true };
  if (old !== undefined && !options.replace) throw new Error('This client already has a different dandelion-kit entry. Use --replace to change only that entry.');
  if (old !== undefined && !object(old)) throw new Error('The old Kit entry must be an object. Fix that entry in the app first.');
  if (options.dryRun) return { written: false, unchanged: false };
  const entry = { ...(old ?? {}), ...plan.entry };
  for (const field of ['url','headers','http_headers','bearer_token_env_var']) delete entry[field];
  config[plan.key] = { ...servers, 'dandelion-kit': entry };
  await atomicWriteFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return { written: true, unchanged: false, created: !existed };
}

/** Shell text is only printed, never run. @param {string} value @param {string} platform */
function quote(value, platform) {
  return platform === 'win32' ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

/** @param {string[]} args @param {Parameters<typeof setupPlan>[1]} [options] */
export async function setupCommand(args, options = {}) {
  const [client, ...rest] = args;
  if (!client || client === '--help' || client === '-h') return { code: 0, text: 'Usage: kit setup <claude-desktop|claude-code|codex|cursor|vscode|generic> [--config <file>] [--dry-run] [--replace]\nThis sets up local tools. Dandelion sign-in is optional and happens later in your browser.' };
  let config;
  let dryRun = false, replace = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--dry-run') dryRun = true;
    else if (rest[i] === '--replace') replace = true;
    else if (rest[i] === '--config' && rest[i+1] && !rest[i+1].startsWith('--')) config = rest[++i];
    else throw new Error(`Unknown or missing setup option: ${rest[i]}. Run kit setup --help.`);
  }
  const plan = setupPlan(client, { ...options, ...(config ? { config } : {}) });
  if (replace && plan.mode !== 'file') throw new Error('--replace only works with a JSON config file. Use the client app to change its old entry.');
  const result = await installClient(plan, { dryRun, replace });
  const lines = [`Client: ${client}`];
  if (plan.file) lines.push(`Config: ${plan.file}`, result.unchanged ? 'The Kit entry is already set up.' : dryRun ? 'Preview only. No settings were changed.' : 'The Kit entry was saved. Other servers and settings were kept.');
  if (plan.command) {
    const windowsShimRisk = plan.platform === 'win32' && [plan.command.file, ...plan.command.args].some(s => /[&|<>^%!"]/.test(s));
    lines.push('Registration was not run.');
    if (windowsShimRisk && plan.client === 'vscode') {
      lines.push('On Windows, choose the workspace MCP file and run setup vscode with --config. This keeps JSON out of command shims.', JSON.stringify({ servers: { 'dandelion-kit': plan.entry } }, null, 2));
    } else if (windowsShimRisk) {
      lines.push('These paths have shell marks. Use the plugin route instead in PowerShell:',
        `${plan.client === 'codex' ? 'codex' : 'claude'} plugin marketplace add lizonthewebauto/dandelion-kit`,
        `${plan.client === 'codex' ? 'codex plugin add' : 'claude plugin install'} dandelion-kit@dandelion-kit`);
    } else {
      lines.push(plan.platform === 'win32' ? 'Run this command in PowerShell:' : 'Run this command in your terminal:');
      lines.push((plan.platform === 'win32' ? '& ' : '') + [plan.command.file, ...plan.command.args].map(s => quote(s, plan.platform)).join(' '));
    }
  } else if (plan.mode === 'json') lines.push('Add this to your local MCP client. Nothing was changed:', JSON.stringify({ mcpServers: { 'dandelion-kit': plan.entry } }, null, 2));
  else lines.push(JSON.stringify({ [plan.key]: { 'dandelion-kit': plan.entry } }, null, 2));
  lines.push('Keep the Kit folder in this place. Restart the AI app or start a new session.', 'Next, call the Kit doctor tool. Video needs ffmpeg with captions. Intel Macs cannot edit Reels yet.', 'Dandelion is optional. Use connect_dandelion when you want to sign in. Setup does not sign in, make an account or post.');
  return { code: 0, text: lines.join('\n') };
}
