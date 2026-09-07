/**
 * 运镜几何 —— 画布(预览)和卡片(导出)共用,两边必须算出同一个结果。
 *
 * 画布和卡片都需要这份几何,所以放进共享模块,两边引用同一份。
 */

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
export function focusCamGeom(p: FocusCamGeomInput) {
  const x = (p.side ?? "left") === "right" ? 1110 : 110;
  const y = 190;
  const w = Number(p.camW) || 700;
  const h = Number(p.camH) || 700;
  return {
    x: x + (Number(p.camDX) || 0),
    y: y + (Number(p.camDY) || 0),
    w,
    h,
    r: 36,
  };
}
