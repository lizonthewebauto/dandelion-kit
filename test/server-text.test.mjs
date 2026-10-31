import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderText, clock, secs, sizeText, channelName } from '../server/text.mjs';
import {
  CARD_FIXTURES,
  CUT,
  DOCTOR,
  DOCTOR_MISSING,
  EXPORT,
  LOOK_PICKER,
  POST_CONNECTED,
  POST_CONNECTED_NO_CHANNELS,
  POST_DRAFT,
  POST_JOBS,
  POST_LIBRARY_NO_CHANNELS,
  PREVIEW_FINAL,
  PREVIEW_VARIANTS,
  PROJECT,
  PROJECT_FAR,
  PROJECT_WAITING,
  SHOT_PLAN,
  CAROUSEL,
} from '../server/widgets/fixtures.mjs';
import { DASH_RE } from './server-helpers.mjs';

/** The tool that shows each card fixture. */
const TOOL_FOR_WIDGET = /** @type {Record<string, string>} */ ({
  'kit-project': 'get_project',
  'kit-cut-review': 'rough_cut',
  'kit-look-picker': 'pick_look',
  'kit-shot-plan': 'plan_shots',
  'kit-preview': 'render_reel',
  'kit-carousel': 'make_carousel',
  'kit-export': 'export',
  'kit-post': 'offer_post',
});

const BANNED = [/beat\s*sheet/i, /style\s*plan/i, /trial\s*reels/i, /auto\s*pilot/i, /chin\s*lock/i, /stu\s*dio/i, /render\s*lock/i, /reel\s*gate/i];

