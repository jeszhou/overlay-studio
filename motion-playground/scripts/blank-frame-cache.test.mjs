import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blankFrameCandidate, createBlankFrameCapture, isTransparentPng } from './blank-frame-cache.mjs';
function png(alpha=0,filter=0,type=6) {
 const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);return b;};
 const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=type;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([filter,0,0,0,alpha,0,0,0,0,filter,0,0,0,0,0,0,0,0]))),chunk('IEND',Buffer.alloc(0))]);
}
test('accept transparent RGBA filters; reject visible, unsupported, malformed PNG',()=>{
 for(let f=0;f<=4;f++){assert.equal(isTransparentPng(png(0,f)),true);assert.equal(isTransparentPng(png(1,f)),false);}
 assert.equal(isTransparentPng(png(0,5)),false);assert.equal(isTransparentPng(png(0,0,2)),false);
 assert.equal(isTransparentPng(Buffer.from('broken')),false);assert.equal(isTransparentPng(png().subarray(0,40)),false);
});
test('candidate preserves pre-mount window and refuses unknown or stateful scenes',()=>{
 const doc={cards:[{kind:'caption-track',start:1,end:2,params:{}}]};
 const c=blankFrameCandidate({mode:'timeline',doc});
 assert.equal(c(.94),true);assert.equal(c(.95),false);assert.equal(c(1.99),false);assert.equal(c(2),true);
 for(const card of [{...doc.cards[0],kind:'stat-proof'},{...doc.cards[0],seg:'s'},{...doc.cards[0],params:{dimAt:1}},{...doc.cards[0],start:NaN}]) assert.equal(blankFrameCandidate({mode:'timeline',doc:{cards:[card]}})(0),false);
 assert.equal(blankFrameCandidate({mode:'single',doc})(0),false);
});
test('cache resets across active/unconfirmed frames and writes independent sequence files',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'blank-cache-'));
 let confirmed=true,visible=false;const stats={captured:0,reused:0};
 const page={evaluate:async()=>confirmed,screenshot:async()=>png(visible?255:0)};
 const capture=createBlankFrameCapture({page,candidate:t=>t!==2,stats});
 try {
  await capture(undefined,0);await capture(`${dir}/frame.png`,1);assert.equal(stats.reused,1);assert.deepEqual(await readFile(`${dir}/frame.png`),png());
  await capture(undefined,2);await capture(undefined,3);assert.equal(stats.captured,3);
  confirmed=false;await capture(undefined,4);confirmed=true;visible=true;await capture(undefined,5);await capture(undefined,6);assert.equal(stats.captured,6);
 }finally{await rm(dir,{recursive:true,force:true});}
});
