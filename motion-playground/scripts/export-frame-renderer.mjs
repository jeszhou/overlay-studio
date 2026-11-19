import { captureExportFrame } from "./capture-export-frame.mjs";

/** The same rational clock drives timeline time, virtual time and the encoder. */
export function exportFrameClock(fps) {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0)
    throw new Error("导出帧率必须是有限的正数");
  const ntsc = Math.abs(fps - 29.97) < 0.01;
  const rate = ntsc ? 30000 / 1001 : fps;
  return { rate, argument: ntsc ? "30000/1001" : String(fps), intervalMs: 1000 / rate,
    time(frameIndex) {
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new Error("帧号必须是非负整数");
      return frameIndex / rate;
    } };
}

/** Register before advancing; remove both timer and listener on every exit. */
export async function advanceVirtualFrame(client, intervalMs, timeoutMs = 30_000) {
  let timer, onExpired;
  const expired = new Promise((resolve, reject) => {
    onExpired = resolve;
    client.once("Emulation.virtualTimeBudgetExpired", onExpired);
    timer = setTimeout(() => reject(new Error(`渲染器 ${timeoutMs / 1000} 秒没有推进,已停止导出`)), timeoutMs);
  });
  try {
    await Promise.all([expired, client.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: intervalMs })]);
  } finally {
    clearTimeout(timer);
    client.off("Emulation.virtualTimeBudgetExpired", onExpired);
  }
}

async function awaitVideoFrames(page, timeoutMs) {
  const start = performance.now();
  while (await page.evaluate(() => window.__pendingVidFrames?.() ?? 0)) {
    if (performance.now() - start >= timeoutMs)
      throw new Error("本帧视频图片未就绪,已停止导出;请检查素材和抽帧缓存后重试");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * One page owns one ordered frame history. Arbitrary forward requests replay EVERY
 * omitted frame, including its capture step: paint can itself affect CSS lifecycle.
 * The exporter may substitute a verified consecutive-empty-frame capture only;
 * it must never skip a frame commit, video readiness or animation advancement.
 * This is a correctness fallback, NOT an accelerated random-access renderer.
 * Backward requests require a fresh page/renderer. No overlapping requests on a page.
 */
export function createExportFrameRenderer({ page, client, fps, fastPng = false,
  captureFrame = (file) => captureExportFrame(page, file, fastPng), resourceTimeoutMs = 5000, frameTimeoutMs = 30_000, onReplayFrame }) {
  const clock = exportFrameClock(fps);
  let next = 0, busy = false, failed = false;
  return {
    clock,
    async renderFrame(frameIndex, file) {
      clock.time(frameIndex);
      if (busy || failed || frameIndex < next) throw new Error("帧渲染状态错误:每页必须依序执行,失败或倒退后请新建渲染页面");
      busy = true;
      try {
        let output;
        while (next <= frameIndex) {
          const current = next;
          const tA = performance.now();
          await page.evaluate((t) => {
            if (typeof window.__setExportT !== "function") throw new Error("导出页面缺少帧时钟接口");
            window.__setExportT(t);
            window.__seekVideos?.(t);
          }, clock.time(current));
          await awaitVideoFrames(page, resourceTimeoutMs);
          await advanceVirtualFrame(client, clock.intervalMs, frameTimeoutMs);
          const tB = performance.now();
          // Preserve the published animation stepping; speed/currentTime semantics
          // must not silently change while the random-access contract is introduced.
          await page.evaluate((ms) => {
            for (const a of document.getAnimations()) {
              try {
                if (a.playState !== "paused") a.pause();
                a.currentTime = Number(a.currentTime ?? 0) + ms;
              } catch { /* Removed animation. */ }
            }
          }, clock.intervalMs);
          // Newly mounted cards may have created video images during this frame.
          await page.evaluate((t) => window.__seekVideos?.(t), clock.time(current));
          await awaitVideoFrames(page, resourceTimeoutMs);
          const tC = performance.now();
          const png = await captureFrame(current === frameIndex ? file : undefined, clock.time(current));
          const tD = performance.now();
          next++;
          const timing = { render: tB - tA, anim: tC - tB, shot: tD - tC };
          if (current === frameIndex) output = { png, timing, frameIndex: current, time: clock.time(current) };
          else await onReplayFrame?.({ frameIndex: current, timing });
        }
        return output;
      } catch (error) {
        failed = true;
        throw error;
      } finally { busy = false; }
    },
  };
}
