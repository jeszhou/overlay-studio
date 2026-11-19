export const EXPORT_IDLE_MS = 15 * 60_000;
// Emission order. The monotonic check below rejects any event from an earlier stage,
// so this list must match the exporter's real sequence: the sound-effect mix is now
// prepared before the render page loads, not after encoding.
const stages = ["prep", "extract", "sfx", "frames", "encode", "mov", "webm"];

/** Consume complete lines once, including split UTF-8 chunks; bound malformed long lines. */
export function lineReader(onLine, maxLength = 64 * 1024) {
  let pending = "";
  let dropping = false;
  return {
    write(chunk) {
      for (const part of String(chunk).split(/(?<=\n)/)) {
        if (!dropping) pending += part;
        if (pending.length > maxLength) { pending = ""; dropping = true; }
        if (part.endsWith("\n")) {
          if (!dropping) onLine(pending.replace(/[\r\n]+$/, ""));
          pending = "";
          dropping = false;
        }
      }
    },
    end() {
      if (pending && !dropping) onLine(pending);
      pending = "";
    },
  };
}

/** Timer resets only when the caller has observed real work, never on log traffic. */
export function progressWatchdog(onStall, { idleMs = EXPORT_IDLE_MS } = {}) {
  let timer;
  let stopped = false;
  const advance = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { stopped = true; onStall(); }, idleMs);
  };
  advance();
  return { advance, stop() { stopped = true; clearTimeout(timer); } };
}

/**
 * Apply the exporter's JSON progress protocol to the /api/export-status object.
 * Returns true only for a new operation, increasing work counters, or its first end.
 * frame/total stay tied to screenshots; encodedFrame/outTimeSec describe FFmpeg.
 */
export function progressConsumer(status, now = Date.now) {
  const seen = new Set();
  let operation;
  let frame = 0;
  let seconds = 0;
  let bytes = 0;
  let ended = false;
  return (event) => {
    if (!event || event.event !== "progress" || !stages.includes(event.stage)
      || typeof event.operation !== "string" || !event.operation || event.operation.length > 128
      || !["start", "advance", "end"].includes(event.state)) return false;
    const counter = (key) => typeof event[key] === "number" && Number.isFinite(event[key]) && event[key] >= 0
      ? event[key] : 0;
    let advanced = false;
    if (event.operation !== operation) {
      if (event.state !== "start" || seen.has(event.operation)
        || stages.indexOf(event.stage) < stages.indexOf(status.stage)) return false;
      seen.add(event.operation);
      operation = event.operation;
      frame = seconds = bytes = 0;
      ended = false;
      status.stage = event.stage;
      status.operation = operation;
      status.stageStartedAt = now();
      status.encodedFrame = 0;
      status.outTimeSec = 0;
      status.totalSize = 0;
      status.durationSec = counter("durationSec");
      if (event.stage === "frames") status.framesAt = now();
      advanced = true;
    } else if (event.stage !== status.stage || ended) return false;
    const nextFrame = counter("frame");
    const nextSeconds = counter("outTimeSec");
    const nextBytes = counter("totalSize");
    advanced ||= nextFrame > frame || nextSeconds > seconds || nextBytes > bytes;
    frame = Math.max(frame, nextFrame);
    seconds = Math.max(seconds, nextSeconds);
    bytes = Math.max(bytes, nextBytes);
    if (event.stage === "frames") {
      if (event.workers === 1 || event.workers === 2) status.workers = event.workers;
      status.frame = frame;
      status.total = Math.max(status.total, counter("total"));
      if (event.perFrame && ["render", "anim", "shot"].every((key) =>
        Number.isFinite(event.perFrame[key]) && event.perFrame[key] >= 0)) status.perFrame = event.perFrame;
    } else {
      status.encodedFrame = frame;
      status.outTimeSec = seconds;
      status.totalSize = bytes;
    }
    if (event.state === "end") { ended = true; advanced = true; }
    return advanced;
  };
}


/** Bound reporting by real elapsed time, without a timer or synthetic heartbeat. */
export function frameProgressReporter(send, { intervalMs = 500, now = () => performance.now() } = {}) {
  let frame = 0;
  let ended = false;
  let lastSent = -Infinity;
  return (event) => {
    if (event.state === "start") {
      frame = 0;
      ended = false;
    } else {
      if (ended || event.frame <= frame) return false;
      frame = event.frame;
    }
    const time = now();
    if (event.state !== "start" && frame !== 1 && event.state !== "end" && time - lastSent < intervalMs) return false;
    ended = event.state === "end";
    lastSent = time;
    send(event);
    return true;
  };
}
