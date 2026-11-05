import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectKit, textOf } from './server-helpers.mjs';
test('style tools save partial choices and list borrowed parts', async () => {
  const previous = process.env.DANDELION_KIT_HOME;
  const home = await mkdtemp(join(tmpdir(), 'kit-style-tools-'));
  process.env.DANDELION_KIT_HOME = home;
  const kit = await connectKit();
  try {
    const saved = await kit.call('save_style', { name: 'Blue days', style: { brand: { colors: { bg: '#102A43' } } }, liked: ['colors'] });
    assert.ok(!saved.isError, textOf(saved));
    assert.equal(saved.structuredContent.is_default, true);
    assert.deepEqual(saved.structuredContent.style.brand, { colors: { bg: '#102A43' } });
    const listed = await kit.call('list_styles');
    assert.match(textOf(listed), /Blue days.*default/);
    assert.match(textOf(listed), /Borrowed: colors/);
    assert.equal((await kit.call('list_styles', { name: 'blue-days' })).structuredContent.style.name, 'Blue days');
    assert.ok(!(await kit.call('save_style', { name: 'Blue days', remove: true })).isError);
    assert.deepEqual((await kit.call('list_styles')).structuredContent.styles, []);
  } finally {
    await kit.close();
    if (previous === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
