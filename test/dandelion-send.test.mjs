// Uploading files, sending a post to Dandelion (library and review), and the kit tools that wrap it,
// against the fake Dandelion. Nothing here approves or posts anything real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DandelionError, NotSignedInError } from '../server/dandelion/config.mjs';
import { MAX_FILES_PER_POST, libraryCaption, sendBundle } from '../server/dandelion/send.mjs';
import { mimeFor, uploadFile, uploadFiles } from '../server/dandelion/upload.mjs';
import { loadRules } from '../server/rules.mjs';
import { buildChannels, saveBundle } from '../server/lib/offer.mjs';
import { connectKit, textOf, DASH_RE } from './server-helpers.mjs';
import { useFakeDandelion } from './dandelion-fake.mjs';

const sha = (/** @type {Buffer} */ b) => createHash('sha256').update(b).digest('hex');

/** Two small JPEGs and a 3 MB "video" in the test home. */
async function makeFiles(/** @type {string} */ dir) {
  mkdirSync(dir, { recursive: true });
  const jpg = async (/** @type {string} */ name, /** @type {string} */ color) => {
    const file = join(dir, name);
    await sharp({ create: { width: 1080, height: 1350, channels: 3, background: color } }).jpeg({ quality: 80 }).toFile(file);
    return file;
  };
  const video = join(dir, 'reel.mp4');
  writeFileSync(video, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), randomBytes(3_000_000)]));
  return { a: await jpg('slide-01.jpg', '#f5b400'), b: await jpg('slide-02.jpg', '#222222'), video };
}

/** A saved post bundle with a draft for each app. */
async function makeBundle(/** @type {Record<string, any>} */ over) {
  const { rules } = await loadRules({ live: false });
  const text = over.text ?? 'Three habits that changed my mornings. Save this. #morning #habits';
  const channels = buildChannels({ rules, kind: over.kind ?? 'carousel', text, image_count: over.files?.length });
  const bundle = { id: `b_${randomBytes(4).toString('hex')}`, kind: 'carousel', files: [], text, channels, rules_source: 'snapshot', created_at: Date.now(), ...over };
  await saveBundle(/** @type {any} */ (bundle));
  return /** @type {any} */ (bundle);
}

test('upload: streams the exact bytes with the right headers, via a fresh link, and returns the upload_id', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    /** @type {number[]} */
    const progress = [];
    const up = await uploadFile({ brandId: t.fake.brandId, file: files.video, createUpload: t.client.createUpload, onProgress: (sent, total) => progress.push(sent / total) });
    assert.match(up.upload_id, /^up_/);
    assert.equal(up.mime, 'video/mp4');
    assert.equal(up.bytes, 3_000_000 + 12);
    const stored = t.fake.state.putBodies.get(t.fake.state.uploads.get(up.upload_id)?.path ?? '');
    assert.ok(stored, 'the server got the file');
    assert.equal(sha(/** @type {Buffer} */ (stored)), sha(readFileSync(files.video)));
    assert.deepEqual(t.fake.state.putHeaders[0], { 'content-type': 'video/mp4', 'content-length': String(up.bytes) });
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.length > 1 && progress.every((p, i) => i === 0 || p >= progress[i - 1]));
    const create = t.fake.state.calls.find((c) => c.tool === 'create_upload');
    assert.deepEqual(create?.args, { brand_id: t.fake.brandId, filename: 'reel.mp4', bytes: up.bytes, mime: 'video/mp4' });
  } finally {
    await t.stop();
  }
});

test('upload: retries twice on a server hiccup with a new link each time, then gives up in plain words', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    t.fake.state.putFailures = 2;
    const up = await uploadFile({ brandId: t.fake.brandId, file: files.a, createUpload: t.client.createUpload, retryDelayMs: 5 });
    assert.equal(t.fake.state.putCount, 3);
    assert.equal(t.fake.state.calls.filter((c) => c.tool === 'create_upload').length, 3, 'a fresh link each try');
    assert.ok(up.upload_id);

    t.fake.state.putFailures = 5;
    t.fake.state.putCount = 0;
    await assert.rejects(
      () => uploadFile({ brandId: t.fake.brandId, file: files.a, createUpload: t.client.createUpload, retryDelayMs: 5 }),
      (e) => e instanceof DandelionError && /busy/.test(e.message),
    );
    assert.equal(t.fake.state.putCount, 3, 'one try and two retries');
  } finally {
    await t.stop();
  }
});

