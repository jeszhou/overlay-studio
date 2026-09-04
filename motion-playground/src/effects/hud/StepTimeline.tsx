import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
import { OFFSET_CONTROLS, OFFSET_DEFAULTS, offsetVars } from "./accent";

export interface StepTimelineParams {
  theme: "dark" | "light";
  position: "left" | "right";
  title: string; // 用 *...* 高亮关键词
  accent: "pink" | "blue" | "lav";
  steps: string; // 用 | 分隔各章节
  revealed: number; // 已讲到的章节数(其余留空)
  offsetX?: number;
  offsetY?: number;
}

const ACCENT_VAR: Record<string, string> = {
  pink: "var(--hud-pink)",
  blue: "var(--hud-blue)",
  teal: "var(--hud-teal)",
  violet: "var(--hud-violet)",
};
// 章节卡循环:蓝→青→紫 一组和谐冷色(同饱和度档)
const CYCLE = ["blue", "teal", "violet"] as const;
const STAGGER = 240; // 逐句出现的节奏(ms)

/** 把 "两套*不一样*的打法" 里的 *...* 渲染成高亮 */
function renderTitle(title: string) {
  return title.split(/(\*[^*]+\*)/).map((seg, i) =>
    seg.startsWith("*") && seg.endsWith("*") ? (
      <span className="st-key" key={i}>
        {seg.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

function StepTimeline({ params, playToken }: EffectProps<StepTimelineParams>) {
  const { position, title, accent, steps, revealed } = params;
  const entered = useEnter(playToken);
  const labels = steps.split("|").map((s) => s.trim());
  const dx = position === "right" ? "48px" : "-48px";

  return (
    <div
      className={`hud st hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{
        ["--st-hl" as string]: ACCENT_VAR[accent],
        ["--st-dx" as string]: dx,
        ...offsetVars(params),
      }}
    >
      <div className="st-title hud-fade">
        <span className="st-bar" />
        <span>{renderTitle(title)}</span>
      </div>

      <div className="st-list">
        {labels.map((label, i) => {
          const isEmpty = i >= revealed;
          const delay = `${i * STAGGER}ms`;
          return (
            <div
              className="st-step"
              key={i}
              style={{
                transitionDelay: delay,
                ["--st-c" as string]: ACCENT_VAR[CYCLE[i % CYCLE.length]],
              }}
            >
              <div className="st-node" style={{ transitionDelay: delay }} />
              <div className={`st-chip${isEmpty ? " is-empty" : ""}`}>
                {isEmpty ? "" : label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const stepTimelineDef: EffectDef<StepTimelineParams> = {
  id: "step-timeline",
  name: "StepTimeline",
  description: "步骤时间线卡 · 章节逐句冒出",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    title: "《本期*章节*大纲》",
    accent: "blue",
    steps: "开场钩子|干货主体|结尾升华",
    revealed: 2,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    {
      key: "theme",
      label: "底色(此卡独立生效)",
      type: "select",
      options: [
        { label: "🌞 亮底", value: "light" },
        { label: "🌙 暗底", value: "dark" },
      ],
    },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
      ],
    },
    { key: "title", label: "标题(*关键词*高亮)", type: "text" },
    {
      key: "accent",
      label: "标题强调色",
      type: "select",
      options: [
        { label: "亮粉", value: "pink" },
        { label: "钴蓝", value: "blue" },
        { label: "宝石青", value: "teal" },
        { label: "宝石紫", value: "violet" },
      ],
    },
    { key: "steps", label: "章节(用 | 分隔)", type: "text" },
    { key: "revealed", label: "已讲到第几章", type: "range", min: 0, max: 6, step: 1 },
    ...OFFSET_CONTROLS,
  ],
  Component: StepTimeline,
};
