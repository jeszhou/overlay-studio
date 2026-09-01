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

export interface TermCardParams {
  theme: "dark" | "light";
  position: "left" | "right";
  en: string; // 英文 / 拼音,可留空
  term: string;
  def: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

function TermCard({ params, playToken }: EffectProps<TermCardParams>) {
  const { theme, position, en, term, def, accent } = params;
  void theme;
  const entered = useEnter(playToken);
  return (
    <div
      className={`hud tc hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="tc-card hud-glass">
        {en && <div className="tc-en">{en}</div>}
        <div className="tc-term">{term}</div>
        <div className="tc-def">{def}</div>
      </div>
    </div>
  );
}

export const termCardDef: EffectDef<TermCardParams> = {
  id: "term-card",
  vTier: "half",
  name: "TermCard",
  description: "术语解释卡 · 名词 + 一句人话定义",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    en: "Term Card",
    term: "术语卡",
    def: "视频里蹦出新名词时,用一句话给它下定义。",
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
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
      ],
    },
    { key: "en", label: "英文/拼音(可空)", type: "text" },
    { key: "term", label: "术语", type: "text" },
    { key: "def", label: "一句话定义", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: TermCard,
};