test('upload: a network error retries; a missing file, a wrong type and an empty file are refused before any request', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    let calls = 0;
    const flaky = /** @type {typeof fetch} */ (async (/** @type {any} */ url, /** @type {any} */ init) => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return fetch(url, init);
    });
    await uploadFile({ brandId: t.fake.brandId, file: files.a, createUpload: t.client.createUpload, fetchImpl: flaky, retryDelayMs: 5 });
    assert.equal(calls, 2);

    const before = t.fake.state.calls.length;
    await assert.rejects(() => uploadFile({ brandId: t.fake.brandId, file: join(t.home, 'missing.jpg'), createUpload: t.client.createUpload }), /could not find the file/);
    writeFileSync(join(t.home, 'notes.txt'), 'hi');
    await assert.rejects(() => uploadFile({ brandId: t.fake.brandId, file: join(t.home, 'notes.txt'), createUpload: t.client.createUpload }), /Dandelion cannot post notes.txt/);
    writeFileSync(join(t.home, 'empty.jpg'), '');
    await assert.rejects(() => uploadFile({ brandId: t.fake.brandId, file: join(t.home, 'empty.jpg'), createUpload: t.client.createUpload }), /is empty/);
    assert.equal(t.fake.state.calls.length, before, 'nothing was asked of Dandelion');
    assert.equal(mimeFor('X.JPG'), 'image/jpeg');
    assert.equal(mimeFor('a.mov'), 'video/quicktime');
    assert.equal(mimeFor('a.bmp'), undefined);
  } finally {
    await t.stop();
  }
});

test('uploadFiles: reports overall progress across files', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    /** @type {number[]} */
    const fractions = [];
    const ups = await uploadFiles({ brandId: t.fake.brandId, files: [files.a, files.b, files.video], createUpload: t.client.createUpload, progress: (f) => fractions.push(f) });
    assert.equal(ups.length, 3);
    assert.equal(Math.round(fractions.at(-1) ?? 0), 1);
    assert.ok(fractions.every((f) => f >= 0 && f <= 1.0001));
  } finally {
    await t.stop();
  }
});

test('send library: files up, one library item with the words, nothing shared, and the record is kept for later', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a, files.b] });
    /** @type {any[]} */
    const savedEarly = [];
    const { sent, notes } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'library', onSent: (s) => void savedEarly.push(s) });
    assert.equal(sent.mode, 'library');
    assert.deepEqual(sent.jobs, []);
    assert.equal(sent.brand_id, t.fake.brandId);
    assert.deepEqual(notes, []);
    assert.equal(savedEarly.length, 1);
    const add = t.fake.state.calls.find((c) => c.tool === 'add_content');
    assert.equal(add?.args.caption, bundle.text);
    assert.equal(add?.args.upload_ids.length, 2);
    assert.equal(t.fake.state.putCount, 2);
    assert.equal(t.fake.state.calls.some((c) => c.tool === 'share_content'), false);
    assert.ok(t.fake.state.content.get(sent.content_id));
  } finally {
    await t.stop();
  }
});

test('send library of a text only post makes a library item with no files', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const bundle = await makeBundle({ kind: 'text', files: [], text: 'Just words. #one' });
    const { sent } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'library' });
    const add = t.fake.state.calls.find((c) => c.tool === 'add_content');
    assert.deepEqual(add?.args.upload_ids, []);
    assert.equal(add?.args.caption, 'Just words. #one');
    assert.ok(sent.content_id);
    assert.equal(t.fake.state.putCount, 0);
  } finally {
    await t.stop();
  }
});

test('send review with no connected app: the files are saved, no share is attempted, and the answer says what to connect', async () => {
  const t = await useFakeDandelion();
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a] });
    const { sent, notes } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram', 'x'] });
    assert.equal(sent.mode, 'review');
    assert.deepEqual(sent.jobs, []);
    assert.ok(sent.content_id);
    assert.match(notes.join(' '), /No connected app can post for instagram, x/);
    assert.equal(t.fake.state.calls.some((c) => c.tool === 'share_content'), false);
  } finally {
    await t.stop();
  }
});

