import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFfmpeg, runFfmpeg } from '../core/media/ffmpeg.mjs';
import { analyzeVideo } from '../core/style/analyze-video.mjs';
import { suggestStyle } from '../core/style/map.mjs';

let home;
let previous;
beforeEach(async () => {
  previous = process.env.DANDELION_KIT_HOME;
  home = await mkdtemp(join(tmpdir(), 'kit-video-sample-'));
  process.env.DANDELION_KIT_HOME = home;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.DANDELION_KIT_HOME; else process.env.DANDELION_KIT_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

async function cutClip(seconds, count, name) {
  const colors = ['red','blue','white','black','cyan','yellow','purple','white'];
  const args = [];
  for (let i = 0; i < count; i++) args.push('-f','lavfi','-i',`color=c=${colors[i]}:s=160x240:r=20:d=${seconds}`);
  args.push('-f','lavfi','-i',`sine=frequency=440:duration=${seconds * count}`);
  args.push('-filter_complex', `${Array.from({length:count},(_,i)=>`[${i}:v]`).join('')}concat=n=${count}:v=1:a=0[v]`, '-map','[v]','-map',`${count}:a`, '-c:v','libx264','-threads','1','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-shortest');
  const file = join(home,name);
  await runFfmpeg([...args,file]);
  return file;
}

test('video samples measure hard cuts fast and slow, grade and tone loudness without speech', {timeout:180000}, async t => {
  if (!(await detectFfmpeg()).found) return t.skip('ffmpeg is not installed');
  const measured = [];
  for (const [seconds,count,name] of /** @type {[number,number,string][]} */ ([[1.5,8,'fast.mp4'],[4,4,'slow.mp4']])) {
    const file = await cutClip(seconds,count,name);
    const before = await readFile(file);
    const result = await analyzeVideo(file,{outDir:join(home,name+'-frames'),speech:false});
    measured.push(result);
    assert.equal(result.path,file);
    assert.deepEqual([result.width,result.height,result.fps],[160,240,20]);
    assert.ok(Math.abs(result.duration_ms-seconds*count*1000)<150);
    assert.equal(result.cut_times_ms.length,count-1,JSON.stringify(result.cut_times_ms));
    for (let i=0;i<count-1;i++) assert.ok(Math.abs(result.cut_times_ms[i]-(i+1)*seconds*1000)<=150,JSON.stringify(result.cut_times_ms));
    assert.ok(Math.abs(result.shot_ms.median-seconds*1000)<=150);
    assert.ok(result.cuts_per_10s>0);
    assert.ok(Number.isFinite(result.loudness_lufs));
    assert.equal(result.words_per_minute,null);
    assert.equal(result.pause_ms,null);
    assert.equal(result.speech,'unavailable');
    assert.ok(result.speech_note);
    assert.ok(result.grade.saturation>=0 && result.grade.saturation<=1);
    assert.ok(result.grade.contrast>=0 && result.grade.contrast<=1);
    assert.ok(result.grade.warmth>=-1 && result.grade.warmth<=1);
    assert.ok(result.keyframes.length>=6);
    assert.deepEqual(await readFile(file),before);
  }
  const fast = suggestStyle([], [measured[0]]).video;
  const slow = suggestStyle([], [measured[1]]).video;
  assert.equal(fast?.base_look,'bold-value');
  assert.equal(slow?.base_look,'minimal-educator');
  assert.ok((fast?.overrides?.cut_every_ms_min ?? Infinity)<(slow?.overrides?.cut_every_ms_min ?? 0));
});

test('one short single shot has low confidence and never invents cadence', {timeout:90000}, async t => {
  if (!(await detectFfmpeg()).found) return t.skip('ffmpeg is not installed');
  const file = join(home,'single.mp4');
  await runFfmpeg(['-f','lavfi','-i','color=c=blue:s=160x240:r=20:d=3','-c:v','libx264','-threads','1','-preset','ultrafast','-pix_fmt','yuv420p',file]);
  const result = await analyzeVideo(file,{outDir:join(home,'single-frames'),speech:false});
  assert.equal(result.confidence,'low');
  assert.match(result.confidence_note,/few cuts|too short|8 seconds/i);
  assert.deepEqual(result.cut_times_ms,[]);
  assert.equal(result.loudness_lufs,null);
  const style = suggestStyle([], [result]);
  assert.equal(style.video?.base_look,undefined);
  for (const key of ['cut_every_ms_min','cut_every_ms_max','camera_aggression','density_per_10s']) assert.equal(style.video?.overrides?.[key],undefined,key);
  assert.equal(style.video?.rough_cut,undefined);
});
