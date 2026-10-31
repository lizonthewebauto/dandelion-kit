// After the first-run shim hands off to the real server, a host that ignored "tools/list_changed" may still call
// setup_status. The line forwarder answers that itself and passes everything else through untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READY_TEXT, createForwarder } from '../bin/shim-forward.mjs';

function setup(pending = '') {
  /** @type {string[]} */
  const forwarded = [];
  /** @type {any[]} */
  const answers = [];
  const forward = createForwarder((l) => forwarded.push(l), (m) => answers.push(m), pending);
  return { forward, forwarded, answers };
}

const call = (/** @type {any} */ id, /** @type {string} */ name) =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });

test('the ready text has no dashes', () => {
  assert.ok(![8208, 8209, 8210, 8211, 8212, 8213, 45].some((code) => READY_TEXT.includes(String.fromCharCode(code))));
  assert.match(READY_TEXT, /call doctor/);
});

test('a setup_status call is answered with the ready text and the same id, and not forwarded', () => {
  const { forward, forwarded, answers } = setup();
  forward.push(`${call(7, 'setup_status')}\n`);
  assert.deepEqual(forwarded, []);
  assert.deepEqual(answers, [{ id: 7, result: { content: [{ type: 'text', text: READY_TEXT }], isError: false } }]);
  forward.push(`${call('abc', 'setup_status')}\n`);
  assert.equal(answers[1].id, 'abc');
});

test('any other tools/call line is forwarded unchanged', () => {
  const { forward, forwarded, answers } = setup();
  const line = call(8, 'doctor');
  forward.push(`${line}\n`);
  assert.deepEqual(forwarded, [`${line}\n`]);
  assert.deepEqual(answers, []);
});

test('a setup_status notification with no id is forwarded, not answered', () => {
  const { forward, forwarded, answers } = setup();
  const line = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'setup_status' } });
  forward.push(`${line}\n`);
  assert.deepEqual(forwarded, [`${line}\n`]);
  assert.deepEqual(answers, []);
});

test('a line split across two chunks is forwarded once, whole', () => {
  const { forward, forwarded } = setup();
  const line = call(9, 'doctor');
  forward.push(line.slice(0, 20));
  assert.deepEqual(forwarded, []);
  forward.push(`${line.slice(20)}\n`);
  assert.deepEqual(forwarded, [`${line}\n`]);
});

test('a setup_status call split across chunks is answered once', () => {
  const { forward, forwarded, answers } = setup();
  const line = call(10, 'setup_status');
  forward.push(line.slice(0, 15));
  forward.push(`${line.slice(15)}\n`);
  assert.equal(answers.length, 1);
  assert.deepEqual(forwarded, []);
});

test('several lines in one chunk are handled in order', () => {
  const { forward, forwarded, answers } = setup();
  const a = call(1, 'doctor');
  const b = call(2, 'setup_status');
  const c = call(3, 'doctor');
  forward.push(`${a}\n${b}\n${c}\n`);
  assert.deepEqual(forwarded, [`${a}\n`, `${c}\n`]);
  assert.equal(answers[0].id, 2);
});

test('non-JSON lines pass through unchanged', () => {
  const { forward, forwarded, answers } = setup();
  forward.push('not json at all\n');
  assert.deepEqual(forwarded, ['not json at all\n']);
  assert.deepEqual(answers, []);
});

test('text read before the handoff without a newline is completed by the next chunk', () => {
  const line = call(11, 'setup_status');
  const { forward, forwarded, answers } = setup(line.slice(0, 10));
  forward.push(`${line.slice(10)}\n`);
  assert.equal(answers.length, 1);
  assert.deepEqual(forwarded, []);
});

test('flush sends a last line that never got its newline', () => {
  const { forward, forwarded } = setup();
  const line = call(12, 'doctor');
  forward.push(line);
  assert.deepEqual(forwarded, []);
  forward.flush();
  assert.deepEqual(forwarded, [`${line}\n`]);
  forward.flush();
  assert.equal(forwarded.length, 1);
});
