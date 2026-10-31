import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { APP_ONLY_TOOLS, CHANNEL_IDS, TOOL_NAMES, WIDGET_IDS } from '../core/types.mjs';
import { makeTempDir } from '../core/util/fs.mjs';
import { connectKit, textOf, DASH_RE } from './server-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let home;
let previousHome;
/** @type {Awaited<ReturnType<typeof connectKit>>} */
let kit;

before(async () => {
  previousHome = process.env.DANDELION_KIT_HOME;
  home = makeTempDir('kit-server-test-');
  process.env.DANDELION_KIT_HOME = home;
  kit = await connectKit();
});
after(async () => {
  await kit.close();
  if (previousHome === undefined) delete process.env.DANDELION_KIT_HOME;
  else process.env.DANDELION_KIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const SIX = [
  { layout: 'cover', fields: { kicker: 'Morning routine', title: 'Win the first hour', subtitle: 'Three small moves that changed my focus.' } },
  { layout: 'list', fields: { title: 'What I stopped doing', items: ['Phone in bed', 'Coffee first', 'Planning in my head'] } },
  { layout: 'steps', fields: { title: 'The routine', steps: [{ n: 1, text: 'No phone for an hour' }, { n: 2, text: 'Water before coffee' }, { n: 3, text: 'Write the one thing' }] } },
  { layout: 'stat', fields: { number: '40%', label: 'more focus', note: 'Self-tracked over 30 days' } },
  { layout: 'quote', fields: { quote: 'Protect the first hour and the day takes care of itself.', who: 'Morning Method' } },
  { layout: 'cta', fields: { title: 'Try it for a week', line: 'Save this and tell me how day three goes.', handle: '@morningmethod' } },
];

test('lists exactly the 25 tools in order and the 8 card resources', async () => {
  const { tools } = await kit.client.listTools();
  assert.deepEqual(tools.map((t) => t.name), [...TOOL_NAMES]);
  const { resources } = await kit.client.listResources();
  assert.equal(resources.length, 8);
  assert.deepEqual(resources.map((r) => r.uri).sort(), WIDGET_IDS.map((id) => `ui://dandelion-kit/v1/${id}.html`).sort());
  const read = await kit.client.readResource({ uri: 'ui://dandelion-kit/v1/kit-post.html' });
  assert.match(String(/** @type {any} */ (read.contents[0]).text), /<html/i);
});

test('app-only tools are hidden from the model, card tools point at their card, annotations are honest', async () => {
  const { tools } = await kit.client.listTools();
  const byName = /** @type {Record<string, any>} */ (Object.fromEntries(tools.map((t) => [t.name, t])));
  for (const name of TOOL_NAMES) {
    const meta = /** @type {any} */ (byName[name]._meta ?? {});
    if (APP_ONLY_TOOLS.includes(name)) assert.deepEqual(meta.ui?.visibility, ['app'], `${name} is app only`);
    else assert.ok(!meta.ui?.visibility, `${name} is visible to the model`);
    assert.ok(byName[name].description.length > 30, `${name} has a description`);
    assert.ok(byName[name].annotations, `${name} has annotations`);
  }
  assert.equal(byName.rough_cut._meta.ui.resourceUri, 'ui://dandelion-kit/v1/kit-cut-review.html');
  assert.equal(byName.offer_post._meta.ui.resourceUri, 'ui://dandelion-kit/v1/kit-post.html');
  assert.equal(byName.approve_post.annotations.destructiveHint, true);
  assert.equal(byName.approve_post.annotations.openWorldHint, true);
  assert.equal(byName.doctor.annotations.readOnlyHint, true);
  assert.equal(byName.read_asset.annotations.readOnlyHint, true);
  assert.ok(byName.make_carousel.description.includes('cover: kicker'), 'carousel description lists the layout fields');
  for (const t of tools) assert.ok(!DASH_RE.test(JSON.stringify(t)), `${t.name} has a dash`);
});

test('input schemas: required fields, enums and ranges are enforced', async () => {
  const { tools } = await kit.client.listTools();
  const schema = (/** @type {string} */ n) => /** @type {any} */ (tools.find((t) => t.name === n)).inputSchema;
  assert.deepEqual(schema('rough_cut').required, ['project_id']);
  assert.deepEqual(schema('rough_cut').properties.preset.enum, ['gentle', 'standard', 'punchy']);
  assert.equal(schema('make_variants').properties.count.minimum, 2);
  assert.equal(schema('make_variants').properties.count.maximum, 4);
  assert.deepEqual(schema('render_reel').properties.quality.enum, ['draft', 'final']);
  assert.equal(schema('read_asset').properties.bytes.maximum, 200000);
  assert.deepEqual(schema('offer_post').properties.kind.enum, ['text', 'image', 'carousel', 'video', 'thread']);
  assert.deepEqual(schema('send_to_dandelion').properties.mode.enum, ['library', 'review']);
  assert.ok(schema('approve_post').required.includes('job_id'));
  assert.deepEqual(schema('doctor').properties ?? {}, {});

  for (const [name, args] of /** @type {[string, any][]} */ ([
    ['rough_cut', {}],
    ['rough_cut', { project_id: 'p_aaaa1111', preset: 'extreme' }],
    ['make_variants', { project_id: 'p_aaaa1111', count: 9 }],
    ['read_asset', { asset_id: 'a_x', bytes: 999999 }],
    ['approve_post', {}],
    ['offer_post', { kind: 'poem' }],
  ])) {
    const r = await kit.call(name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} should be refused`);
    assert.ok(textOf(r).length > 10);
  }
});

test('doctor returns a structured status, and a missing ffmpeg is a status not an error', async () => {
  const r = await kit.call('doctor');
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.mode, 'status');
  const d = r.structuredContent.doctor;
  assert.equal(typeof d.ffmpeg.found, 'boolean');
  assert.equal(d.node.ok, true);
  assert.equal(d.home, home);
  assert.ok(Array.isArray(d.next_steps));
  assert.match(textOf(r), /ffmpeg:/);

  const { resetFfmpegCache } = await import('../core/media/ffmpeg.mjs');
  const saved = { PATH: process.env.PATH, FFMPEG_PATH: process.env.FFMPEG_PATH };
  process.env.PATH = '';
  process.env.FFMPEG_PATH = join(home, 'nowhere', 'ffmpeg.exe');
  try {
    const missing = await kit.call('doctor');
    assert.equal(missing.isError, undefined);
    const m = missing.structuredContent.doctor;
    assert.equal(m.ffmpeg.found, false);
    assert.equal(m.ok, false);
    assert.match(m.ffmpeg.install_hint, /winget install Gyan\.FFmpeg|brew install ffmpeg|apt install ffmpeg/);
    assert.match(textOf(missing), /not found on this computer/);
    assert.ok(m.next_steps.some((s) => /Carousels and images work now/.test(s)));
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.FFMPEG_PATH === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved.FFMPEG_PATH;
    resetFfmpegCache();
  }
});

test('errors are plain words, never stack traces', async () => {
  const missing = await kit.call('open_video', { path: join(home, 'no-such-video.mp4') });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /could not find a video at/);
  assert.ok(!/\n\s+at /.test(textOf(missing)));
  const noProject = await kit.call('rough_cut', { project_id: 'p_deadbeef01' });
  assert.equal(noProject.isError, true);
  assert.match(textOf(noProject), /could not find project p_deadbeef01/);
  const badId = await kit.call('get_project', { project_id: '../../etc' });
  assert.equal(badId.isError, true);
  assert.match(textOf(badId), /is not a project id/);
});

test('the Dandelion tools have real schemas and say they are not built yet', async () => {
  for (const [name, args] of /** @type {[string, any][]} */ ([
    ['connect_dandelion', {}],
    ['dandelion_status', {}],
    ['send_to_dandelion', { bundle_id: 'b_aaaa1111', brand_id: 'brand-1', mode: 'review', channels: ['instagram'] }],
    ['approve_post', { job_id: 'j1', post_at: '2026-12-02T14:00:00.000Z' }],
    ['skip_post', { job_id: 'j1' }],
  ])) {
    const r = await kit.call(name, args);
    assert.equal(r.isError, true, name);
    assert.equal(r.structuredContent.error, 'not_built');
    assert.match(textOf(r), /not built into this version of the kit yet/);
    assert.ok(!DASH_RE.test(textOf(r)));
  }
});

test('make_carousel renders six JPEG slides with thumbnails and readable text', async () => {
  const r = await kit.call('make_carousel', { title: 'Win the first hour', slides: SIX });
  assert.equal(r.isError, undefined, textOf(r));
  const d = r.structuredContent;
  assert.equal(d.slides.length, 6);
  assert.equal(d.width, 1080);
  assert.equal(d.height, 1350);
  for (const s of d.slides) {
    assert.ok(existsSync(s.file), s.file);
    assert.deepEqual([...readFileSync(s.file).subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG magic bytes');
    const meta = await sharp(s.file).metadata();
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);
    assert.ok(s.asset_id && s.thumb_asset_id);
    assert.ok(textOf(r).includes(s.file));
  }
  assert.ok(JSON.stringify(d).length < 50000);
  assert.match(textOf(r), /offer_post/);
});

test('read_asset hands back a registered file in chunks that rebuild the original, and nothing else', async () => {
  const made = await kit.call('make_image', { layout: 'cover', fields: { title: 'Chunk test' }, size: 'square' });
  assert.equal(made.isError, undefined, textOf(made));
  const slide = made.structuredContent.slides[0];
  assert.equal(made.structuredContent.width, 1080);
  assert.equal(made.structuredContent.height, 1080);
  const original = readFileSync(slide.file);
  const parts = [];
  let offset = 0;
  for (;;) {
    const r = await kit.call('read_asset', { asset_id: slide.asset_id, offset, bytes: 50000 });
    assert.equal(r.isError, undefined, textOf(r));
    const chunk = r.structuredContent;
    assert.equal(chunk.mime, 'image/jpeg');
    assert.equal(chunk.total, original.length);
    const buf = Buffer.from(chunk.data, 'base64');
    assert.ok(buf.length <= 50000);
    parts.push(buf);
    offset += buf.length;
    if (!chunk.has_more) break;
  }
  assert.ok(Buffer.concat(parts).equals(original));
  assert.ok(!textOf(await kit.call('read_asset', { asset_id: slide.asset_id, offset: 0 })).includes(original.toString('base64').slice(0, 40)), 'text carries no base64');
  for (const bad of ['C:/Windows/win.ini', '../../etc/passwd', 'a_nothing']) {
    const r = await kit.call('read_asset', { asset_id: bad, offset: 0 });
    assert.equal(r.isError, true, bad);
    assert.match(textOf(r), /no file with id/);
  }
});

test('over-budget text is refused naming the field and limit; allow_overflow shrinks instead', async () => {
  const long = { layout: 'cover', fields: { title: 'x'.repeat(61) } };
  const refused = await kit.call('make_carousel', { title: 'Too long', slides: [long] });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /title/);
  assert.match(textOf(refused), /60/);
  assert.ok(!/\n\s+at /.test(textOf(refused)));
  const allowed = await kit.call('make_carousel', { title: 'Too long', slides: [long], allow_overflow: true });
  assert.equal(allowed.isError, undefined, textOf(allowed));
  const bad = await kit.call('make_image', { layout: 'cover', fields: { title: 'Hi' }, brand: { colors: { bg: 'nope' } } });
  assert.equal(bad.isError, true);
  assert.ok(textOf(bad).length > 10);
  // Failed renders leave no project behind.
  const list = await kit.call('list_projects');
  assert.ok(!list.structuredContent.projects.some((p) => p.title === 'Too long' && p.slides === undefined && p.type === 'carousel' && !p.updated_at));
});

test('update_slides re-renders, changes asset ids and removes the old files', async () => {
  const first = await kit.call('make_carousel', { title: 'Edit me', slides: SIX });
  const pid = first.structuredContent.project_id;
  const oldFile = first.structuredContent.slides[1].file;
  const oldAsset = first.structuredContent.slides[1].asset_id;
  const slides = SIX.slice(0, 5).map((s, i) => (i === 1 ? { ...s, fields: { ...s.fields, title: 'What I dropped' } } : s));
  const next = await kit.call('update_slides', { project_id: pid, slides });
  assert.equal(next.isError, undefined, textOf(next));
  assert.equal(next.structuredContent.slides.length, 5);
  assert.equal(next.structuredContent.slides[1].fields.title, 'What I dropped');
  assert.notEqual(next.structuredContent.slides[1].asset_id, oldAsset);
  assert.ok(!existsSync(oldFile), 'the earlier render is cleaned up');
  assert.ok(existsSync(next.structuredContent.slides[4].file));
  const gone = await kit.call('read_asset', { asset_id: oldAsset, offset: 0 });
  assert.equal(gone.isError, true);
  const notCarousel = await kit.call('update_slides', { project_id: 'p_deadbeef01', slides });
  assert.equal(notCarousel.isError, true);
});

test('export copies a carousel to a folder with a summary and a source map', async () => {
  const made = await kit.call('make_carousel', { title: 'Export me: day 3!', slides: SIX.slice(0, 3) });
  const out = join(home, 'out-folder');
  const r = await kit.call('export', { project_id: made.structuredContent.project_id, to_dir: out });
  assert.equal(r.isError, undefined, textOf(r));
  const d = r.structuredContent;
  assert.equal(d.dir, out);
  assert.equal(d.files.filter((f) => f.kind === 'image').length, 3);
  for (const f of d.files) assert.ok(existsSync(f.path), f.path);
  const summary = readFileSync(d.summary_path, 'utf8');
  assert.match(summary, /slide-01\.jpg/);
  assert.ok(!DASH_RE.test(summary));
  const map = JSON.parse(readFileSync(d.source_map_path, 'utf8'));
  assert.equal(map.outputs.length, 3);
  const noFinal = await kit.call('export', { project_id: 'p_deadbeef01' });
  assert.equal(noFinal.isError, true);
});

test('offer_post: a plain caption gets eight drafts with limits before any sign-in', async () => {
  const text = 'I stopped checking my phone in the first hour. Thirty days later my focus was up. #morningroutine #focus';
  const r = await kit.call('offer_post', { kind: 'text', text });
  assert.equal(r.isError, undefined, textOf(r));
  const { bundle, dandelion } = r.structuredContent;
  assert.deepEqual(Object.keys(bundle.channels), [...CHANNEL_IDS]);
  assert.equal(dandelion.connected, false);
  assert.equal(bundle.rules_source, 'snapshot');
  assert.deepEqual(bundle.files, []);
  assert.equal(bundle.channels.instagram.copy.caption, 'I stopped checking my phone in the first hour. Thirty days later my focus was up.');
  assert.deepEqual(bundle.channels.instagram.copy.hashtags, ['#morningroutine', '#focus']);
  assert.equal(bundle.channels.x.limits.caption_max, 280);
  assert.equal(bundle.channels.youtube.copy.title, 'I stopped checking my phone in the first hour.');
  assert.ok(bundle.channels.youtube.warnings.some((w) => /does not take a text post/.test(w)), 'YouTube needs a video');
  assert.ok(JSON.stringify(r.structuredContent).length < 50000);
  const t = textOf(r);
  for (const name of ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'X', 'Threads', 'Facebook', 'Pinterest']) assert.ok(t.includes(name), name);
  assert.match(t, /Dandelion is not signed in/);
});

test('offer_post flags over-limit words and never cuts them, honors copies and channels', async () => {
  const long = 'Word '.repeat(70).trim();
  const r = await kit.call('offer_post', { kind: 'text', text: long });
  const x = r.structuredContent.bundle.channels.x;
  assert.equal(x.copy.caption, long, 'the words are not cut');
  assert.ok(x.warnings.some((w) => /too long for X/.test(w)), x.warnings.join('|'));
  const own = await kit.call('offer_post', {
    kind: 'text',
    text: long,
    channels: ['instagram', 'x'],
    copies: { x: { caption: 'Short and sweet' } },
  });
  const b = own.structuredContent.bundle;
  assert.deepEqual(Object.keys(b.channels), ['instagram', 'x']);
  assert.equal(b.channels.x.copy.caption, 'Short and sweet');
  assert.deepEqual(b.channels.x.warnings, []);
  const tags = await kit.call('offer_post', { kind: 'text', text: 'Hello. #a #b #c #d #e #f' });
  assert.ok(tags.structuredContent.bundle.channels.threads.warnings.some((w) => /at most 1 hashtags/.test(w)));
  assert.ok(tags.structuredContent.bundle.channels.pinterest.warnings.some((w) => /does not use hashtags/.test(w)));
});

test('offer_post refuses missing words, missing files and the wrong file type', async () => {
  const noWords = await kit.call('offer_post', { kind: 'text' });
  assert.equal(noWords.isError, true);
  assert.match(textOf(noWords), /Give me the words/);
  const noFiles = await kit.call('offer_post', { kind: 'video', text: 'Hi' });
  assert.equal(noFiles.isError, true);
  assert.match(textOf(noFiles), /needs files/);
  const missing = await kit.call('offer_post', { kind: 'image', text: 'Hi', files: [join(home, 'nope.jpg')] });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /could not find this file/);
  const wrong = await kit.call('offer_post', { kind: 'video', text: 'Hi', files: [join(ROOT, 'assets', 'platform-rules.snapshot.json')] });
  assert.equal(wrong.isError, true);
  assert.match(textOf(wrong), /needs a video/);
});

test('offer_post for a carousel project uses its slides and gives the card thumbnails to read', async () => {
  const made = await kit.call('make_carousel', { title: 'Offer me', slides: SIX.slice(0, 4) });
  const pid = made.structuredContent.project_id;
  const r = await kit.call('offer_post', { kind: 'carousel', project_id: pid, text: 'Four quick slides on mornings. #habits' });
  assert.equal(r.isError, undefined, textOf(r));
  const { bundle } = r.structuredContent;
  assert.equal(bundle.files.length, 4);
  assert.equal(bundle.preview_asset_ids.length, 4);
  assert.equal(bundle.channels.instagram.format, 'Feed post');
  const thumb = await kit.call('read_asset', { asset_id: bundle.preview_asset_ids[0], offset: 0 });
  assert.equal(thumb.structuredContent.mime, 'image/jpeg');
  assert.match(Buffer.from(thumb.structuredContent.data, 'base64').subarray(0, 3).toString('hex'), /^ffd8ff/);
  // Files given by path (no project) also get thumbnails.
  const loose = await kit.call('offer_post', { kind: 'image', files: [bundle.files[0]], text: 'One slide.' });
  assert.equal(loose.structuredContent.bundle.preview_asset_ids.length, 1);
  // The hidden preview project does not show in the project list.
  const list = await kit.call('list_projects');
  assert.ok(!list.structuredContent.projects.some((p) => p.title === 'Post preview'));
});

test('set_channel_copy saves the words and re-checks the limits', async () => {
  const offer = await kit.call('offer_post', { kind: 'text', text: 'Short post.' });
  const id = offer.structuredContent.bundle.id;
  const ok1 = await kit.call('set_channel_copy', { bundle_id: id, channel: 'x', copy: { caption: 'A new X version.', hashtags: ['#one'] } });
  assert.equal(ok1.isError, undefined, textOf(ok1));
  assert.deepEqual(ok1.structuredContent.warnings, []);
  const over = await kit.call('set_channel_copy', { bundle_id: id, channel: 'x', copy: { caption: 'y'.repeat(300) } });
  assert.equal(over.isError, undefined);
  assert.match(over.structuredContent.warnings[0], /20 characters too long for X/);
  const again = await kit.call('offer_post', { kind: 'text', text: 'Short post.', channels: ['x'] });
  assert.notEqual(again.structuredContent.bundle.id, id);
  const nope = await kit.call('set_channel_copy', { bundle_id: 'b_deadbeef', channel: 'x', copy: {} });
  assert.equal(nope.isError, true);
  assert.match(textOf(nope), /could not find the post/);
  const noChannel = await kit.call('set_channel_copy', { bundle_id: again.structuredContent.bundle.id, channel: 'tiktok', copy: {} });
  assert.equal(noChannel.isError, true);
  assert.match(textOf(noChannel), /no version for tiktok/);
  const badId = await kit.call('set_channel_copy', { bundle_id: '../x', channel: 'x', copy: {} });
  assert.equal(badId.isError, true);
});

test('list_projects and get_project describe a carousel project', async () => {
  const list = await kit.call('list_projects');
  const car = list.structuredContent.projects.find((p) => p.title === 'Offer me');
  assert.ok(car);
  assert.equal(car.type, 'carousel');
  assert.equal(car.slides, 4);
  assert.match(textOf(list), /Offer me/);
});

test('open_path only shows locations and refuses missing ones', async () => {
  const r = await kit.call('open_path', { path: join(home, 'does-not-exist') });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /could not find/);
});
