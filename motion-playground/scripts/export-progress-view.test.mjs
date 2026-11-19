import assert from 'node:assert/strict';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
const { exportProgressView } = await tsImport('../src/exportProgress.ts', import.meta.url);

test('render ETA describes only the remaining render stage', () => {
  const view = exportProgressView({ stage: 'frames', frame: 30, total: 120, startedAt: 1000, framesAt: 2000 }, 12000);
  assert.equal(view.pct, 25);
  assert.equal(view.label, '本阶段 25%');
  assert.equal(view.text, '渲染帧 30/120 · 本阶段预计还需 30 秒');
});

test('MOV progress follows processed media time, not a fixed global percentage', () => {
  const state = { stage: 'mov', frame: 120, total: 120, startedAt: 1000, framesAt: 2000, durationSec: 4 };
  assert.equal(exportProgressView({ ...state, outTimeSec: 1 }).pct, 25);
  assert.equal(exportProgressView({ ...state, outTimeSec: 3 }).pct, 75);
  assert.equal(exportProgressView({ ...state, outTimeSec: 4.03 }).pct, 100);
});

test('unknown duration has no fabricated completion percentage', () => {
  const view = exportProgressView({ stage: 'extract', frame: 0, total: 0, startedAt: 1000, framesAt: 0, outTimeSec: 3 });
  assert.equal(view.pct, null);
  assert.equal(view.label, '进行中');
  assert.equal(view.text, '预处理视频 · 已处理 3 秒');
  assert.equal(exportProgressView(null).pct, null);
});

test("stream tail describes encoding and includes backpressure in per-frame timing", () => {
  const view = exportProgressView({ stage: 'encode', frame: 30, total: 30, startedAt: 0, framesAt: 0,
    outTimeSec: 0.5, durationSec: 1, perFrame: { render: 2, anim: 1, shot: 50, feed: 7 } }, 1000);
  assert.equal(view.pct, 50);
  assert.match(view.text, /完成视频编码/);
  assert.match(view.text, /60ms.*送帧 7/);
});


test("parallel progress uses wall time for ETA and labels per-page work", () => {
  const view = exportProgressView({stage:"frames", frame:30,total:60,startedAt:1000,framesAt:1000,workers:2,
    perFrame:{render:2,anim:0,shot:80}},4000);
  assert.match(view.text,/两页并行/);
  assert.match(view.text,/预计还需 3 秒/);
  assert.match(view.text,/每页平均每帧 82ms/);
});
