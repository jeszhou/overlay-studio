import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { assertProbeCompleted, exportFailurePayload } from "./export-failure.mjs";
import { ffmpegFailure } from "./ffmpeg-process.mjs";
const { exportFailureMessage } = await tsImport("../src/exportFailure.ts", import.meta.url);

test("a real probe-like timeout is a failure, even when stdout cannot supply a duration", () => {
  const probe = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    encoding: "utf8", timeout: 50,
  });
  assert.equal(probe.error?.code, "ETIMEDOUT");
  assert.throws(() => assertProbeCompleted(probe, "/素材/slow clip.mp4", 50), /读取视频时长失败.*slow clip.*超过 0.05 秒/);
});

test("a signaled probe cannot accept partial stdout; existing unknown-duration behavior stays unchanged", () => {
  assert.throws(() => assertProbeCompleted({ signal: "SIGTERM", stdout: "120" }, "clip.mp4", 30_000), /SIGTERM/);
  assert.doesNotThrow(() => assertProbeCompleted({ status: 0, stdout: "N/A" }, "clip.mp4", 30_000));
  assert.doesNotThrow(() => assertProbeCompleted({ status: 0, stdout: "12.5" }, "clip.mp4", 30_000));
});

test("long FFmpeg diagnostics, actionable summary and retained output paths reach the UI together", () => {
  const error = ffmpegFailure({ status: 1, stderr: "codec initialization detail\n".repeat(200) + "Unknown encoder 'libvpx-vp9'" }, "WebM 合成失败");
  const response = exportFailurePayload(error, { ok: true, mov: "C:\\项目 导出\\output.mov", webm: null, dir: "C:\\项目 导出\\frames" });
  assert.equal(response.ok, false);
  assert.equal(response.error, "WebM 合成失败: FFmpeg 退出码 1");
  assert.ok(response.details.length <= 4_000);
  // A non-zero server response retains the structured result instead of replacing it with stderr.slice(-800).
  const parsed = JSON.parse(JSON.stringify(response));
  const message = exportFailureMessage(parsed);
  assert.match(message, /WebM 合成失败/);
  assert.match(message, /Unknown encoder 'libvpx-vp9'/);
  assert.ok(message.includes(response.mov));
  assert.ok(message.includes(response.dir));
  assert.doesNotMatch(message, /\nnull/);
});

test("legacy errors keep the useful diagnostics before the final failure marker", () => {
  const message = exportFailureMessage({ error: "No space left on device\n【导出失败原因】MOV 合成失败" });
  assert.match(message, /No space left on device/);
  assert.match(message, /MOV 合成失败/);
  assert.doesNotMatch(message, /已保留/);
});
