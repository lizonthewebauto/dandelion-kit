// The proxy helpers (one per Dandelion tool), the account state, the id mapping and the public rules,
// all against the fake Dandelion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CHANNEL_IDS } from '../core/types.mjs';
import { DandelionError } from '../server/dandelion/config.mjs';
import { dandelionCopyFromKit, kitCopyFromDandelion, kitJobStatus, toDandelionPlatform, toKitPlatform } from '../server/dandelion/ids.mjs';
import { RULES_MAX_AGE_MS, isUsableRules, loadPlatformRules, rulesCachePath, snapshotRules } from '../server/dandelion/platform-rules.mjs';
import { loadRules } from '../server/rules.mjs';
import { useFakeDandelion } from './dandelion-fake.mjs';

test('ids: x is twitter on Dandelion, both ways, and copy fields map without losing words', () => {
  assert.equal(toDandelionPlatform('x'), 'twitter');
  assert.equal(toDandelionPlatform('instagram'), 'instagram');
  assert.equal(toKitPlatform('twitter'), 'x');
  assert.equal(toKitPlatform('tiktok'), 'tiktok');
  for (const id of CHANNEL_IDS) assert.equal(toKitPlatform(toDandelionPlatform(id)), id);
  assert.deepEqual(dandelionCopyFromKit({ caption: 'Hi', hashtags: ['#a', '#b'] }), { caption: 'Hi', hashtags: ['a', 'b'] });
  assert.deepEqual(dandelionCopyFromKit({ caption: 'Hi', hashtags: ['#a'] }, { skipHashtags: true }), { caption: 'Hi' });
  assert.deepEqual(dandelionCopyFromKit({ title: 'T', description: 'D' }), { title: 'T', description: 'D' });
  assert.deepEqual(kitCopyFromDandelion({ caption: 'Hi', hashtags: ['a', '#b'], first_comment: 'x' }), { caption: 'Hi', hashtags: ['#a', '#b'] });
  assert.deepEqual(kitCopyFromDandelion(null), {});
  assert.equal(kitJobStatus('review'), 'review');
  assert.equal(kitJobStatus('processing'), 'review');
  assert.equal(kitJobStatus('approved'), 'posting');
  assert.equal(kitJobStatus('approved', true), 'scheduled');
  assert.equal(kitJobStatus('scheduled'), 'scheduled');
  assert.equal(kitJobStatus('posted'), 'posted');
  assert.equal(kitJobStatus('failed'), 'failed');
});

test('helpers: every proxy helper reaches the right Dandelion tool with the right fields and returns plain data', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    const c = t.client;
    await c.connect({ waitMs: 15000 });
    const { brandId } = t.fake;
    const last = () => t.fake.state.calls[t.fake.state.calls.length - 1];

    const brands = await c.listBrands();
    assert.deepEqual(brands.map((b) => b.name), ['Dandelion QA', 'Second Brand']);

    const channels = await c.listChannels(brandId);
    assert.equal(channels.length, 3);
    assert.deepEqual(last(), { tool: 'list_channels', args: { brand_id: brandId } });
    assert.equal(channels.find((x) => x.platform === 'youtube')?.can_post, false);

    const usage = await c.getUsage();
    assert.equal(usage.plan.name, 'Free');

    const started = await c.getStarted(brandId);
    assert.equal(started.brand.id, brandId);
    assert.deepEqual(last().args, { brand_id: brandId });
    await c.getStarted();
    assert.deepEqual(last().args, {});

    // The kit says x, Dandelion says twitter.
    const link = await c.getConnectLink(brandId, 'x');
    assert.deepEqual(last(), { tool: 'get_connect_link', args: { brand_id: brandId, platform: 'twitter' } });
    assert.match(link.url, /platform=twitter/);
    await c.getConnectLink(brandId, 'tiktok');
    assert.equal(last().args.platform, 'tiktok');

    const flows = await c.listFlows(brandId);
    assert.deepEqual(flows, []);

    const upload = await c.createUpload({ brandId, filename: 'a.jpg', bytes: 10, mime: 'image/jpeg' });
    assert.deepEqual(last().args, { brand_id: brandId, filename: 'a.jpg', bytes: 10, mime: 'image/jpeg' });
    assert.equal(upload.method, 'PUT');
    assert.equal(upload.headers['content-type'], 'image/jpeg');

    const item = await c.addContent({ brandId, caption: 'Hello' });
    assert.deepEqual(last().args, { brand_id: brandId, caption: 'Hello', media_urls: [], upload_ids: [] });
    assert.equal(item.status, 'ready');

    const igId = channels.find((x) => x.platform === 'instagram')?.id ?? '';
    const share = await c.shareContent({ contentId: item.id, channelIds: [igId] });
    assert.deepEqual(last().args, { content_id: item.id, channel_ids: [igId], mode: 'review' });
    assert.equal(share.job_ids.length, 1);
    const jobId = share.job_ids[0];

    const job = await c.getJob(jobId);
    assert.equal(job.status, 'review');
    assert.equal(job.platform, 'instagram');

    await c.updateJobCopy(jobId, { caption: 'Edited', hashtags: ['x'] });
    assert.deepEqual(last().args, { job_id: jobId, caption: 'Edited', hashtags: ['x'] });
    assert.equal((await c.getJob(jobId)).copy.caption, 'Edited');

    const when = '2026-12-02T14:00:00.000Z';
    const approved = await c.approveJob(jobId, when);
    assert.deepEqual(last().args, { job_id: jobId, post_at: when });
    assert.equal(approved.job.status, 'scheduled');
    assert.equal(approved.job.scheduled_for, when);

    const second = (await c.shareContent({ contentId: item.id, channelIds: [igId] })).job_ids[0];
    const skipped = await c.skipJob(second);
    assert.equal(skipped.job.status, 'skipped');

    // Without post_at, none is sent.
    const third = (await c.shareContent({ contentId: item.id, channelIds: [igId] })).job_ids[0];
    await c.approveJob(third);
    assert.deepEqual(last().args, { job_id: third });
  } finally {
    await t.stop();
  }
});

