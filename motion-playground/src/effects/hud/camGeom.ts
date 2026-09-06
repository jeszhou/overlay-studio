import { stageForAspect, type StageAspect } from "../../stage";

/**
 * 运镜几何 —— 画布(预览)和卡片(导出)共用,两边必须算出同一个结果。
 *
 * 这些工具原先住在 PunchZoom / CamFrame 两张卡的文件里,但画布始终需要它们,
 * 而卡片可能不在某个发行版中(基础版只带一部分卡)。所以放进共享模块:
 * 卡片来去自如,画布不受影响。
 */

/** 推近的变换原点:焦点名 → CSS transform-origin */
export const PZ_ORIGIN: Record<string, string> = {
  center: "50% 38%",
  left: "32% 38%",
  right: "68% 38%",
};

/** camFrameGeom 需要的字段(CamFrameParams 的子集,结构兼容,直接传整个 params 即可) */
export interface CamFrameGeomInput {
  shape?: "circle" | "portrait" | "square";
  side?: "left" | "right";
  size?: number;
  camDX?: number;
  camDY?: number;
}

/** 人物取景框的落位与尺寸 */
export function camFrameGeom(p: CamFrameGeomInput, aspect?: StageAspect) {
  const { w: SW, h: SH } = stageForAspect(aspect);
  const shape = p.shape ?? "circle";
  const w = Math.min(Number(p.size) || 520, SW - (aspect === "9:16" ? 144 : 300));
  const h = shape === "portrait" ? Math.round((w * 4) / 3) : w;
  const margin = aspect === "9:16" ? 72 : 150;
  const x = aspect === "9:16"
    ? Math.round((SW - w) / 2)
    : (p.side ?? "left") === "right" ? SW - margin - w : margin;
  const y = aspect === "9:16" ? 220 : Math.round((SH - h) / 2);
  const r = shape === "circle" ? w / 2 : 36;
  return { x: x + (Number(p.camDX) || 0), y: y + (Number(p.camDY) || 0), w, h, r };
}

/** focus-card 需要的字段 */
export interface FocusCamGeomInput {
  side?: "left" | "right";
  camDX?: number;
  camDY?: number;
  camW?: number;
  camH?: number;
}

/**
 * focus-card 的口播落位框 —— 预览(Canvas)、导出(卡片 --fcd-*)共用这一份。
 *
 * 这套几何以前在 Canvas 和 FocusCard 里各写了一份,注释说「严格同源」其实是
  * 复制的;改排版时只改了一处,画面里人像和落位框就对不上了。收进这里。
 *
  * 人缩到左/右侧 700×700 方框,要点在另一侧。
 */
export function focusCamGeom(p: FocusCamGeomInput, aspect?: StageAspect) {
  const stage = stageForAspect(aspect);
  const portrait = aspect === "9:16";
  const w = Math.min(Number(p.camW) || 700, portrait ? stage.w - 144 : 1200);
  const h = Math.min(Number(p.camH) || 700, portrait ? 760 : 1000);
  const x = portrait
    ? Math.round((stage.w - w) / 2)
    : (p.side ?? "left") === "right" ? 1110 : 110;
  const y = 190;
  return {
    x: x + (Number(p.camDX) || 0),
    y: y + (Number(p.camDY) || 0),
    w,
    h,
    r: 36,
  };
}
