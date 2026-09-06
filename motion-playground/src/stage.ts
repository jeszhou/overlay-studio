
/** 工程支持的成片画幅。只开放已验证的尺寸，避免导出任意大 viewport。 */
export type StageAspect = "16:9" | "9:16";

export interface StageSize {
  readonly w: number;
  readonly h: number;
}

export interface StageSnapGuides {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_ASPECT: StageAspect = "16:9";

const STAGES: Readonly<Record<StageAspect, StageSize>> = {
  "16:9": Object.freeze({ w: 1920, h: 1080 }),
  "9:16": Object.freeze({ w: 1080, h: 1920 }),
};

const SNAP_GUIDES: Readonly<Record<StageAspect, StageSnapGuides>> = {
  "16:9": Object.freeze({ x: 120, y: 96 }),
  "9:16": Object.freeze({ x: 72, y: 120 }),
};

export function isStageAspect(value: unknown): value is StageAspect {
  return value === "16:9" || value === "9:16";
}

/** 旧工程没有 aspect 字段时仍保持 1920×1080。 */
export function stageForAspect(aspect?: StageAspect | null): StageSize {
  return STAGES[isStageAspect(aspect) ? aspect : DEFAULT_ASPECT];
}

export function snapGuidesForAspect(aspect?: StageAspect | null): StageSnapGuides {
  return SNAP_GUIDES[isStageAspect(aspect) ? aspect : DEFAULT_ASPECT];
}

/** @deprecated 新代码应从工程 aspect 调用 stageForAspect。 */
export const STAGE = STAGES[DEFAULT_ASPECT];

