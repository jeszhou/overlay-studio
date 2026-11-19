import test from "node:test";
import assert from "node:assert/strict";
import { selectFrameConcurrency, orderedFrames } from "./parallel-frames.mjs";

const machine = { cpus: 4, memory: 8 * 1024 ** 3 };
const job = { mode: "timeline", parallelFrames: true, doc: { cards: [{ kind: "caption-track", params: {} }] } };
test("parallel is explicit and requires the entire supported scene", () => {
  assert.equal(selectFrameConcurrency({ ...job, parallelFrames: false }, machine).effective, 1);
  assert.equal(selectFrameConcurrency(job, machine).effective, 2);
  assert.equal(selectFrameConcurrency({ ...job, doc: { cards: [...job.doc.cards, {kind:"chapter-bar",params:{progMode:"line"}}] } }, machine).effective, 2);
  for (const parallelFrames of ["true", 1, null]) assert.throws(() => selectFrameConcurrency({ ...job, parallelFrames }, machine));
  for (const card of [{ kind: "ring-metric" }, { kind: "caption-track", seg: "group" }, { kind: "caption-track", params: { dimAt: 1 } }]) {
    assert.equal(selectFrameConcurrency({ ...job, doc: { cards: [...job.doc.cards, card] } }, machine).effective, 1);
  }
  assert.equal(selectFrameConcurrency({ ...job, mode: "single" }, machine).effective, 1);
  assert.equal(selectFrameConcurrency({ ...job, doc: { cards: [] } }, machine).effective, 1);
});
test("low available resources fall back to one page", () => {
  assert.equal(selectFrameConcurrency(job, { ...machine, cpus: 1 }).effective, 1);
  assert.equal(selectFrameConcurrency(job, { ...machine, memory: 1024 ** 3 }).effective, 1);
});
test("out-of-order completions are delivered in order with no work ahead of the batch", async () => {
  const started = []; let release;
  const workers = [0, 1].map(worker => ({ async renderFrame(frameIndex, file) {
    started.push(frameIndex);
    if (frameIndex === 0) await new Promise(resolve => { release = resolve; });
    return { frameIndex, file, worker };
  } }));
  const frames = orderedFrames(workers, 5, index => `${index}.png`);
  const first = frames.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  release(); assert.equal((await first).value.frameIndex, 0);
  assert.deepEqual(started, [0, 1]);
  assert.equal((await frames.next()).value.frameIndex, 1);
  assert.deepEqual(started, [0, 1]);
  const rest = []; for await (const frame of frames) rest.push([frame.frameIndex, frame.file]);
  assert.deepEqual(rest, [[2, "2.png"], [3, "3.png"], [4, "4.png"]]);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
});
test("worker failure rejects the batch and never launches another", async () => {
  const started = [];
  const workers = [0, 1].map(worker => ({ async renderFrame(frameIndex) {
    started.push(frameIndex); if (worker) throw new Error("page crashed"); return { frameIndex };
  } }));
  const frames = orderedFrames(workers, 10, () => undefined);
  await assert.rejects(frames.next(), /page crashed/);
  assert.deepEqual(started, [0, 1]);
});
test("consumer cancellation starts no next batch", async () => {
  const started = [];
  const worker = { async renderFrame(frameIndex) { started.push(frameIndex); return { frameIndex }; } };
  for await (const frame of orderedFrames([worker, worker], 10, () => undefined)) { assert.equal(frame.frameIndex, 0); break; }
  assert.deepEqual(started, [0, 1]);
});
