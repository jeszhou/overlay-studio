import { useRef, type ReactNode } from "react";
import { FxSpeedContext, useFxSpeed } from "./useAnimation";

/**
 * 单张卡的动画速度作用域:
 * - rAF 钩子(数字滚动/打字机等)通过 FxSpeedContext 读倍速
 * - CSS 过渡通过 playbackRate 每帧对齐
 * display:contents 不产生盒子,不影响卡片定位。
 */
export function FxSpeedScope({ speed, children }: { speed: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFxSpeed(() => ref.current, speed);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <FxSpeedContext.Provider value={speed}>{children}</FxSpeedContext.Provider>
    </div>
  );
}
