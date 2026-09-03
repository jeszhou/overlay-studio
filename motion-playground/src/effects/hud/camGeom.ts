import { stageSize, type StageRatio } from "../../stage";

/**
 * 运镜几何 —— 画布(预览)和卡片(导出)共用,两边必须算出同一个结果。
 *
 * 这些工具原先住在 PunchZoom / CamFrame 两张卡的文件里,但画布始终需要它们,
 * 而卡片可能不在某个发行版中(免费版只带一部分卡)。所以放进共享模块:
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

/** 人物取景框的落位与尺寸。竖版没有左右可分,一律水平居中、垂直偏上 */
// ratio 必填,不给默认值:漏传就静默按横版算,预览和卡各画各的(踩过)
export function camFrameGeom(p: CamFrameGeomInput, ratio: StageRatio) {
  const { w: SW, h: SH } = stageSize(ratio);
  const shape = p.shape ?? "circle";
  const w = Number(p.size) || 520;
  const h = shape === "portrait" ? Math.round((w * 4) / 3) : w;
  const margin = 150;
  const x =
    ratio === "v"
      ? Math.round((SW - w) / 2)
      : (p.side ?? "left") === "right"
        ? SW - margin - w
        : margin;
  // 横版垂直居中;竖版把框推到上半屏,给下面的内容让地方
  const y = ratio === "v" ? Math.round(SH * 0.16) : Math.round((SH - h) / 2);
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
 * 复制的;竖版改排版时只改了一处,画面里人像和落位框就对不上了。收进这里。
 *
 * 横版:人缩到左/右侧 700×700 方框,要点在另一侧。
 * 竖版:没有左右可分,人落在上方一块、要点排到下面,两者不重叠。
 */
export function focusCamGeom(p: FocusCamGeomInput, ratio: StageRatio) {
  const V = ratio === "v";
  const x = V ? 60 : (p.side ?? "left") === "right" ? 1110 : 110;
  const y = V ? 120 : 190;
  // camW/camH 在 defaults 里恒为 700,没法用 ?? 区分「没调过」。
  // 竖版把这个横版默认值当作没调过,换成竖版尺寸;用户真调过(≠700)就听用户的。
  const w = V && (Number(p.camW) || 700) === 700 ? 960 : Number(p.camW) || 700;
  const h = V && (Number(p.camH) || 700) === 700 ? 720 : Number(p.camH) || 700;
  return {
    x: x + (Number(p.camDX) || 0),
    y: y + (Number(p.camDY) || 0),
    w,
    h,
    r: V ? 28 : 36,
  };
}
