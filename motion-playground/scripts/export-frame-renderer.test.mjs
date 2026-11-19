import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { advanceVirtualFrame, createExportFrameRenderer, exportFrameClock } from './export-frame-renderer.mjs';

function fixture({ pending = 0, shotError, sendError } = {}) {
  const times = [], captures = [], budgets = [];
  const client = new EventEmitter();
  client.send = async (_, options) => {
    budgets.push(options.budget);
    if (sendError) throw sendError;
    queueMicrotask(() => client.emit('Emulation.virtualTimeBudgetExpired'));
  };
  const page = {
    async evaluate(fn, value) {
      const priorWindow = globalThis.window, priorDocument = globalThis.document;
      globalThis.window = { __setExportT: t => times.push(t), __seekVideos() {}, __pendingVidFrames: () => pending };
      globalThis.document = { getAnimations: () => [] };
      try { return fn(value); }
      finally { globalThis.window = priorWindow; globalThis.document = priorDocument; }
    },
    async screenshot(options) {
      if (shotError) throw shotError;
      captures.push(options);
      return new Uint8Array([captures.length]);
    },
  };
  return { page, client, times, captures, budgets };
}

test('one rational clock keeps NTSC frame time and encoder rate aligned', () => {
  const clock = exportFrameClock(29.97);
  assert.equal(clock.argument, '30000/1001');
  assert.equal(clock.time(30000), 1001);
  assert.equal(clock.intervalMs, 1000 / clock.rate);
  assert.equal(exportFrameClock(60).time(60), 1);
  for (const fps of [0, -1, NaN, Infinity, '30', null]) assert.throws(() => exportFrameClock(fps));
  for (const frame of [-1, 0.5, Infinity]) assert.throws(() => clock.time(frame));
});

test('forward frame requests preserve every omitted paint and retain only the requested file', async () => {
  const f = fixture(), replay = [];
  const renderer = createExportFrameRenderer({ ...f, fps: 30, onReplayFrame: event => replay.push(event.frameIndex) });
  const result = await renderer.renderFrame(3, 'target.png');
  assert.deepEqual(f.times, [0, 1/30, 2/30, 3/30]);
  assert.deepEqual(f.captures.map(c => c.path), [undefined, undefined, undefined, 'target.png']);
  assert.deepEqual(replay, [0, 1, 2]);
  assert.equal(result.frameIndex, 3);
  assert.equal(result.png[0], 4);
  await renderer.renderFrame(4);
  assert.equal(f.captures.length, 5);
  await assert.rejects(renderer.renderFrame(3), /帧渲染状态错误/);
});

test('missing video frames stop before capture instead of producing a stale frame', async () => {
  const f = fixture({ pending: 1 });
  const renderer = createExportFrameRenderer({ ...f, fps: 30, resourceTimeoutMs: 1 });
  await assert.rejects(renderer.renderFrame(0), /视频图片未就绪/);
  assert.equal(f.captures.length, 0);
  await assert.rejects(renderer.renderFrame(0), /失败或倒退/);
});

test('page errors are propagated and poison the partially advanced renderer', async () => {
  const f = fixture({ shotError: new Error('lost page') });
  const renderer = createExportFrameRenderer({ ...f, fps: 30 });
  await assert.rejects(renderer.renderFrame(0), /lost page/);
  await assert.rejects(renderer.renderFrame(1), /帧渲染状态错误/);
});

test('overlapping calls on a page are rejected without advancing a second frame', async () => {
  const f = fixture(); let finish;
  f.page.screenshot = () => new Promise(resolve => { finish = resolve; });
  const renderer = createExportFrameRenderer({ ...f, fps: 30 });
  const first = renderer.renderFrame(0);
  await assert.rejects(renderer.renderFrame(1), /帧渲染状态错误/);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish(new Uint8Array([1])); await first;
  assert.deepEqual(f.times, [0]);
});

test('CDP rejection removes the budget listener and timeout', async () => {
  const f = fixture({ sendError: new Error('CDP closed') });
  await assert.rejects(advanceVirtualFrame(f.client, 1), /CDP closed/);
  assert.equal(f.client.listenerCount('Emulation.virtualTimeBudgetExpired'), 0);
});

test('a silent CDP operation times out and removes the listener', async () => {
  const client = new EventEmitter(); client.send = async () => {};
  await assert.rejects(advanceVirtualFrame(client, 1, 5), /没有推进/);
  assert.equal(client.listenerCount('Emulation.virtualTimeBudgetExpired'), 0);
});
