import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface ChecklistParams {
  stepMs?: number;
  theme: "dark" | "light";
  position: "left" | "right" | "top-left";
  title: string;
  items: string; // 用 | 分隔
  checked: number; // 已完成数量
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

const STAGGER = 160;

function Checklist({ params, playToken }: EffectProps<ChecklistParams>) {
  const { theme, position, title, items, checked, accent } = params;
  void theme;
  const entered = useEnter(playToken);
  const list = items.split("|").map((s) => s.trim()).filter(Boolean);
  const dx = position === "right" ? "20px" : "-20px";

  return (
    <div
      className={`hud ck hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ["--ck-dx" as string]: dx, ...offsetVars(params) }}
    >
      {title && <div className="hud-kicker hud-fade">{title}</div>}
      {list.map((item, i) => {
        const done = i < checked;
        return (
          <div
            className={`ck-item ${done ? "is-done" : "is-todo"}`}
            key={i}
            style={{ transitionDelay: `${i * (params.stepMs ?? STAGGER)}ms` }}
          >
            <span className="ck-box">{done ? "✓" : ""}</span>
            <span>{item}</span>
          </div>
        );
      })}
    </div>
  );
}

export const checklistDef: EffectDef<ChecklistParams> = {
  id: "checklist",
  vTier: "half",
  name: "Checklist",
  description: "步骤打勾 · 流程逐项完成打√",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    stepMs: 160,
    theme: "dark",
    position: "left",
    title: "步骤打勾",
    items: "列出流程步骤|讲到哪条勾哪条|完成的亮起来|没讲到的先灰着",
    checked: 3,
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "stepMs", label: "每条间隔(卡点用)", type: "range", min: 100, max: 8000, step: 100, unit: "ms" },
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
        { label: "左上(叠在全屏画面上)", value: "top-left" },
      ],
    },
    { key: "title", label: "小标题", type: "text" },
    { key: "items", label: "步骤(用 | 分隔)", type: "text" },
    { key: "checked", label: "已完成到第几步", type: "range", min: 0, max: 8, step: 1 },
    { key: "accent", label: "打勾色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: Checklist,
};
