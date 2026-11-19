import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPngStream } from "./png-stream.mjs";
import { resolveExportMode } from "./export-options.mjs";

function pipeline(t, code, { formats = ["mov"], frames = 2, idleMs = 2000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "png-pipe-test-"));
  const files = Object.fromEntries(formats.map(format => [format, path.join(root, `test.${format}`)]));
  const pipe = createPngStream({ files, fps: 30, durationSec: frames / 30, totalFrames: frames,
    processOptions: { command: process.execPath, prefixArgs: ["-e", code, "--"], idleMs } });
  t.after(async () => { await pipe.abort(); fs.rmSync(root, { recursive: true, force: true }); });
  return { pipe, files };
}
const copy = `const fs=require('node:fs');const chunks=[];
process.stdin.on('data',b=>chunks.push(b));
process.stdin.on('end',()=>{fs.writeFileSync(process.argv.at(-1),Buffer.concat(chunks));process.stdout.write('frame=2\\nprogress=end\\n');});`;

test("stream mode is explicit; preserving PNG selects the sequence path", () => {
  assert.equal(resolveExportMode(undefined), "sequence");
  assert.equal(resolveExportMode("stream"), "stream");
  assert.equal(resolveExportMode("stream", true), "sequence");
  for (const value of [true, null, "fast", {}, 0]) assert.throws(() => resolveExportMode(value), /exportMode/);
});

test("all selected encoders receive identical ordered bytes and EOF", { timeout: 5000 }, async (t) => {
  const { pipe, files } = pipeline(t, copy, { formats: ["mov", "webm"] });
  await pipe.write(new Uint8Array([1, 2, 3]));
  await pipe.write(new Uint8Array([4, 5]));
  assert.deepEqual(await pipe.finish(), files);
  for (const file of Object.values(files)) assert.deepEqual(fs.readFileSync(file), Buffer.from([1, 2, 3, 4, 5]));
  assert.equal(pipe.submitted, 2);
});

test("a slow consumer applies backpressure instead of queueing subsequent frames", { timeout: 5000 }, async (t) => {
  const { pipe } = pipeline(t, `${copy}process.stdin.pause();setTimeout(()=>process.stdin.resume(),250);`);
  let accepted = false;
  const first = pipe.write(Buffer.alloc(4 * 1024 * 1024, 5)).then(() => { accepted = true; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(accepted, false);
  await assert.rejects(pipe.write(Buffer.from([9])), /依次提交/);
  await first;
  await pipe.write(Buffer.from([8]));
  await pipe.finish();
});

test("early exit and EPIPE reject pending input and retain diagnostics", { timeout: 5000 }, async (t) => {
  const { pipe, files } = pipeline(t, `process.stderr.write('injected encoder failure');process.exitCode=7;`);
  await assert.rejects(pipe.write(Buffer.alloc(4 * 1024 * 1024)), /injected encoder failure/);
  assert.equal(fs.existsSync(files.mov), false);
});

test("a completed MOV survives failure of the optional WebM encoder", { timeout: 5000 }, async (t) => {
  const code = `const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{
    const file=process.argv.at(-1);if(file.endsWith('.webm')) {process.stderr.write('VP9 failed');process.exitCode=9;}
    else {fs.writeFileSync(file,'complete');process.stdout.write('frame=2\\nprogress=end\\n');}});`;
  const { pipe, files } = pipeline(t, code, { formats: ["mov", "webm"] });
  await pipe.write(Buffer.from([1])); await pipe.write(Buffer.from([2]));
  await assert.rejects(pipe.finish(), /VP9 failed/);
  assert.deepEqual(pipe.outputs, { mov: files.mov });
  assert.equal(fs.readFileSync(files.mov, 'utf8'), 'complete');
  assert.equal(fs.existsSync(files.webm), false);
});

test("short input is rejected instead of exporting a truncated success", { timeout: 5000 }, async (t) => {
  const { pipe, files } = pipeline(t, copy);
  await pipe.write(Buffer.from([1]));
  await assert.rejects(pipe.finish(), /帧数不完整/);
  assert.equal(fs.existsSync(files.mov), false);
});

test("a frozen encoder releases a blocked writer through the watchdog", { timeout: 5000 }, async (t) => {
  const { pipe } = pipeline(t, 'setInterval(()=>{},1000);', { idleMs: 200 });
  await assert.rejects(pipe.write(Buffer.alloc(4 * 1024 * 1024)), /没有实际进展|流式送帧失败/);
});

test("explicit cancellation releases blocked input and removes partial output", { timeout: 5000 }, async (t) => {
  const { pipe, files } = pipeline(t, `require('node:fs').writeFileSync(process.argv.at(-1),'partial');setInterval(()=>{},1000);`);
  const writing = assert.rejects(pipe.write(Buffer.alloc(4 * 1024 * 1024)), /流式送帧失败/);
  await new Promise(resolve => setTimeout(resolve, 70));
  await pipe.abort('user cancelled');
  await writing;
  assert.equal(fs.existsSync(files.mov), false);
});

test("successful exit with missing encoded frames is rejected and the video removed", { timeout: 5000 }, async (t) => {
  const { pipe, files } = pipeline(t, copy.replace("frame=2", "frame=1"));
  await pipe.write(Buffer.from([1])); await pipe.write(Buffer.from([2]));
  await assert.rejects(pipe.finish(), /实际 1\/2 帧/);
  assert.equal(fs.existsSync(files.mov), false);
});
