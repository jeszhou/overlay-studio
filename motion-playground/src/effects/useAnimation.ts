import { createContext, useContext, useEffect, useRef, useState } from "react";

/** 缓动:先快后慢,克制、无回弹(高级感的关键) */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * 动画时钟。
 * 导出时:读 ExportView 每帧写入的 __fxExportMs —— 导出脚本的每帧顺序是
 * 「先下发本帧精确时间 → 再推进虚拟时钟 → 再截图」,读它等于按帧号取时间,
 * 同一张卡导多少遍都一样。
 * 预览时:该值不存在,回落到 performance.now(),行为与改动前完全一致。
 *
 * 改动前三个计时钩子都直接用 performance.now() 自己计时,而它和虚拟时钟的
 * 对应关系每次运行都不同(实测差一帧量级)。静止/短进场的卡看不出来,
 * 全程连续运动的卡(粒子类)每帧都错位,两次导出 PSNR 只有 31dB。
 */
function clockNow(): number {
  const t = (window as unknown as { __fxExportMs?: number }).__fxExportMs;
  return typeof t === "number" ? t : performance.now();
}

/* ---- 动画速度作用域(每张卡一个;rAF 钩子按倍速换算流逝时间) ---- */
export const FxSpeedContext = createContext(1);

/** 当前作用域的动画倍速,以 ref 形式返回(rAF 闭包里读最新值) */
function useSpeedRef() {
  const speed = useContext(FxSpeedContext);
  const ref = useRef(speed);
  ref.current = speed > 0 ? speed : 1;
  return ref;
}

/**
 * 让某个容器里的 CSS 过渡/动画也吃倍速:
 * 每帧把容器内所有 Animation 的 playbackRate 设为 speed。
 */
export function useFxSpeed(getEl: () => HTMLElement | null, speed: number) {
  useEffect(() => {
    const el = getEl();
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // __fxClockRate:导出时由 ExportView 实测写入的"CSS 动画钟校正系数"。
      // 无头浏览器虚拟时间下 CSS 动画钟比虚拟时钟快好几倍(滚动/过渡瞬间播完),
      // 乘上它把所有 CSS 动画拉回和时间轴一致;预览时为空 = 1,不影响。
      const eff =
        speed * ((window as unknown as { __fxClockRate?: number }).__fxClockRate ?? 1);
      for (const a of el.getAnimations({ subtree: true })) {
        if (a.playbackRate !== eff) a.playbackRate = eff;
      }
      raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);
}


/**
 * 导出模式下的经过时间(毫秒)。预览返回 null。
 *
 * 关键:这个值在**渲染期**直接从时钟算出,不经过 rAF 回调 + setState。
 * 只换时间源是不够的 —— 导出每帧的顺序是「下发时间 → 推进虚拟时钟 → 截图」,
 * 而 rAF→setState→React 重渲染这条链在那一小段里有时跑得完、有时跑不完,
 * 跑不完就截到上一帧的画面。实测只换时间源后仍有 10/22 张卡两次导出不一致,
 * 且不同的帧散乱分布 —— 正是竞态的特征。渲染期直接读就没有这个窗口。
 *
 * 起点在 playToken 变化时重置(渲染期比对,不用 effect —— effect 跑在首次渲染之后,
 * 会让重播的第一帧用上旧起点)。
 */
function useExportMs(playToken: number, speed: number): number | null {
  const startRef = useRef<number | null>(null);
  const tokenRef = useRef(playToken);
  if (tokenRef.current !== playToken) {
    tokenRef.current = playToken;
    startRef.current = null;
  }
  const ex = (window as unknown as { __fxExportMs?: number }).__fxExportMs;
  if (typeof ex !== "number") {
    startRef.current = null;
    return null;
  }
  if (startRef.current === null) startRef.current = ex;
  return (ex - startRef.current) * (speed > 0 ? speed : 1);
}

/**
 * 数字 count-up。playToken 变化时从 0 重新滚动到 target。
 * 用 requestAnimationFrame 手动驱动,避免引入动画库。
 */
export function useCountUp(
  target: number,
  durationMs: number,
  playToken: number,
): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const speedRef = useSpeedRef();

  useEffect(() => {
    // 起点用第一帧的 rAF 时间戳(不用 performance.now()):
    // 导出的无头浏览器虚拟时间下两个钟会不同步,起点记早了动画就"一上来全播完"
    let start: number | null = null;
    const tick = () => {
      const now = clockNow();
      if (start === null) start = now;
      const t = Math.min(1, ((now - start) * speedRef.current) / durationMs);
      setValue(target * easeOutExpo(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setValue(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, playToken]);

  const exMs = useExportMs(playToken, speedRef.current);
  if (exMs !== null) return target * easeOutExpo(Math.min(1, exMs / durationMs));
  return value;
}

/**
 * 连续计时:返回自上次播放起经过的毫秒数,每帧更新,到 runMs 停止。
 * 供打字机、逐字揭示等"按时间推进"的动效用。
 */
export function useElapsed(playToken: number, runMs = 14000): number {
  const [ms, setMs] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const speedRef = useSpeedRef();
  useEffect(() => {
    let start: number | null = null; // 起点/每帧都读 performance.now()(见 useCountUp 注释)
    const tick = () => {
      const now = clockNow();
      if (start === null) start = now;
      const e = (now - start) * speedRef.current;
      setMs(e);
      if (e < runMs) rafRef.current = requestAnimationFrame(tick);
    };
    setMs(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playToken, runMs]);
  const exMs = useExportMs(playToken, speedRef.current);
  if (exMs !== null) return Math.min(runMs, exMs);
  return ms;
}

/**
 * 缓动进度 0→1(不绑定具体数值,供多行数据同步滚动用)。
 * playToken 变化时从 0 重新走到 1。
 */
export function useProgress(durationMs: number, playToken: number): number {
  const [p, setP] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const speedRef = useSpeedRef();
  useEffect(() => {
    let start: number | null = null; // 起点/每帧都读 performance.now()(见 useCountUp 注释)
    const tick = () => {
      const now = clockNow();
      if (start === null) start = now;
      const t = Math.min(1, ((now - start) * speedRef.current) / durationMs);
      setP(easeOutExpo(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setP(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [durationMs, playToken]);
  const exMs = useExportMs(playToken, speedRef.current);
  if (exMs !== null) return easeOutExpo(Math.min(1, exMs / durationMs));
  return p;
}

/**
 * 进场开关。playToken 变化时先置为 false,下一帧置 true,
 * 从而重新触发 CSS 过渡(用于 mask 揭示 / 淡入 / 位移)。
 */
export function useEnter(playToken: number): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    setEntered(false);
    // 两层 rAF 都要记下来取消。以前只取消外层:连着重放时(playToken 快速连变)
    // 上一轮的内层回调已经排上了队,cleanup 拦不住它,于是它在新一轮刚 setEntered(false)
    // 之后立刻又置回 true —— 那张卡的进场动画整个被吃掉,直接显示成已进场的样子。
    // 76 张卡走这个钩子,连按空格重放最容易撞上。
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [playToken]);
  return entered;
}
