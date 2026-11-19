import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { lineReader, progressConsumer, frameProgressReporter } from "./export-progress.mjs";
import { runFfmpeg } from "./ffmpeg-process.mjs";
import { stopProcessTree } from "./process-tree.mjs";

function fixture(code, options = {}) {
  return runFfmpeg([], { stage: "mov", durationSec: 10, idleMs: 800,
    command: process.execPath, prefixArgs: ["-e", code, "--"], onProgress: () => {}, ...options });
}

test("a healthy encoder may take longer than the idle timeout while counters advance", async () => {
  const events = [];
  let settled = false;
  const result = await fixture(`
    let frame = 0;
    const timer = setInterval(() => {
      process.stdout.write('frame=' + (++frame) + '\\nout_time_us=' + frame * 100000 + '\\nprogress=continue\\n');
      if (frame === 40) { clearInterval(timer); process.exitCode = 0; }
    }, 30);`, { onProgress: (event) => { assert.equal(settled, false); events.push(event); } });
  settled = true;
  assert.equal(result.status, 0);
  assert.equal(events.at(-1).state, "end");
  assert.ok(events.some((event) => event.frame === 40 && event.outTimeSec === 4));
});

test("repeated progress records and stderr logs cannot keep a frozen encoder alive", async () => {
  const events = [];
  const result = await fixture(`setInterval(() => {
    process.stdout.write('frame=1\\nout_time_us=100000\\nprogress=continue\\n');
    process.stderr.write('still alive, but no work\\n');
  }, 20);`, { onProgress: (event) => events.push(event) });
  assert.notEqual(result.status, 0);
  assert.match(result.error, /没有实际进展/);
  assert.match(result.stderr, /still alive/);
  assert.ok(!events.some((event) => event.state === "end"));
});

test("FFmpeg end record is not success when the process later exits with an error", async () => {
  const events = [];
  const result = await fixture(`
    process.stdout.write('frame=10\\nout_time_us=1000000\\nprogress=end\\n');
    process.stderr.write('写入失败: No space left on device\\n');
    process.exitCode = 7;`, { onProgress: (event) => events.push(event) });
  assert.equal(result.status, 7);
  assert.match(result.stderr, /写入失败/);
  assert.match(result.error, /退出码 7/);
  assert.ok(!events.some((event) => event.state === "end"));
});

test("spawn errors and external signals are explicit failures", async () => {
  const missing = await runFfmpeg([], { stage: "mov", command: "overlay-missing-ffmpeg-test", onProgress: () => {} });
  assert.notEqual(missing.status, 0);
  assert.match(missing.error, /ENOENT/);
  if (process.platform !== "win32") {
    const killed = await fixture(`process.kill(process.pid, 'SIGTERM')`);
    assert.notEqual(killed.status, 0);
    assert.equal(killed.signal, "SIGTERM");
  }
});

test("streamed status handles split records, rejects stale stages and ignores duplicate work", () => {
  const status = { stage: "prep", frame: 0, total: 0 };
  const consume = progressConsumer(status, () => 123);
  const advances = [];
  const reader = lineReader((line) => {
    try { advances.push(consume(JSON.parse(line))); } catch { /* Human logs. */ }
  });
  const records = [
    { event: "progress", stage: "frames", operation: "1:frames", state: "start", total: 30 },
    { event: "progress", stage: "frames", operation: "1:frames", state: "advance", frame: 30, total: 30 },
    { event: "progress", stage: "mov", operation: "2:mov", state: "start", durationSec: 1 },
    { event: "progress", stage: "mov", operation: "2:mov", state: "advance", frame: 10, outTimeSec: 0.3 },
    { event: "progress", stage: "mov", operation: "2:mov", state: "advance", frame: 10, outTimeSec: 0.3 },
    { event: "progress", stage: "frames", operation: "1:frames", state: "advance", frame: 30 },
  ].map((record) => JSON.stringify(record)).join("\n");
  for (let i = 0; i < records.length; i += 7) reader.write(records.slice(i, i + 7));
  reader.end();
  assert.deepEqual(advances, [true, true, true, true, false, false]);
  assert.equal(status.stage, "mov");
  assert.equal(status.frame, 30);
  assert.equal(status.encodedFrame, 10);
  assert.equal(status.outTimeSec, 0.3);
  assert.equal(status.stageStartedAt, 123);
  assert.equal(consume({ event: "progress", stage: "mov", operation: "2:mov", state: "advance", frame: 9 }), false);
  assert.equal(status.encodedFrame, 10);
});