test('send review with connected apps: a waiting post per app with that app\'s own words, kit ids, nothing approved', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a, files.b] });
    bundle.channels.instagram.copy = { caption: 'Instagram words', hashtags: ['#morning', '#habits'] };
    bundle.channels.x.copy = { caption: 'X words' };
    const { sent, notes } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram', 'x', 'youtube'] });
    assert.equal(sent.mode, 'review');
    assert.deepEqual(sent.jobs.map((j) => j.platform).sort(), ['instagram', 'x']);
    const ig = sent.jobs.find((j) => j.platform === 'instagram');
    assert.equal(ig?.status, 'review');
    assert.equal(ig?.handle, 'qa_insta');
    assert.deepEqual(ig?.copy, { caption: 'Instagram words', hashtags: ['#morning', '#habits'] });
    assert.deepEqual(ig?.checks, []);
    const x = sent.jobs.find((j) => j.platform === 'x');
    assert.equal(x?.handle, 'qa_x');
    assert.deepEqual(x?.copy, { caption: 'X words' });
    // youtube is expired, so it cannot post.
    assert.match(notes.join(' '), /No connected app can post for youtube/);
    const saves = t.fake.state.calls.filter((c) => c.tool === 'update_job_copy').map((c) => c.args);
    assert.ok(saves.some((a) => a.caption === 'Instagram words' && JSON.stringify(a.hashtags) === '["morning","habits"]'), 'hashtags go without #');
    assert.equal(t.fake.state.calls.some((c) => c.tool === 'approve_job'), false, 'nothing is approved');
    assert.equal([...t.fake.state.jobs.values()].every((j) => j.status === 'review'), true);
    const share = t.fake.state.calls.find((c) => c.tool === 'share_content');
    assert.equal(share?.args.mode, 'review');
    assert.equal(share?.args.channel_ids.length, 2);
  } finally {
    await t.stop();
  }
});

test('send again for the same post: files are not sent twice, and apps that already have a waiting post are not doubled', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a] });
    const first = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'library' });
    bundle.sent = first.sent;
    const puts = t.fake.state.putCount;
    const second = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram'] });
    assert.equal(t.fake.state.putCount, puts, 'no second upload');
    assert.equal(t.fake.state.calls.filter((c) => c.tool === 'add_content').length, 1);
    assert.equal(second.sent.content_id, first.sent.content_id);
    assert.equal(second.sent.jobs.length, 1);
    assert.match(second.notes.join(' '), /already in your Dandelion library/);
    bundle.sent = second.sent;
    const third = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram'] });
    assert.equal(third.sent.jobs.length, 1, 'not doubled');
    assert.match(third.notes.join(' '), /already waiting/);
    assert.equal(t.fake.state.calls.filter((c) => c.tool === 'share_content').length, 1);
  } finally {
    await t.stop();
  }
});

test('send review waits for Dandelion to get a post ready, and for content that is not ready yet', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a] });
    t.fake.state.processingPolls = 2;
    t.fake.state.notReady = 2;
    const { sent } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram'], pollMs: 10, preparingMs: 2000 });
    assert.equal(sent.jobs[0].status, 'review');
    assert.deepEqual(sent.jobs[0].checks, []);
    assert.equal(t.fake.state.calls.filter((c) => c.tool === 'share_content').length, 3);
  } finally {
    await t.stop();
  }
});

test('send review: a post that stays "processing" is shown with a check, not as ready', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const bundle = await makeBundle({ kind: 'text', files: [], text: 'Only words.' });
    t.fake.state.processingPolls = 1000;
    const { sent } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram'], pollMs: 5, preparingMs: 60 });
    assert.match(sent.jobs[0].checks.join(' '), /still getting this post ready/);
  } finally {
    await t.stop();
  }
});

test('send review: if Dandelion refuses the words for one app, that shows up as a check and the rest still go through', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const bundle = await makeBundle({ kind: 'text', files: [], text: 'Only words.' });
    t.fake.state.copyError = 'The caption is too long for X.';
    const { sent } = await sendBundle({ bundle, brandId: t.fake.brandId, mode: 'review', channels: ['instagram', 'x'] });
    assert.equal(sent.jobs.length, 2);
    for (const j of sent.jobs) assert.match(j.checks.join(' '), /too long for X/);
  } finally {
    await t.stop();
  }
});

test('send refuses when an Autoshare would post the new upload by itself, before anything is uploaded', async () => {
  const t = await useFakeDandelion({ withChannels: true, autoFlow: true });
  try {
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a] });
    await assert.rejects(
      () => sendBundle({ bundle, brandId: t.fake.brandId, mode: 'library' }),
      (e) => e instanceof DandelionError && e.code === 'autoshare_would_post' && /post it in public/.test(e.message) && /Nothing was sent/.test(e.message),
    );
    assert.equal(t.fake.state.putCount, 0);
    assert.equal(t.fake.state.calls.some((c) => c.tool === 'add_content' || c.tool === 'create_upload'), false);
  } finally {
    await t.stop();
  }
});