test('helpers: Dandelion errors become plain DandelionError messages', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    await assert.rejects(() => t.client.listChannels('00000000-0000-4000-8000-000000000000'), (e) => e instanceof DandelionError && e.code === 'not_found' && /could not find that brand/.test(e.message));
    await assert.rejects(() => t.client.getJob('nope'), (e) => e instanceof DandelionError && e.code === 'not_found');
    await assert.rejects(() => t.client.approveJob('nope'), (e) => e instanceof DandelionError && !/\n\s+at /.test(e.message));
    await assert.rejects(() => t.client.createUpload({ brandId: t.fake.brandId, filename: 'x.bmp', bytes: 5, mime: 'image/bmp' }), (e) => e instanceof DandelionError && /cannot post/.test(e.message));
  } finally {
    await t.stop();
  }
});

test('state: brands, apps that can post (kit ids), plan, use and connect links; cached for 30 seconds unless fresh', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    t.client.invalidateState();
    const count = () => t.fake.state.calls.filter((c) => c.tool === 'get_started').length;
    const before = count();
    const state = await t.client.getState();
    assert.equal(state.connected, true);
    assert.equal(state.plan, 'Free');
    assert.deepEqual(state.usage, { used: 12, limit: 60, resets_at: '2026-11-01T00:00:00.000Z' });
    assert.deepEqual(state.brands?.map((b) => b.id), [t.fake.brandId, t.fake.otherBrandId]);
    const byPlatform = Object.fromEntries((state.channels ?? []).map((ch) => [ch.platform, ch]));
    assert.equal(byPlatform.instagram.can_post, true);
    assert.equal(byPlatform.instagram.brand_id, t.fake.brandId);
    assert.equal(byPlatform.instagram.handle, 'qa_insta');
    assert.equal(byPlatform.x.can_post, true, 'twitter shows as x');
    assert.equal(byPlatform.twitter, undefined);
    assert.equal(byPlatform.youtube.can_post, false);
    const linkPlatforms = (state.connect_links ?? []).map((l) => l.platform);
    assert.ok(!linkPlatforms.includes('instagram') && !linkPlatforms.includes('x') && linkPlatforms.includes('tiktok'));
    await t.client.getState();
    assert.equal(count(), before + 1, 'second call is served from the cache');
    await t.client.getState({ fresh: true });
    assert.equal(count(), before + 2);
    // Another brand.
    const other = await t.client.getState({ brandId: t.fake.otherBrandId, fresh: true });
    assert.equal(other.channels?.filter((ch) => ch.brand_id === t.fake.brandId).length, 3, 'apps from the first brand are still listed');
    assert.equal(other.connect_links?.some((l) => l.platform === 'instagram'), true, 'links are for the chosen brand, which has none connected');
  } finally {
    await t.stop();
  }
});

