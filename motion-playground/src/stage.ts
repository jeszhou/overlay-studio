import { createContext, useContext } from "react";

/**
 * 画幅 · 全局唯一的尺寸源头
 *
 * h = 16:9 横版(1920×1080),v = 9:16 竖版(1080×1920)。
 * 和 doc.skin(配色)/doc.style(骨架)同级:由 doc.ratio 驱动,
 * 挂到画布根节点的 data-ratio,hud.css 里用 [data-ratio="v"] 写差异覆盖。
 *
 * 原则:横版规则一行不动,竖版只写差异。
 */
export type StageRatio = "h" | "v";

export const STAGE_SIZE: Record<StageRatio, { w: number; h: number }> = {
  h: { w: 1920, h: 1080 },
  v: { w: 1080, h: 1920 },
};

/** 容错取值:非法/缺省一律回落横版(老工程文件照常打开就是横版) */
export function stageSize(ratio: StageRatio | undefined | string) {
  return STAGE_SIZE[ratio === "v" ? "v" : "h"];
}

/**
 * 卡片组件读画幅用。自己开 canvas 的卡(尘埃流场/字符雨/素材墙)
 * 要按画幅铺画布,不能再写死 1920×1080。
 * 默认横版:没有 Provider 的场合(效果库单卡预览)行为不变。
 */
export const StageRatioContext = createContext<StageRatio>("h");

export function useStageRatio(): StageRatio {
  return useContext(StageRatioContext);
}

/** 当前画幅的画布像素尺寸 */
export function useStageSize() {
  return STAGE_SIZE[useContext(StageRatioContext)];
}

/* ============================================================
   竖版人像让位
   ============================================================ */

/** 让位档:不让 / 半让 / 全让 */
export type VTier = "still" | "half" | "full";

const TIER_RANK: Record<VTier, number> = { still: 0, half: 1, full: 2 };

/**
 * 同屏多张卡时取最重的一档 —— 一张卡要全让,别的卡半让,人就得全让,
 * 否则大卡会被人像盖住一角。
 */
export function heaviestTier(tiers: (VTier | undefined)[]): VTier {
  let best: VTier = "still";
  for (const t of tiers) {
    if (t && TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

/** 让位档对应的 class(挂在 .stage-video 上,几何写在 hud.css) */
export function tierClass(tier: VTier): string {
  return tier === "full" ? "is-vfull" : tier === "half" ? "is-vhalf" : "";
}