test('send refuses an unknown brand (naming the real ones) and more than 10 files, and needs a sign-in', async () => {
  const t = await useFakeDandelion();
  try {
    await assert.rejects(() => sendBundle({ bundle: /** @type {any} */ ({ files: [], channels: {} }), brandId: 'x' }), NotSignedInError);
    await t.client.connect({ waitMs: 15000 });
    const files = await makeFiles(join(t.home, 'in'));
    const bundle = await makeBundle({ files: [files.a] });
    await assert.rejects(
      () => sendBundle({ bundle, brandId: '11111111-1111-4111-8111-111111111111' }),
      (e) => e instanceof DandelionError && /Dandelion QA/.test(e.message) && /Second Brand/.test(e.message),
    );
    const many = await makeBundle({ files: Array.from({ length: MAX_FILES_PER_POST + 1 }, () => files.a) });
    await assert.rejects(() => sendBundle({ bundle: many, brandId: t.fake.brandId }), /up to 10 files/);
    const gone = await makeBundle({ files: [join(t.home, 'gone.jpg')] });
    await assert.rejects(() => sendBundle({ bundle: gone, brandId: t.fake.brandId }), /could not find the file/);
    const empty = await makeBundle({ kind: 'text', files: [], text: '', channels: {} });
    empty.channels = {};
    await assert.rejects(() => sendBundle({ bundle: empty, brandId: t.fake.brandId }), /nothing to send/);
  } finally {
    await t.stop();
  }
});

test('libraryCaption: the original text, else the best app\'s words with its hashtags', () => {
  assert.equal(libraryCaption(/** @type {any} */ ({ text: '  Hello #a  ', channels: {} })), 'Hello #a');
  assert.equal(libraryCaption(/** @type {any} */ ({ channels: { tiktok: { copy: { caption: 'T' } }, instagram: { copy: { caption: 'I', hashtags: ['#x'] } } } })), 'I\n\n#x');
  assert.equal(libraryCaption(/** @type {any} */ ({ channels: { youtube: { copy: { title: 'Only title' } } } })), 'Only title');
  assert.equal(libraryCaption(/** @type {any} */ ({ channels: {} })), '');
});

// ---------------------------------------------------------------------------
// The kit tools, through a kit server in memory
// ---------------------------------------------------------------------------

