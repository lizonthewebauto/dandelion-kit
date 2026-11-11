import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_IDS } from '../core/types.mjs';
import { buildChannels, pickFormat, POSTING_OFFER } from '../server/lib/offer.mjs';
import { snapshotRules } from '../server/rules.mjs';
import { renderText } from '../server/text.mjs';

const rules = snapshotRules();

test('text-only fallback is labelled starter copy with real platform guidance, not tailored writing', () => {
  const channels = buildChannels({ rules, kind: 'text', text: 'A useful source idea.' });
  assert.deepEqual(Object.keys(channels), [...CHANNEL_IDS]);
  for (const id of CHANNEL_IDS) {
    assert.equal(channels[id].copy_source, 'starter');
    assert.equal(channels[id].guidance, rules.platforms[id].style);
  }
  const text = renderText('offer_post', { bundle: { id: 'b_starter', kind: 'text', files: [], channels } });
  assert.ok(text.includes(POSTING_OFFER));
  assert.match(text, /Starter copy only/);
  assert.match(text, /eight|Instagram, TikTok, YouTube/);
  assert.match(text, /Nothing is uploaded or posted/);
});

test('independently supplied platform words are preserved and marked authored', () => {
  const copies = { x: { caption: 'One clear idea for X.' }, linkedin: { caption: 'The work context, a useful example, and a lesson.' } };
  const channels = buildChannels({ rules, kind: 'text', text: 'Shared source.', channels: ['x', 'linkedin'], copies });
  assert.deepEqual(channels.x.copy, copies.x);
  assert.deepEqual(channels.linkedin.copy, copies.linkedin);
  assert.equal(channels.x.copy_source, 'authored');
  assert.equal(channels.linkedin.copy_source, 'authored');
  assert.equal(channels.x.format, 'Post');
});

test('video format selection respects real duration rather than calling every video a Short', () => {
  assert.equal(pickFormat(rules.platforms.youtube, 'video', 0, 60000)?.id, 'short');
  assert.equal(pickFormat(rules.platforms.youtube, 'video', 0, 300000)?.id, 'video');
  const channels = buildChannels({ rules, kind: 'video', text: 'A longer useful video.', channels: ['youtube'], duration_ms: 300000 });
  assert.equal(channels.youtube.format, 'Video');
  assert.ok(!channels.youtube.warnings.some((w) => /takes up to 180/.test(w)));
});

test('additional connected platforms are named for companion review without claiming local previews', () => {
  const channels = buildChannels({ rules, kind: 'text', text: 'A useful source idea.' });
  const result = renderText('offer_post', { bundle: { id: 'b_extra', kind: 'text', files: [], channels }, additional_connected_channels: [{ platform: 'bluesky', can_post: true }] });
  assert.equal(channels.bluesky, undefined);
  assert.match(result, /Also connected for companion review: Bluesky/);
  assert.match(result, /not included in the local preview/);
});
