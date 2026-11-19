/** A killed/timed-out probe must not be mistaken for a video with unknown duration. */
export function assertProbeCompleted(probe, source, timeoutMs) {
  if (!probe.error && !probe.signal) return;
  const reason = probe.error?.code === "ETIMEDOUT"
    ? `ffprobe 超过 ${timeoutMs / 1000} 秒未完成，已停止`
    : probe.signal ? `ffprobe 被 ${probe.signal} 停止` : String(probe.error?.message ?? probe.error);
  const error = new Error(`读取视频时长失败 ${source}: ${reason}`);
  error.stderr = String(probe.stderr ?? "");
  throw error;
}

/** Keep the actionable summary, bounded diagnostics, and existing recoverable files separate. */
export function exportFailurePayload(error, retained = {}) {
  const message = String(error?.message ?? error);
  const details = String(error?.stderr ?? message.split("\n").slice(1).join("\n")).trim().slice(-4_000);
  return { ...retained, ok: false, error: message.split("\n")[0], ...(details ? { details } : {}) };
}