test('tools: sign in, status, offer, send to the library, send for review, approve with a time, skip, all in plain words', async () => {
  const t = await useFakeDandelion({ withChannels: true });
  process.env.DANDELION_KIT_CONNECT_WAIT_MS = '15000';
  const kit = await connectKit();
  try {
    const files = await makeFiles(join(t.home, 'in'));

    // Before sign-in.
    const status0 = await kit.call('dandelion_status');
    assert.equal(status0.isError, undefined, textOf(status0));
    assert.equal(status0.structuredContent.dandelion.connected, false);
    assert.match(textOf(status0), /not signed in/);
    const offer = await kit.call('offer_post', { kind: 'carousel', text: 'Three habits that changed my mornings. #morning', files: [files.a, files.b] });
    assert.equal(offer.structuredContent.dandelion.connected, false);
    const bundleId = offer.structuredContent.bundle.id;
    const tooSoon = await kit.call('send_to_dandelion', { bundle_id: bundleId, brand_id: t.fake.brandId, mode: 'library' });
    assert.equal(tooSoon.isError, true);
    assert.match(textOf(tooSoon), /connect Dandelion/);
    assert.equal(t.fake.state.putCount, 0);

    // Sign in.
    const conn = await kit.call('connect_dandelion');
    assert.equal(conn.isError, undefined, textOf(conn));
    assert.equal(conn.structuredContent.dandelion.connected, true);
    assert.equal(conn.structuredContent.dandelion.plan, 'Free');
    assert.match(textOf(conn), /signed in/);

    // offer_post now shows the account.
    const offer2 = await kit.call('offer_post', { kind: 'carousel', text: 'Three habits that changed my mornings. #morning', files: [files.a, files.b] });
    const dl = offer2.structuredContent.dandelion;
    assert.equal(dl.connected, true);
    assert.ok(dl.channels.some((c) => c.platform === 'x' && c.can_post));
    const bundleId2 = offer2.structuredContent.bundle.id;

    // Library.
    const lib = await kit.call('send_to_dandelion', { bundle_id: bundleId2, brand_id: t.fake.brandId, mode: 'library' });
    assert.equal(lib.isError, undefined, textOf(lib));
    assert.equal(lib.structuredContent.sent.mode, 'library');
    assert.match(textOf(lib), /Saved to the Dandelion library/);
    assert.match(textOf(lib), /Nothing went out/);
    assert.equal(t.fake.state.putCount, 2);

    // Review.
    const rev = await kit.call('send_to_dandelion', { bundle_id: bundleId2, brand_id: t.fake.brandId, mode: 'review', channels: ['instagram', 'x'] });
    assert.equal(rev.isError, undefined, textOf(rev));
    const jobs = rev.structuredContent.sent.jobs;
    assert.equal(jobs.length, 2);
    assert.match(textOf(rev), /2 posts waiting/);
    assert.match(textOf(rev), /already in your Dandelion library/);
    assert.equal(t.fake.state.putCount, 2, 'no second upload');

    // Approve one with a time. Dandelion hears an ISO time.
    const when = '2026-12-02T14:00:00-05:00';
    const approved = await kit.call('approve_post', { job_id: jobs[0].id, post_at: when });
    assert.equal(approved.isError, undefined, textOf(approved));
    assert.deepEqual(approved.structuredContent.job, { id: jobs[0].id, status: 'scheduled', post_at: '2026-12-02T19:00:00.000Z' });
    assert.match(textOf(approved), /scheduled for 2026-12-02/);
    assert.equal(t.fake.state.calls.filter((c) => c.tool === 'approve_job').length, 1);

    // Approving it again says why not.
    const twice = await kit.call('approve_post', { job_id: jobs[0].id });
    assert.equal(twice.isError, true);
    assert.match(textOf(twice), /Only posts waiting for review can be approved/);

    // A time nobody can read.
    const badTime = await kit.call('approve_post', { job_id: jobs[1].id, post_at: 'next tuesday' });
    assert.equal(badTime.isError, true);
    assert.match(textOf(badTime), /not a time I can read/);
    assert.equal(t.fake.state.jobs.get(jobs[1].id).status, 'review');

    // Skip.
    const skipped = await kit.call('skip_post', { job_id: jobs[1].id });
    assert.deepEqual(skipped.structuredContent.job, { id: jobs[1].id, status: 'skipped' });
    assert.match(textOf(skipped), /will not go out/);

    // The text twins never show a dash or a token.
    for (const r of [status0, conn, lib, rev, approved, skipped]) assert.ok(!DASH_RE.test(textOf(r)));
    const everything = JSON.stringify([conn, lib, rev, approved, skipped]);
    assert.ok(!/access_token|refresh_token|at_[0-9a-f]{8}|rt_[0-9a-f]{8}/.test(everything), 'no token in any answer');
  } finally {
    await kit.close();
    await t.stop();
  }
});

test('tools: connect_dandelion answers "waiting" with the link when the person is slow, and dandelion_status sees it finish', async () => {
  const t = await useFakeDandelion();
  process.env.DANDELION_KIT_CONNECT_WAIT_MS = '250';
  const kit = await connectKit();
  try {
    /** @type {string[]} */
    const urls = [];
    t.client.setBrowserOpener((url) => {
      urls.push(url);
    });
    const waiting = await kit.call('connect_dandelion');
    assert.equal(waiting.isError, undefined, textOf(waiting));
    assert.equal(waiting.structuredContent.pending, true);
    assert.equal(waiting.structuredContent.dandelion.connected, false);
    assert.equal(waiting.structuredContent.connect_url, urls[0]);
    assert.match(textOf(waiting), /Waiting for you to finish signing in/);
    assert.match(textOf(waiting), /go to: http/);
    const status = await kit.call('dandelion_status');
    assert.equal(status.structuredContent.pending, true);
    assert.equal(status.structuredContent.connect_url, urls[0]);
    await t.fake.approveInBrowser(urls[0]);
    const end = Date.now() + 5000;
    for (;;) {
      const s = await kit.call('dandelion_status');
      if (s.structuredContent.dandelion.connected) {
        assert.equal(s.structuredContent.pending, undefined);
        break;
      }
      if (Date.now() > end) assert.fail('sign-in did not finish');
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await kit.close();
    await t.stop();
  }
});

test('tools: a plan that cannot use the API says so in plain words', async () => {
  const t = await useFakeDandelion({ planBlocked: true });
  process.env.DANDELION_KIT_CONNECT_WAIT_MS = '15000';
  const kit = await connectKit();
  try {
    const r = await kit.call('connect_dandelion');
    assert.equal(r.isError, true);
    assert.match(textOf(r), /cannot use the API yet/);
  } finally {
    await kit.close();
    await t.stop();
  }
});
