import assert from "node:assert/strict";
import test from "node:test";
import { cameraFrameRanges, rangeCacheSuffix } from "./video-frame-ranges.mjs";
test("late sparse camera keeps mount padding and merges overlaps", () => {
  const ranges = cameraFrameRanges([[10,11],[10.5,12],[20,21]],30,22,60);
  assert.deepEqual(ranges,[{start:298,end:362,offset:0},{start:598,end:632,offset:65}]);
  assert.notEqual(rangeCacheSuffix(ranges), rangeCacheSuffix(cameraFrameRanges([[12,13]],30,22,60)));
});
test("EOF, dense, and absent demand keep the original extraction", () => {
  assert.equal(cameraFrameRanges([[10,11]],30,12,12),null);
  assert.equal(cameraFrameRanges([[0,11]],30,12,60),null);
  assert.equal(cameraFrameRanges(undefined,30,12,60),null);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareVideoFrameCache, cleanupVideoFrameCache, findVideoFrameCache } from "./video-frame-cache.mjs";
test("valid compact caches survive cleanup but never masquerade as full coverage", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"range-cache-"));
  try {
    const ranges=cameraFrameRanges([[10,11]],30,12,60), prefix="camera-";
    const dir=path.join(root,prefix+rangeCacheSuffix(ranges));fs.mkdirSync(dir);
    const count=ranges.reduce((n,r)=>n+r.end-r.start+1,0);
    fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({count,fps:30,dur:60,extractedSec:12,ranges}));
    for(const n of [1,count])fs.writeFileSync(path.join(dir,`f_${String(n).padStart(5,"0")}.jpg`),"frame");
    assert.equal(prepareVideoFrameCache(dir,{fps:30,durationSec:11.5}),count);
    assert.equal(findVideoFrameCache(root,prefix,{fps:30,durationSec:11.5}),null);
    assert.equal(cleanupVideoFrameCache(root),0);
    fs.rmSync(path.join(dir,`f_${String(count).padStart(5,"0")}.jpg`));
    assert.equal(prepareVideoFrameCache(dir,{fps:30,durationSec:11.5}),0);
    assert.equal(fs.existsSync(path.join(dir,'manifest.json')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
