import type { EffectDef, EffectProps } from "../types";
import { useEnter, useProgress } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
  GLASS_DEFAULTS,
  glassClass,
  glassVars,
} from "./accent";

export interface RingMetricParams {
  theme: "dark" | "light";
  position: "left" | "right" | "center";
  kicker: string;
  value: number;
  max: number;
  decimals: number;
  unit: string;
  label: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

const R = 140;
const C = 2 * Math.PI * R;

function RingMetric({ params, playToken }: EffectProps<RingMetricParams>) {
  const { position, kicker, value, max, decimals, unit, label, accent } = params;
  const entered = useEnter(playToken);
  const progress = useProgress(1100, playToken);
  const ratio = Math.max(0, Math.min(1, value / (max || 1)));
  const display = (value * progress).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <div
      className={`hud ${glassClass(params.glass)} rm hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      {kicker && <div className="rm-kicker hud-fade">{kicker}</div>}
      <div className="rm-ring">
        <svg viewBox="0 0 320 320">
          <circle className="rm-track" cx="160" cy="160" r={R} strokeWidth="14" />
          <circle
            className="rm-prog"
            cx="160"
            cy="160"
            r={R}
            strokeWidth="14"
            strokeDasharray={C}
            strokeDashoffset={entered ? C * (1 - ratio) : C}
          />
        </svg>
        <div className="rm-center">
          <div className="rm-num">
            {display}
            {unit && <span className="rm-unit">{unit}</span>}
          </div>
        </div>
      </div>
      {label && <div className="rm-label hud-fade">{label}</div>}
    </div>
  );
}

export const ringMetricDef: EffectDef<RingMetricParams> = {
  id: "ring-metric",
  name: "RingMetric",
  description: "指标环 · 圆环进度 + 数字滚动",
  tags: ["滚动计数", "生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    kicker: "比例指标",
    value: 92.4,
    max: 100,
    decimals: 1,
    unit: "%",
    label: "圆环注水到这个比例",
    accent: "blue",
    ...GLASS_DEFAULTS,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
        { label: "居中", value: "center" },
      ],
    },
    { key: "kicker", label: "小标签", type: "text" },
    { key: "value", label: "数值", type: "range", min: 0, max: 100, step: 0.1 },
    { key: "max", label: "满值(算比例)", type: "range", min: 1, max: 1000, step: 1 },
    { key: "decimals", label: "小数位", type: "range", min: 0, max: 2, step: 1 },
    { key: "unit", label: "单位", type: "text" },
    { key: "label", label: "说明文字", type: "text" },
    { key: "accent", label: "环色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: RingMetric,
};
