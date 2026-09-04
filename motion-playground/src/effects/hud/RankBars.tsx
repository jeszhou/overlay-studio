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

export interface RankBarsParams {
  theme: "dark" | "light";
  position: "left" | "right";
  title: string;
  rows: string; // "名称,数值|名称,数值"
  suffix: string;
  accent: string; // 第一名强调色
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

const STAGGER = 140;

function RankBars({ params, playToken }: EffectProps<RankBarsParams>) {
  const { theme, position, title, rows, suffix, accent } = params;
  void theme;
  const entered = useEnter(playToken);
  const progress = useProgress(1400, playToken);

  const parsed = rows.split("|").map((r) => {
    const [name, val] = r.split(",");
    return { name: (name ?? "").trim(), value: Number(val) || 0 };
  });
  const max = Math.max(...parsed.map((r) => r.value), 1);

  return (
    <div
      className={`hud ${glassClass(params.glass)} rb hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      <div className="hud-kicker hud-fade">{title}</div>

      {parsed.map((row, i) => {
        const isTop = row.value === max;
        return (
          <div
            className={`rb-row ${isTop ? "is-top" : "is-dim"}`}
            key={i}
            style={{ transitionDelay: `${i * STAGGER}ms` }}
          >
            <div className="rb-head">
              <span className="rb-name">{row.name}</span>
              <span className="rb-val">
                {Math.round(row.value * progress).toLocaleString("en-US")}
                {suffix}
              </span>
            </div>
            <div className="rb-track">
              <div
                className="rb-fill"
                style={{
                  ["--rb-frac" as string]: row.value / max,
                  transitionDelay: `${i * STAGGER}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const rankBarsDef: EffectDef<RankBarsParams> = {
  id: "rank-bars",
  name: "RankBars",
  description: "数据排名条 · 条形生长 + 数值滚动",
  tags: ["生长描画", "滚动计数"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    title: "多项数据 · 对比排名",
    rows: "第一名,42|第二名,21|第三名,10",
    suffix: "%",
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
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "title", label: "小标题", type: "text" },
    { key: "rows", label: "数据(名称,数值 用 | 分隔)", type: "text" },
    { key: "suffix", label: "后缀单位", type: "text" },
    { key: "accent", label: "第一名强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: RankBars,
};
