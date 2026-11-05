import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIN_NODE_VERSION, nodeVersionSupported, nodeVersionProblem, installEnvironment } from '../bin/runtime.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('runtime checks require at least Node 20.9 before packages load', () => {
  assert.equal(MIN_NODE_VERSION, '20.9.0');
  for (const version of ['18.20.9', '19.9.0', '20.0.0', '20.8.9', 'bad', '20.9']) {
    assert.equal(nodeVersionSupported(version), false, version);
    assert.match(nodeVersionProblem(version) ?? '', /Node.js 20\.9\.0 or newer/);
  }
  for (const version of ['20.9.0', '20.10.1', '21.0.0', '22.0.0', '26.1.2']) {
    assert.equal(nodeVersionSupported(version), true, version);
    assert.equal(nodeVersionProblem(version), null);
  }
});

test('CPU setup skips GPU downloads by default without changing explicit choices or caller env', () => {
  const env = { PATH: 'some-path', DANDELION_KIT_HOME: 'some-home' };
  assert.deepEqual(installEnvironment(env), { ...env, ONNXRUNTIME_NODE_INSTALL: 'skip' });
  assert.equal(env.ONNXRUNTIME_NODE_INSTALL, undefined);
  for (const value of ['cuda12', 'skip', 'true', '']) {
    assert.equal(installEnvironment({ ...env, ONNXRUNTIME_NODE_INSTALL: value }).ONNXRUNTIME_NODE_INSTALL, value);
  }
});

function isolatedBootstrap() {
  const temp = mkdtempSync(join(tmpdir(), 'kit-bootstrap-runtime-'));
  mkdirSync(join(temp, 'bin'));
  for (const file of ['kit.mjs', 'deps.mjs', 'shim-forward.mjs', 'runtime.mjs']) copyFileSync(join(ROOT, 'bin', file), join(temp, 'bin', file));
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ version: '0.0.0', dependencies: { 'kit-test-missing-package': '1.0.0' } }));
  return { temp, kit: join(temp, 'bin', 'kit.mjs') };
}

test('an unwritable setup lock fails once with plain help instead of looping', () => {
  for (const blocked of ['write', 'read']) {
  const { temp, kit } = isolatedBootstrap();
  try {
    const loader = join(temp, 'deny-lock.mjs');
    writeFileSync(loader, `import fs from 'node:fs';
import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const mkdir=fs.mkdirSync;
fs.mkdirSync=(path,...args)=>{if(String(path).endsWith('.kit-install.lock')){const error=new Error('Denied');error.code=${JSON.stringify(blocked === 'write' ? 'EACCES' : 'EEXIST')};throw error;}return mkdir(path,...args);};
const stat=fs.statSync;
fs.statSync=(path,...args)=>{if(String(path).endsWith('.kit-install.lock')){const error=new Error('Denied');error.code='EACCES';throw error;}return stat(path,...args);};
child.spawnSync=(_command,args)=>{if(args[0]==='--version')return {status:0};throw Error('An install must not run after a lock error.');};
syncBuiltinESMExports();
process.argv=[process.execPath,${JSON.stringify(kit)},'install-deps'];
await import(${JSON.stringify(pathToFileURL(kit).href)});
`);
    const result = spawnSync(process.execPath, [loader], { env: { ...process.env, DANDELION_KIT_HOME: join(temp, 'home'), DANDELION_KIT_MODELS: join(temp, 'models') }, encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot (write|read) its setup folder/);
    assert.match(result.stderr, /folder you can write to/);
    assert.equal(result.stdout, '');
  } finally { rmSync(temp, { recursive: true, force: true }); }
  }
});

test('an old Node release is refused before dependency setup starts', () => {
  const { temp, kit } = isolatedBootstrap();
  try {
    const loader = join(temp, 'old-node.mjs');
    writeFileSync(loader, `import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
child.spawnSync=()=>{throw Error('Dependency setup must not run.');};
syncBuiltinESMExports();
Object.defineProperty(process.versions,'node',{value:'20.8.1'});
process.argv=[process.execPath,${JSON.stringify(kit)},'install-deps'];
await import(${JSON.stringify(pathToFileURL(kit).href)});
`);
    const result = spawnSync(process.execPath, [loader], { env: { ...process.env, DANDELION_KIT_HOME: join(temp, 'home'), DANDELION_KIT_MODELS: join(temp, 'models') }, encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Node.js 20\.9\.0 or newer/);
    assert.doesNotMatch(result.stderr, /Dependency setup must not run/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
