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

export interface PunchPillParams {
  theme: "dark" | "light";
  position: "bottom" | "top-left" | "top-right";
  text: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

function PunchPill({ params, playToken }: EffectProps<PunchPillParams>) {
  const { theme, position, text, accent } = params;
  void theme;
  const entered = useEnter(playToken);

  return (
    <div
      className={`hud pp hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="pp-pill">
        <span className="pp-dot" />
        {text}
      </div>
    </div>
  );
}

export const punchPillDef: EffectDef<PunchPillParams> = {
  id: "punch-pill",
  name: "PunchPill",
  description: "金句药丸 · 高亮观点定格弹入",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "bottom",
    text: "一句金句,定格三秒",
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "底部居中", value: "bottom" },
        { label: "左上", value: "top-left" },
        { label: "右上", value: "top-right" },
      ],
    },
    { key: "text", label: "金句文字", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: PunchPill,
};