test('rules: fetched live, kept a day, stale copy beats the saved one, the saved copy is the last resort', async () => {
  const t = await useFakeDandelion();
  try {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const first = await loadPlatformRules({ now });
    assert.equal(t.fake.state.rulesHits, 1);
    assert.equal(first.fetched_at, '2026-10-30T12:00:00.000Z');
    assert.deepEqual(Object.keys(first.platforms).sort(), [...CHANNEL_IDS].sort());
    assert.equal(first.platforms.instagram.formats.find((f) => f.id === 'reel')?.maxSeconds, 900);
    assert.ok(existsSync(rulesCachePath()));

    // Within a day: no new request.
    const again = await loadPlatformRules({ now: now + RULES_MAX_AGE_MS - 1000 });
    assert.equal(t.fake.state.rulesHits, 1);
    assert.equal(again.fetched_at, first.fetched_at);

    // Past a day: fetched again.
    const later = await loadPlatformRules({ now: now + RULES_MAX_AGE_MS + 1000 });
    assert.equal(t.fake.state.rulesHits, 2);
    assert.notEqual(later.fetched_at, first.fetched_at);

    // The network fails: the older copy is used.
    const failing = /** @type {typeof fetch} */ (async () => {
      throw new Error('offline');
    });
    const stale = await loadPlatformRules({ now: now + 5 * RULES_MAX_AGE_MS, fetchImpl: failing });
    assert.equal(stale.fetched_at, later.fetched_at);

    // No cache and no network: the saved copy (no fetched_at).
    writeFileSync(rulesCachePath(), '{ broken');
    const saved = await loadPlatformRules({ now, fetchImpl: failing });
    assert.equal(saved.fetched_at, undefined);
    assert.deepEqual(saved.platforms, snapshotRules().platforms);

    // An answer that is not rules is ignored.
    const junk = /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ platforms: { instagram: { name: 5 } } }), { status: 200 }));
    assert.equal((await loadPlatformRules({ now, fetchImpl: junk })).fetched_at, undefined);
    const notOk = /** @type {typeof fetch} */ (async () => new Response('no', { status: 500 }));
    assert.equal((await loadPlatformRules({ now, fetchImpl: notOk })).fetched_at, undefined);

    // Missing apps are filled from the saved copy so all eight always show.
    const onlyOne = snapshotRules();
    const partial = /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ version: 1, platforms: { instagram: onlyOne.platforms.instagram } }), { status: 200 }));
    const filled = await loadPlatformRules({ now, fetchImpl: partial, force: true });
    assert.deepEqual(Object.keys(filled.platforms).sort(), [...CHANNEL_IDS].sort());
  } finally {
    await t.stop();
  }
});

test('rules: rules.mjs reports live when they came from Dandelion, and DANDELION_KIT_OFFLINE keeps the kit off the network', async () => {
  const t = await useFakeDandelion();
  try {
    const live = await loadRules();
    assert.equal(live.source, 'live');
    assert.equal(t.fake.state.rulesHits, 1);
    process.env.DANDELION_KIT_OFFLINE = '1';
    writeFileSync(rulesCachePath(), '{}');
    const offline = await loadRules();
    assert.equal(offline.source, 'snapshot');
    assert.equal(t.fake.state.rulesHits, 1);
  } finally {
    await t.stop();
  }
});

test('rules: the saved snapshot is a usable rules document with all eight apps and the live shape', () => {
  const snap = snapshotRules();
  assert.equal(isUsableRules(snap), true);
  assert.deepEqual(Object.keys(snap.platforms).sort(), [...CHANNEL_IDS].sort());
  assert.equal(/** @type {any} */ (snap.platforms.x).dandelion_id, 'twitter');
  assert.equal(snap.platforms.instagram.formats.find((f) => f.id === 'reel')?.maxSeconds, 900);
  assert.equal(snap.fetched_at, undefined);
  assert.equal(isUsableRules(null), false);
  assert.equal(isUsableRules({ platforms: {} }), false);
  // The file on disk is the one the kit ships.
  const onDisk = JSON.parse(readFileSync(new URL('../assets/platform-rules.snapshot.json', import.meta.url), 'utf8'));
  assert.deepEqual(onDisk, snap);
});

test('rules: under the test runner without DANDELION_URL the kit stays offline (other tests rely on this)', async () => {
  const previousUrl = process.env.DANDELION_URL;
  const previousHome = process.env.DANDELION_KIT_HOME;
  delete process.env.DANDELION_URL;
  const offlineHome = (await import('../core/util/fs.mjs')).makeTempDir('kit-rules-offline-');
  process.env.DANDELION_KIT_HOME = offlineHome;
  try {
    const r = await loadPlatformRules();
    assert.equal(r.fetched_at, undefined);
  } finally {
    if (previousUrl !== undefined) process.env.DANDELION_URL = previousUrl;
    if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
    else process.env.DANDELION_KIT_HOME = previousHome;
    try {
      (await import('node:fs')).rmSync(offlineHome, { recursive: true, force: true });
    } catch {}
  }
});
