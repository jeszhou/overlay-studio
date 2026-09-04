import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
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

export interface OdometerParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  kicker: string;
  value: number; // 整数
  unit: string;
  label: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

const DIGITS = "0123456789".split("");

/** React Bits「Counter」风格:翻牌里程表,每一位数字滚轮转到位 */
function Odometer({ params, playToken }: EffectProps<OdometerParams>) {
  const { position, kicker, value, unit, label, accent } = params;
  const entered = useEnter(playToken);
  const str = String(Math.max(0, Math.round(value)));
  const chars = str.split("");

  return (
    <div
      className={`hud ${glassClass(params.glass)} od hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      {kicker && <div className="od-kicker">{kicker}</div>}
      <div className="od-row">
        {chars.map((c, i) => {
          const d = Number(c);
          return (
            <span className="od-slot" key={i}>
              <span
                className="od-reel"
                style={{
                  transform: `translateY(${entered ? -d * 1.15 : 0}em)`,
                  transitionDelay: `${(chars.length - i) * 110}ms`, // 从个位往高位依次到位
                }}
              >
                {DIGITS.map((dd) => (
                  <span className="od-d" key={dd}>{dd}</span>
                ))}
              </span>
            </span>
          );
        })}
        {unit && <span className="od-unit">{unit}</span>}
      </div>
      {label && <div className="od-label hud-fade">{label}</div>}
    </div>
  );
}

export const odometerDef: EffectDef<OdometerParams> = {
  id: "odometer",
  name: "Odometer",
  description: "翻牌计数器 · 每位数字滚轮到位",
  tags: ["滚动计数", "翻转轮换"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    kicker: "整数计数",
    value: 500,
    unit: "万",
    label: "里程表翻牌,机械感十足",
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
        { label: "居中", value: "center" },
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "kicker", label: "小标签(可空)", type: "text" },
    { key: "value", label: "数值(整数)", type: "range", min: 0, max: 99999, step: 1 },
    { key: "unit", label: "单位", type: "text" },
    { key: "label", label: "说明(可空)", type: "text" },
    { key: "accent", label: "单位颜色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: Odometer,
};
