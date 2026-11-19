import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {collectSfxPoints,prepareSfxMix,recordBakedSfx} from './export-sfx.mjs';
import {videoAudioInputArgs,videoOutputArgs} from './export-codecs.mjs';
test('sound choices retain default/custom/none/missing behavior and timeline order',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfx-points-'));
 try {
  for(const name of ['pop-light','chime','custom'])fs.writeFileSync(path.join(dir,`${name}.mp3`),'test');
  const cards=[{kind:'chapter-bar',start:2},{kind:'caption-track',start:0},{kind:'unknown',start:1},
   {kind:'chapter-bar',start:0,params:{sfx:'none'}},{kind:'caption-track',start:0.5,params:{sfx:'custom'}},
   {kind:'chapter-bar',start:3,params:{sfx:'missing'}}];
  assert.deepEqual(collectSfxPoints(cards,dir).map(p=>[p.t,p.sfx]),[[0.5,'custom'],[1,'pop-light'],[2,'chime']]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('no sound needs no encoder or empty audio track',async()=>{
 assert.equal(await prepareSfxMix([],3,'/not-created','/not-created'),null);
 assert.deepEqual(videoAudioInputArgs('mov'),[]);
 assert.deepEqual(videoAudioInputArgs('webm','mix.m4a'),[]);
 assert.ok(!videoOutputArgs('mov','out.mov').includes('pcm_s16le'));
 assert.ok(videoOutputArgs('mov','out.mov','mix.m4a').includes('pcm_s16le'));
 assert.deepEqual(videoOutputArgs('webm','out.webm','mix.m4a'),videoOutputArgs('webm','out.webm'));
});
test('sound sheet describes only a retained MOV and is idempotent',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfx-sheet-'));
 try {
  const prepared={points:[{t:1,kind:'caption-track',sfx:'custom'}]};
  const result={};recordBakedSfx(result,prepared,dir,'test','1');assert.equal(fs.readdirSync(dir).length,0);
  result.mov='completed.mov';recordBakedSfx(result,prepared,dir,'test','1');assert.equal(result.sfxBaked,1);
  const before=fs.statSync(result.sfxSheet).mtimeMs;recordBakedSfx(result,prepared,dir,'test','1');assert.equal(fs.statSync(result.sfxSheet).mtimeMs,before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a real mix also ships the standalone audio track, and the sheet never names a missing file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfx-track-'));
 try {
  const mixFile=path.join(dir,'sfx-mix.m4a');fs.writeFileSync(mixFile,'mix');
  const points=[{t:1,kind:'caption-track',sfx:'custom'}];
  // 单独那份 .m4a 是剪映里唯一能调音效音量的办法(MOV 里的 pcm「sowt」不给音量条)
  const ok={mov:'completed.mov'};recordBakedSfx(ok,{points,mixFile},dir,'test','1');
  assert.equal(ok.sfxAudio,path.join(dir,'test-1-音效轨.m4a'));
  assert.equal(fs.readFileSync(ok.sfxAudio,'utf8'),'mix');
  assert.match(fs.readFileSync(ok.sfxSheet,'utf8'),/音效有两份/);
  // 复制失败(盘满/没权限)时清单不能点名一个不存在的文件 —— MOV 里的音效其实是好的
  const gone={mov:'completed.mov'};
  recordBakedSfx(gone,{points,mixFile:path.join(dir,'not-there.m4a')},dir,'test','2');
  assert.equal(gone.sfxAudio,undefined);
  const sheet=fs.readFileSync(gone.sfxSheet,'utf8');
  assert.doesNotMatch(sheet,/音效有两份/);
  assert.match(sheet,/没能生成/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('explicit free subtitle sounds follow cue bounds and leave the default track silent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-caption-sfx-'));
  try {
    fs.writeFileSync(path.join(dir, 'pop.mp3'), 'test');
    const card = {kind: 'caption-track', start: 1, end: 4, params: {
      lines: '0|2|第一句\n2|5|第二句\n5|6|画外', sfxOffset: 0.25, captionVolume: 0.3,
    }};
    assert.deepEqual(collectSfxPoints([card], dir), []);
    card.params.captionSound = 'caption-pop';
    const hits = collectSfxPoints([card], dir);
    assert.deepEqual(hits.map(({t, duration, volume}) => [t, duration, volume]), [[1.25, 0.75, 0.3], [2.25, 1.75, 0.3]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