test('every card fixture has a readable text twin without dashes or banned words', () => {
  for (const fx of CARD_FIXTURES) {
    const tool = fx.file === 'kit-project-doctor' || fx.file === 'kit-project-doctor-missing' ? 'doctor' : TOOL_FOR_WIDGET[fx.widget];
    const text = renderText(tool, fx.data);
    assert.ok(text.length > 40, `${fx.file}: text is too short`);
    assert.ok(!DASH_RE.test(text), `${fx.file}: has a dash`);
    for (const re of BANNED) assert.ok(!re.test(text), `${fx.file}: banned word ${re}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `${fx.file}: leaked a bad value:\n${text}`);
  }
});

test('formatting helpers', () => {
  assert.equal(clock(113000), '1:53');
  assert.equal(clock(0), '0:00');
  assert.equal(secs(380), '0.4 s');
  assert.equal(sizeText(14_800_000), '14.1 MB');
  assert.equal(sizeText(3120), '3 KB');
  assert.equal(channelName('x'), 'X');
});

test('project text lists the steps and the next tool', () => {
  const t = renderText('get_project', PROJECT);
  assert.match(t, /Project "Morning routine talk" \(p_demo\)/);
  assert.match(t, /1:53, 1080 by 1920, 30 fps/);
  assert.match(t, /\[x\] Transcript/);
  assert.match(t, /\[ \] Rough cut/);
  assert.match(t, /Next: rough_cut\./);
  assert.match(renderText('get_project', PROJECT_WAITING), /still being read/);
  const far = renderText('get_project', PROJECT_FAR);
  assert.match(far, /\[x\] Final reel/);
  assert.match(far, /Next: export/);
  assert.match(renderText('open_video', { ...PROJECT, reused: true }), /^Opened again/);
});

test('doctor text gives the install command when ffmpeg is missing', () => {
  assert.match(renderText('doctor', DOCTOR), /The kit is ready/);
  const t = renderText('doctor', DOCTOR_MISSING);
  assert.match(t, /ffmpeg: not found/);
  assert.match(t, /winget install Gyan\.FFmpeg/);
  assert.match(t, /needs a little setup/);
});

test('cut text is a table with every piece and how to keep one', () => {
  const t = renderText('rough_cut', CUT);
  assert.match(t, /Rough cut \(standard\): 1:53 down to 1:43/);
  assert.equal(t.split('\n').filter((l) => /^\| r\d+ /.test(l)).length, CUT.removed.length);
  assert.match(t, /\| r8 \| filler .* kept \|/);
  assert.match(t, /keep_ids/);
});

test('look text names all five looks and marks the current one', () => {
  const t = renderText('pick_look', LOOK_PICKER);
  for (const id of ['karaoke-clean', 'bold-value', 'minimal-educator', 'editorial-luxe', 'storytime-energy']) assert.match(t, new RegExp(id));
  assert.match(t, /karaoke-clean \(Karaoke Clean\) \[current\]/);
});

test('shot plan text numbers the beats and shows hook scores', () => {
  const t = renderText('plan_shots', SHOT_PLAN);
  assert.match(t, /Hook \(auto-made, scored 84 out of 100\)/);
  assert.match(t, /Made from the words in the video\. Write your own with hook_text/);
  assert.doesNotMatch(t, /out of 100, good/);
  const given = renderText('plan_shots', { ...SHOT_PLAN, hook: { ...SHOT_PLAN.hook, source: 'given' } });
  assert.match(given, /Hook \(84 out of 100, good\)/);
  assert.equal(t.split('\n').filter((l) => /^\d+\. \[b\d+\]/.test(l)).length, SHOT_PLAN.beats.length);
  assert.match(t, /wanted stat-card, drawn as face/);
  assert.match(t, /Next: render_reel with quality draft/);
});

test('preview text lists the file path, a checks table and what to fix', () => {
  const t = renderText('render_reel', PREVIEW_FINAL);
  const final = PREVIEW_FINAL.renders[1];
  assert.ok(t.includes(final.file), 'has the exact path');
  assert.match(t, /Checks \(8 pass, 1 warn, 0 stop\)/);
  assert.match(t, /\| check \| result \| measured \| limit \|/);
  assert.match(t, /What to change:/);
  assert.match(t, /Add a punch-in in the first second/);
  assert.match(t, /make_variants/);
  const v = renderText('make_variants', PREVIEW_VARIANTS);
  assert.match(v, /This variant: hook "I skipped my phone for thirty days", opens straight in/);
  assert.match(renderText('render_reel', { ...PREVIEW_FINAL, active: 'draft' }), /next: render_reel with quality final/);
});

test('a stop check tells the person to fix it before posting', () => {
  const data = JSON.parse(JSON.stringify(PREVIEW_FINAL));
  data.renders[1].checks[0] = { id: 'encode', status: 'stop', label: 'File format', measured: 'vp9', limit: 'h264', fix: 'Build it again.' };
  assert.match(renderText('render_reel', data), /Fix those before posting/);
});

test('carousel text lists each slide file', () => {
  const t = renderText('make_carousel', CAROUSEL);
  for (const s of CAROUSEL.slides) assert.ok(t.includes(s.file));
  assert.match(t, /6 JPEG slides, 1080 by 1350/);
  assert.match(t, /offer_post/);
  assert.match(renderText('make_image', { ...CAROUSEL, slides: [CAROUSEL.slides[0]] }), /^Image: 1 JPEG slide/);
});

test('export text lists files with sizes and the folder', () => {
  const t = renderText('export', EXPORT);
  assert.ok(t.includes(EXPORT.dir));
  for (const f of EXPORT.files) assert.ok(t.includes(f.path));
  assert.match(t, /14\.1 MB/);
});

test('post text shows all eight apps with counts, warnings and the sign-in state', () => {
  const t = renderText('offer_post', POST_DRAFT);
  for (const name of ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'X', 'Threads', 'Facebook', 'Pinterest']) assert.match(t, new RegExp(`${name} \\(`));
  assert.match(t, /X \(Post with video\): caption \d+ of 280/);
  assert.match(t, /! The caption is 3 characters too long for X \(283 of 280 with hashtags\)/);
  assert.match(t, /X \(Post with video\): caption 283 of 280 with hashtags/);
  assert.match(t, /Title: The 30 day morning routine/);
  assert.match(t, /Dandelion is not signed in/);
  assert.match(t, /connect_dandelion/);
  assert.match(t, /Never post without a clear yes/);
});

test('post text for the connected states', () => {
  const none = renderText('dandelion_status', POST_CONNECTED_NO_CHANNELS);
  assert.match(none, /signed in as Liz Owner, Owner plan/);
  assert.match(none, /No social app is connected/);
  assert.match(none, /Instagram: https:\/\/dandelionapp\.io\/app\/connect\/instagram/);
  const some = renderText('dandelion_status', POST_CONNECTED);
  assert.match(some, /Instagram @morningmethod\n/);
  assert.match(some, /YouTube @morningmethod \(cannot post yet/);
  const jobs = renderText('offer_post', POST_JOBS);
  assert.match(jobs, /3 posts waiting. Nothing has gone out yet/);
  assert.match(jobs, /fix first: The caption is under the recommended length/);
  assert.match(jobs, /YouTube @morningmethod \[j3\]: scheduled for 2026-12-02/);
  assert.match(renderText('send_to_dandelion', { sent: POST_LIBRARY_NO_CHANNELS.bundle.sent }), /Nothing went out/);
});

test('job and copy results', () => {
  assert.match(renderText('approve_post', { job: { id: 'j1', status: 'scheduled', post_at: '2026-12-02T14:00:00.000Z' } }), /scheduled for 2026-12-02/);
  assert.match(renderText('approve_post', { job: { id: 'j1', status: 'posting' } }), /going out now/);
  assert.match(renderText('skip_post', { job: { id: 'j1', status: 'skipped' } }), /will not go out/);
  const saved = renderText('set_channel_copy', { channel: 'x', copy: { caption: 'Hi' }, warnings: ['Too long.'] });
  assert.match(saved, /Saved the X version\./);
  assert.match(saved, /! Too long\./);
});

test('projects list text', () => {
  assert.match(renderText('list_projects', { projects: [] }), /No projects yet/);
  const t = renderText('list_projects', {
    projects: [
      { id: 'p_aaaa1111', type: 'video', title: 'Clip', duration_ms: 61000, transcript_ready: true, has_final: false },
      { id: 'p_bbbb2222', type: 'carousel', title: 'Slides', slides: 6 },
    ],
  });
  assert.match(t, /2 projects, newest first/);
  assert.match(t, /\| p_bbbb2222 \| carousel \| Slides \| 6 slides \| rendered \|/);
});

test('unknown tool or empty data does not throw', () => {
  assert.equal(renderText('nope', {}), 'Done.');
  assert.ok(renderText('get_project', /** @type {any} */ (undefined)).length > 0);
});

test('the counted length puts hashtags in the body on X and counts a link as 23', async () => {
  const { countedLength, checkCopy } = await import('../server/lib/offer.mjs');
  assert.deepEqual(countedLength('x', { caption: 'hello', hashtags: ['#a'] }), { total: 5 + 1 + 2, with_hashtags: true });
  assert.deepEqual(countedLength('pinterest', { caption: 'hello', hashtags: ['#a'] }), { total: 5, with_hashtags: false });
  assert.equal(countedLength('x', { caption: 'see https://example.com/a/very/long/path/indeed' }).total, 'see '.length + 23);
  const rule = /** @type {any} */ ({ name: 'X', formats: [], limits: { caption_max: 10 } });
  const warn = checkCopy(rule, { caption: 'twelve char', hashtags: ['#ab'] }, { platform: 'x' });
  assert.match(warn[0], /\(\d+ of 10 with hashtags\)/);
});
