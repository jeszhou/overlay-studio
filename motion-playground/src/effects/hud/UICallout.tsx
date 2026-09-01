import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface UICalloutParams {
  theme: "dark" | "light";
  label: string;
  ringW: number;
  ringH: number;
  side: "left" | "right"; // 标签在圈的哪一侧
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

/**
 * 界面标注:一个圈住目标区域的圆角框 + 一根自绘引线 + 标签。
 * 用「水平/垂直微调」把圈挪到你界面元素的位置,ringW/ringH 调圈大小。
 */
function UICallout({ params, playToken }: EffectProps<UICalloutParams>) {
  const { label, ringW, ringH, side, accent } = params;
  const entered = useEnter(playToken);

  const LINE = 130; // 引线长度
  const box = { w: ringW + LINE + 60, h: Math.max(ringH, 80) };
  const ringX = side === "right" ? 0 : LINE + 60;
  const lineStartX = side === "right" ? ringW : ringX;
  const lineEndX = side === "right" ? ringW + LINE : 60;
  const midY = box.h / 2;

  return (
    <div
      className={`hud uc hud-anchor hud-anchor--center ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="uc-box" style={{ width: box.w, height: box.h }}>
        <div
          className="uc-ring"
          style={{ left: ringX, top: midY - ringH / 2, width: ringW, height: ringH }}
        />
        <svg
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
          width={box.w}
          height={box.h}
        >
          <line
            className="uc-line"
            x1={lineStartX}
            y1={midY}
            x2={lineEndX}
            y2={midY}
            style={{ ["--len" as string]: LINE }}
          />
        </svg>
        <div
          className="uc-tag"
          style={
            side === "right"
              ? { left: ringW + LINE + 14, top: midY, transform: "translateY(-50%)" }
              : { right: box.w - 60 + 14, top: midY, transform: "translateY(-50%)" }
          }
        >
          {label}
        </div>
      </div>
    </div>
  );
}

export const uiCalloutDef: EffectDef<UICalloutParams> = {
  id: "ui-callout",
  name: "UICallout",
  description: "界面标注 · 圈住区域 + 引线 + 标签",
  tags: ["生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    label: "圈出界面上的重点",
    ringW: 300,
    ringH: 170,
    side: "right",
    accent: "blue",
    offsetX: -300,
    offsetY: 0,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    { key: "label", label: "标签文字", type: "text" },
    { key: "ringW", label: "圈宽", type: "range", min: 80, max: 800, step: 10, unit: "px" },
    { key: "ringH", label: "圈高", type: "range", min: 60, max: 600, step: 10, unit: "px" },
    {
      key: "side",
      label: "标签方向",
      type: "select",
      options: [
        { label: "圈右", value: "right" },
        { label: "圈左", value: "left" },
      ],
    },
    { key: "accent", label: "标注色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: UICallout,
};
