import { spawn } from "node:child_process";
import { EXPORT_IDLE_MS, lineReader, progressConsumer, progressWatchdog } from "./export-progress.mjs";
import { stopProcessTree } from "./process-tree.mjs";

let sequence = 0;
export function emitProgress(event) { console.log(JSON.stringify({ event: "progress", ...event })); }
export function nextOperation(stage) { return `${++sequence}:${stage}`; }

/**
 * Run FFmpeg without blocking Node; emit JSON progress only from its machine protocol.
 * done resolves the terminal status and encoded frame count; failures never report 0.
 * command/prefixArgs allow a process fixture to exercise the real stream/lifecycle in tests.
 */
export function startFfmpeg(args, {
  stage, durationSec, total, operation = nextOperation(stage),
  // Allow the script to remove partial files and close Chrome before the server watchdog.
  onProgress = emitProgress, idleMs = EXPORT_IDLE_MS - 30_000,
  command = "ffmpeg", prefixArgs = [], pipeInput = false,
} = {}) {
  let resolve;
  const done = new Promise((settle) => { resolve = settle; });
  const child = spawn(command, [...prefixArgs, "-nostdin", "-nostats", "-stats_period", "0.5",
    "-progress", "pipe:1", ...args], { stdio: [pipeInput ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  let failure;
  let fields = {};
  let encodedFrames = 0;
  const status = { stage };
  const consume = progressConsumer(status);
  const publish = (state, metrics = {}) => {
    const event = { event: "progress", stage, operation, state, durationSec, total, ...metrics };
    if (consume(event)) watchdog.advance();
    onProgress(event);
  };
  const watchdog = progressWatchdog(() => {
    failure = new Error(`FFmpeg ${stage} ${Math.round(idleMs / 1000)} 秒没有实际进展,已停止`);
    void stopProcessTree(child.pid).catch((error) => {
      failure = new Error(`${failure.message}; 停止进程树失败: ${error.message}`);
      child.kill("SIGKILL");
    });
  }, { idleMs });
  publish("start");
  const lines = lineReader((line) => {
    const index = line.indexOf("=");
    if (index < 0) return;
    const key = line.slice(0, index);
    fields[key] = line.slice(index + 1).trim();
    if (key !== "progress") return;
    const number = (field) => Math.max(0, Number(fields[field]) || 0);
    encodedFrames = Math.max(encodedFrames, number("frame"));
    // out_time_us and legacy out_time_ms are both expressed in microseconds.
    publish("advance", { frame: number("frame"), totalSize: number("total_size"),
      outTimeSec: number(fields.out_time_us === undefined ? "out_time_ms" : "out_time_us") / 1e6 });
    fields = {};
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => lines.write(chunk));
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });
  child.once("error", (error) => { failure = error; });
  child.once("close", (code, signal) => {
    lines.end();
    watchdog.stop();
    const ok = code === 0 && !signal && !failure;
    if (ok) publish("end");
    const error = failure?.message ?? (ok ? undefined : `FFmpeg ${stage} ${signal ? `被 ${signal} 停止` : `退出码 ${code}`}`);
    resolve({ status: ok ? 0 : (code || 1), signal, stderr, error, encodedFrames });
  });
  return {
    done, input: child.stdin,
    inputAdvanced() { watchdog.advance(); },
    async abort(reason = "导出取消") {
      failure ??= new Error(reason);
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        try { await stopProcessTree(child.pid); }
        catch { child.kill("SIGKILL"); }
      }
      return done;
    },
  };
}

export function runFfmpeg(args, options) { return startFfmpeg(args, options).done; }

export function ffmpegFailure(result, label) {
  const error = new Error(`${label}: ${result.error ?? `FFmpeg 退出码 ${result.status}`}\n${result.stderr?.trim() ?? ""}`);
  error.stderr = result.stderr?.trim() ?? "";
  return error;
}
