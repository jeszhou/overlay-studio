import os from "node:os";
import { captureExportFrame } from "./capture-export-frame.mjs";
import { exportFrameClock } from "./export-frame-renderer.mjs";

/** Entire scenes must qualify; never split unsupported co-visible cards away. */
export function selectFrameConcurrency(job, { memory = os.totalmem(), cpus = os.availableParallelism() } = {}) {
  if (job.parallelFrames !== undefined && typeof job.parallelFrames !== "boolean")
    throw new Error("parallelFrames 必须是布尔值");
  const plan = { requested: job.parallelFrames ? 2 : 1, effective: 1, reason: "未开启并行渲染" };
  if (!job.parallelFrames) return plan;
  if (job.mode !== "timeline" || !Array.isArray(job.doc?.cards) || !job.doc.cards.length ||
      job.doc.cards.some(card => !["caption-track", "chapter-bar"].includes(card.kind) || card.seg || Number(card.params?.dimAt) > 0))
    return { ...plan, reason: "当前仅支持不含分组或变浅动画的字幕与章节条时间轴，已使用单页渲染" };
  if (cpus < 2 || memory < 8 * 1024 ** 3)
    return { ...plan, reason: "CPU 少于两核或总内存不足 8GB，已使用单页渲染" };
  return { ...plan, effective: 2, reason: "字幕与章节条时间轴使用两页渲染" };
}

/** Stateless scenes only. Page-side synchronous commit is explicitly opt-in. */
export function createDirectFrameRenderer({ page, fps, fastPng = false,
  captureFrame = (file) => captureExportFrame(page, file, fastPng) }) {
  const clock = exportFrameClock(fps);
  let busy = false;
  return {
    async renderFrame(frameIndex, file) {
      const time = clock.time(frameIndex);
      if (busy) throw new Error("同一页面不能同时渲染两帧");
      busy = true;
      try {
        const start = performance.now();
        await page.evaluate(async (t) => {
          if (!window.__DIRECT_FRAME || !window.__setExportT) throw new Error("指定帧页面未就绪");
          window.__setExportT(t);
          await document.fonts.ready;
          // Detect future CSS changes that invalidate the stateless capability.
          if (document.getAnimations().some(a => !window.__DIRECT_ANIMATIONS?.has(a) || a.playState !== "paused")) throw new Error("出现未适配的动画，请关闭并行渲染后重试");
        }, time);
        const ready = performance.now();
        const png = await captureFrame(file, time);
        return { png, frameIndex, time, timing: { render: ready - start, anim: 0, shot: performance.now() - ready } };
      } finally { busy = false; }
    },
  };
}

/** At most one pending/completed PNG per worker. Await consumer before next batch. */
export async function* orderedFrames(renderers, total, fileForFrame) {
  if (!renderers.length || renderers.length > 2 || !Number.isSafeInteger(total) || total < 1)
    throw new Error("帧调度参数错误");
  for (let start = 0; start < total; start += renderers.length) {
    const batch = await Promise.all(renderers.slice(0, total - start).map((renderer, offset) =>
      renderer.renderFrame(start + offset, fileForFrame(start + offset))));
    for (const frame of batch) yield frame;
  }
}
