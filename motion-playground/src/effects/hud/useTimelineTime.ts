import { useContext, useEffect, useState } from "react";
import { FxSpeedContext } from "../useAnimation";

/**
 * 时间轴时间(秒,绝对时间):
 * - 编辑台预览 / 时间轴导出会把当前时间注入 params.__t,直接用(精确)
 * - 效果库单卡预览没有时间轴,退回"从挂载起自走"的时钟,让演示动起来
 */
export function useTimelineTime(params: { __t?: number }, playToken: number): number {
  const injected = typeof params.__t === "number" ? params.__t : null;
  const hasInjected = injected != null;
  const [selfT, setSelfT] = useState(0);

  useEffect(() => {
    if (hasInjected) return;
    let raf = 0;
    // 起点/每帧都读 performance.now():导出的虚拟时间下 rAF 时间戳的钟不可靠
    let t0: number | null = null;
    const tick = () => {
      const now = performance.now();
      if (t0 === null) t0 = now;
      setSelfT((now - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playToken, hasInjected]);

  return injected ?? selfT;
}

/** 本卡已进场秒数(卡内翻页/轮播用):时间轴时间 − 卡片 start */
export function useCardElapsed(
  params: { __t?: number; __start?: number },
  playToken: number,
): number {
  const t = useTimelineTime(params, playToken);
  return Math.max(0, t - (params.__start ?? 0));
}

/**
 * 精修卡的「动画速度」倍数(全局速度 × 此卡速度)。
 * 用法:卡点秒数(times / strikeTimes / bAt / vetoAt 等)不动,
 * 卡点之后的每个动作的时长、动作内的先后间隔都除以它 —— 动作变快,踩台词的时刻不变。
 */
export function usePlateSpeed(): number {
  const s = useContext(FxSpeedContext);
  return s > 0 ? s : 1;
}
