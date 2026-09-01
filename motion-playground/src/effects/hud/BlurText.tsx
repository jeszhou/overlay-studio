import type { EffectDef, EffectProps } from "../types";
import { useElapsed } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
  GLASS_CONTROLS,
  GLASS_DEFAULTS,
  glassClass,
  glassVars,
} from "./accent";

export interface BlurTextParams {
  theme: "dark" | "light";
  position: "center" | "top" | "bottom";
  text: string; // 词块 | 分隔,*关键词* 高亮
  staggerMs: number; // 每块间隔
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

/** React Bits「Blur Text」风格:词块从模糊中逐个浮现(情绪款) */
function BlurText({ params, playToken }: EffectProps<BlurTextParams>) {
  const { position, text, staggerMs, accent } = params;
  const elapsed = useElapsed(playToken, 20000);
  const chunks = text.split("|").map((s) => s.trim()).filter(Boolean);

  return (
    <div
      className={`hud ${glassClass(params.glass)} bt hud-anchor hud-anchor--${position}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      <div className="bt-line">
        {chunks.map((chunk, i) => {
          const on = elapsed > 200 + i * staggerMs;
          return (
            <span className={`bt-w ${on ? "is-on" : ""}`} key={i}>
              {/* 支持句中夹关键词:素材*自己出现* → 高亮"自己出现" */}
              {chunk.split(/(\*[^*]+\*)/).filter(Boolean).map((seg, j) =>
                seg.startsWith("*") && seg.endsWith("*") ? (
                  <i className="bt-key" key={j}>
                    {seg.slice(1, -1)}
                  </i>
                ) : (
                  <i key={j}>{seg}</i>
                ),
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const blurTextDef: EffectDef<BlurTextParams> = {
  id: "blur-text",
  name: "BlurText",
  description: "模糊浮现 · 词块从虚焦中逐个清晰",
  tags: ["玻璃虚化", "逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    text: "走心的句子|从虚焦里|*慢慢浮现*",
    staggerMs: 420,
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
        { label: "顶部", value: "top" },
        { label: "底部", value: "bottom" },
      ],
    },
    { key: "text", label: "词块(| 分隔,*关键词*)", type: "text" },
    { key: "staggerMs", label: "每块间隔", type: "range", min: 150, max: 1200, step: 30, unit: "ms" },
    { key: "accent", label: "关键词颜色", type: "select", options: ACCENT_OPTIONS },
    ...GLASS_CONTROLS,
    ...OFFSET_CONTROLS,
  ],
  Component: BlurText,
};
