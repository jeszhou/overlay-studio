/**
 * HUD 族共用缓动 + 确定性小工具。
 *
 * 全部是纯函数:画布预览(自走时钟)和逐帧导出(注入 __t)必须算出同一结果,
 * 所以不依赖 Date.now / Math.random —— 随机一律走 hash01(同一个 i 永远同一个值)。
 * 各卡不再各抄一份缓动,统一从这里取(与 camGeom.ts 同为共享模块)。
 */

/** 夹到 [0,1] */
export const tClamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** t 在 [a,b] 窗口内的线性进度(窗口外钳制 0/1) */
export const tProg = (t: number, a: number, b: number) =>
  t <= a ? 0 : t >= b ? 1 : tClamp((t - a) / (b - a));

/* ── 常用缓动 ── */
export const tInCubic = (x: number) => x * x * x;
export const tOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const tInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/** 回弹过冲:末尾冲过头再回正(砸落/弹出) */
export const tOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 阻尼弹簧:带一点余震(弹入/抖动),与既有精修卡同款 */
export const tSpring = (x: number) =>
  x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(9 * x);

/** 钟形包络:两端 0、中心 1(光晕/闪烁/冲击波强度) */
export const tBell = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(x * Math.PI));

/**
 * 稳定伪随机 [0,1):同一个 i 永远给同一个值。
 * 粒子/噪点的位置、大小、速度都从这里取 —— 保证跨帧、跨"预览↔导出"完全稳定,
 * 导出逐帧渲染时不会跳。
 */
export const hash01 = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
