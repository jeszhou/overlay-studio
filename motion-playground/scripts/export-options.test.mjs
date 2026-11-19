import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveExportOutputs, resolveFastPng, resolveCompatibilityMode } from "./export-options.mjs";
import { captureExportFrame } from "./capture-export-frame.mjs";

test("omitted CLI outputs retain MOV + WebM; explicit MOV avoids the optional format", () => {
  assert.deepEqual(resolveExportOutputs(undefined), ["mov", "webm"]);
  assert.deepEqual(resolveExportOutputs(["mov"]), ["mov"]);
  assert.deepEqual(resolveExportOutputs(["mov", "webm"]), ["mov", "webm"]);
  const input = ["webm", "mov"];
  assert.deepEqual(resolveExportOutputs(input), ["mov", "webm"]);
  assert.deepEqual(input, ["webm", "mov"]);
});

test("invalid and WebM-only requests cannot silently fall back to other outputs", () => {
  for (const value of [null, false, "mov", [], ["webm"], ["mp4"], ["mov", "mp4"], ["mov", "mov"], ["MOV"], ["mov", null]]) {
    assert.throws(() => resolveExportOutputs(value), /outputs.*MOV/);
  }
});

test("fast PNG is explicitly opt-in and never coerces a string or number", () => {
  assert.equal(resolveFastPng(undefined), false);
  assert.equal(resolveFastPng(false), false);
  assert.equal(resolveFastPng(true), true);
  for (const value of [null, "false", "true", 0, 1, [], {}]) {
    assert.throws(() => resolveFastPng(value), /fastPng/);
  }
});

test("capture keeps transparent PNG output and only fast mode changes compression", async () => {
  const calls = [];
  const encoded = new Uint8Array([1, 2, 3]);
  const page = { screenshot: async (options) => { calls.push(options); return encoded; } };
  assert.equal(await captureExportFrame(page, "frame.png", false), encoded);
  assert.equal(await captureExportFrame(page, "fast.png", true), encoded);
  assert.deepEqual(calls, [
    { type: "png", path: "frame.png", omitBackground: true },
    { type: "png", path: "fast.png", omitBackground: true, optimizeForSpeed: true },
  ]);
});

test("unsupported fast capture asks to disable fast PNG", async () => {
  const cause = new Error("Protocol error (Page.captureScreenshot): Invalid parameters optimizeForSpeed");
  const page = { screenshot: async () => { throw cause; } };
  await assert.rejects(captureExportFrame(page, "fast.png", true), (error) => {
    assert.match(error.message, /关闭.*fastPng: false/);
    assert.equal(error.cause, cause);
    return true;
  });
  await assert.rejects(captureExportFrame(page, "frame.png", false), (error) => error === cause);
});

test("CLI rejects invalid outputs before launching Chrome or creating exports", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-output-options-test-"));
  const exportDir = path.join(root, "exports");
  const before = fs.existsSync(exportDir) ? fs.readdirSync(exportDir).sort() : null;
  try {
    const job = path.join(temp, "job.json");
    for (const [invalid, error] of [
      [{ outputs: ["webm"] }, /【导出失败原因】outputs/],
      [{ outputs: ["mov"], fastPng: "true" }, /【导出失败原因】fastPng/],
      [{ compatibilityMode: "false" }, /【导出失败原因】compatibilityMode/],
    ]) {
      fs.writeFileSync(job, JSON.stringify(invalid));
      const run = spawnSync(process.execPath, [path.join(root, "scripts/export-frames.mjs"), job], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: path.join(temp, "no-chrome") },
      });
      assert.equal(run.status, 1);
      assert.match(run.stderr, error);
      assert.doesNotMatch(run.stderr, /Chromium|Failed to launch/);
      assert.equal(run.stdout, "");
    }
    const after = fs.existsSync(exportDir) ? fs.readdirSync(exportDir).sort() : null;
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("compatibility mode defaults off and only accepts booleans", () => {
  assert.equal(resolveCompatibilityMode(undefined), false);
  assert.equal(resolveCompatibilityMode(false), false);
  assert.equal(resolveCompatibilityMode(true), true);
  for (const value of [null, "false", "true", 0, 1, [], {}]) {
    assert.throws(() => resolveCompatibilityMode(value), /compatibilityMode/);
  }
});