test("process-tree shutdown reaches a detached Chromium-like grandchild", { skip: process.platform === "win32" }, async () => {
  const root = spawn(process.execPath, ["-e", `
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached:true, stdio:'ignore'});
    process.stdout.write(String(child.pid) + '\\n');
    setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(root, "close");
  const [data] = await once(root.stdout, "data");
  const descendant = Number(String(data).trim());
  assert.ok(descendant > 0);
  try {
    await stopProcessTree(root.pid);
    const [, signal] = await closed;
    assert.equal(signal, "SIGKILL");
    const state = spawnSync("ps", ["-o", "stat=", "-p", String(descendant)], { encoding: "utf8" }).stdout.trim();
    assert.ok(state === "" || state.startsWith("Z"), `descendant must not remain running: ${state}`);
  } finally {
    try { process.kill(descendant, "SIGKILL"); } catch { /* Gone. */ }
    try { root.kill("SIGKILL"); } catch { /* Gone. */ }
  }
});


test("fast rendering reports first and final frames immediately and merges intermediate progress", () => {
  let clock = 0;
  const events = [];
  const report = frameProgressReporter(e => events.push(e), { now: () => clock });
  const event = (frame, state = "advance") => ({ stage: "frames", operation: "frames:1", frame, total: 100, state });
  report(event(0, "start"));
  clock = 10; report(event(1));
  clock = 100; report(event(2));
  clock = 509; report(event(50));
  clock = 510; report(event(51));
  clock = 520; report(event(100, "end"));
  assert.deepEqual(events.map(e => e.frame), [0, 1, 51, 100]);
});


test("slow completed frames still reach the watchdog and duplicate work cannot renew it", () => {
  let clock = 0;
  const state = { stage: "prep", frame: 0, total: 0 };
  const consume = progressConsumer(state, () => clock);
  const renewals = [];
  const report = frameProgressReporter(event => {
    if (consume({ event: "progress", ...event })) renewals.push(clock);
  }, { now: () => clock });
  const event = (frame, status = "advance") => ({ stage: "frames", operation: "slow", frame, total: 3, state: status });
  report(event(0, "start"));
  clock = 100; report(event(1));
  clock = 100100; report(event(2));
  clock = 200100; report(event(2));
  assert.deepEqual(renewals, [0, 100, 100100]);
  clock = 200101; report(event(3, "end"));
  clock = 200102; report(event(3, "end"));
  assert.deepEqual(renewals, [0, 100, 100100, 200101]);
  assert.equal(state.frame, 3);
});

test("stream encoding advances the watchdog while rendering waits, then enters one encoding tail", () => {
  const status = { stage: 'prep', frame: 0, total: 0 };
  const consume = progressConsumer(status);
  const event = { event: 'progress', stage: 'frames', operation: 'stream-frames', state: 'start', total: 30 };
  assert.equal(consume(event), true);
  assert.equal(consume({ ...event, state: 'advance', frame: 1, totalSize: 10 }), true);
  assert.equal(consume({ ...event, state: 'advance', frame: 1, totalSize: 20 }), true);
  assert.equal(consume({ ...event, state: 'advance', frame: 1, totalSize: 20 }), false);
  assert.equal(consume({ ...event, state: 'end', frame: 30 }), true);
  const tail = { event: 'progress', stage: 'encode', operation: 'stream-tail', state: 'start', durationSec: 1 };
  assert.equal(consume(tail), true);
  assert.equal(consume({ ...tail, state: 'advance', outTimeSec: 0.5 }), true);
  assert.equal(status.outTimeSec, 0.5);
  assert.equal(consume({ event: 'progress', stage: 'webm', operation: 'stream-webm', state: 'start' }), true);
});

test("the real stage order — mix, render, encode — keeps reporting and renewing the watchdog", () => {
  const status = { running: true, stage: 'prep', frame: 0, total: 0 };
  const consume = progressConsumer(status);
  const accepted = [
    { event: 'progress', stage: 'prep', operation: '1:prep', state: 'start' },
    { event: 'progress', stage: 'sfx', operation: '2:sfx', state: 'start', durationSec: 1.7 },
    { event: 'progress', stage: 'sfx', operation: '2:sfx', state: 'advance', outTimeSec: 1.7 },
    { event: 'progress', stage: 'sfx', operation: '2:sfx', state: 'end' },
    { event: 'progress', stage: 'frames', operation: '3:frames', state: 'start', frame: 0, total: 51 },
    { event: 'progress', stage: 'frames', operation: '3:frames', state: 'advance', frame: 1, total: 51 },
    { event: 'progress', stage: 'frames', operation: '3:frames', state: 'end', frame: 51, total: 51 },
    { event: 'progress', stage: 'mov', operation: '4:mov', state: 'start', durationSec: 1.7, total: 51 },
    { event: 'progress', stage: 'mov', operation: '4:mov', state: 'advance', frame: 51, outTimeSec: 1.7 },
  ].map((event) => consume(event));
  // Every step is real work: a rejected event would freeze the浮窗 and starve the watchdog.
  assert.deepEqual(accepted, [true, true, true, true, true, true, true, true, true]);
  assert.equal(status.stage, 'mov');
  assert.equal(status.frame, 51);
  assert.equal(status.total, 51);
  assert.equal(status.encodedFrame, 51);
  // A late duplicate from the finished render must still not reopen an earlier stage.
  assert.equal(consume({ event: 'progress', stage: 'frames', operation: '3:frames', state: 'advance', frame: 51 }), false);
  assert.equal(status.stage, 'mov');
});


test("frame worker count is retained without inventing progress", () => {
  const state={stage:"prep",total:0};const consume=progressConsumer(state);
  assert.equal(consume({event:"progress",stage:"frames",operation:"frames:parallel",state:"start",frame:0,workers:2}),true);
  assert.equal(state.workers,2);
  assert.equal(consume({event:"progress",stage:"frames",operation:"frames:parallel",state:"advance",frame:0,workers:2}),false);
  assert.equal(state.workers,2);
});
