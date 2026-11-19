import assert from 'node:assert/strict';
import test from 'node:test';
import {cameraSeekStart} from './video-frame-seek.mjs';
import {rangeFilter} from './video-frame-ranges.mjs';
const ranges=[{start:840,end:855,offset:0}];
const probe={format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',start_time:'0'},streams:[{codec_type:'video',codec_name:'h264',start_time:'0'}]};
test('verified source seeks before first interval and selects absolute pts',()=>{
 assert.equal(cameraSeekStart(ranges,30,probe),26);
 assert.match(rangeFilter('30',ranges,true),/between\(pts,840,855\)/);
 assert.match(rangeFilter('30',ranges),/between\(n,840,855\)/);
 assert.equal(cameraSeekStart(ranges,30,{...probe,format:{...probe.format,start_time:'5'},streams:[{...probe.streams[0],start_time:'5'}]}),26);
});
test('unknown timing, shifted video, unsupported codec/container or multiple videos retain decoding from zero',()=>{
 for(const p of [null,{...probe,streams:[]},{...probe,streams:[...probe.streams,...probe.streams]},
 {...probe,streams:[{...probe.streams[0],codec_name:'hevc'}]},
 {...probe,streams:[{...probe.streams[0],start_time:'0.1'}]},
 {...probe,format:{...probe.format,start_time:'N/A'}},
 {...probe,format:{...probe.format,start_time:null}},
 {...probe,format:{...probe.format,format_name:'matroska,webm'}}])assert.equal(cameraSeekStart(ranges,30,p),0);
 assert.equal(cameraSeekStart([{start:120}],30,probe),0);
 assert.equal(cameraSeekStart(null,30,probe),0);
});
