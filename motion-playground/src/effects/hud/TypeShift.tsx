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

export interface TypeShiftParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  lines: string; // 行,| 分隔;第一行会成为 hero
  shiftAtMs: number; // 何时"啪"地重排
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

/** 行的错落偏移(草稿感),重排后归零 */
const RAGS = [-180, 40, -80, 120, -30];

/** 杂志排版流:先像草稿左错落,再"啪"地重排成层级版式 */
function TypeShift({ params, playToken }: EffectProps<TypeShiftParams>) {
  const { position, lines, shiftAtMs, accent } = params;
  const elapsed = useElapsed(playToken, 12000);
  // 以 * 开头的行 = 重排后的大标;以 — 开头的行 = 小字署名
  const list = lines.split("|").map((s) => s.trim()).filter(Boolean);
  const roles = list.map((l) =>
    l.startsWith("*") ? "hero" : l.startsWith("—") || l.startsWith("-") ? "small" : "mid",
  );
  const texts = list.map((l) => (l.startsWith("*") ? l.slice(1) : l));
  const phase = elapsed < shiftAtMs ? "pA" : "pB";

  return (
    <div
      className={`hud ${glassClass(params.glass)} ts ${phase} hud-anchor hud-anchor--${position}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      {texts.map((line, i) => (
        <div
          className={`ts-line ${elapsed > 150 + i * 160 ? "is-in" : ""}`}
          data-role={roles[i]}
          key={i}
          style={{
            ["--ts-rag" as string]: `${RAGS[i % RAGS.length]}px`,
            transitionDelay: phase === "pB" ? `${i * 70}ms` : "0ms",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

export const typeShiftDef: EffectDef<TypeShiftParams> = {
  id: "type-shift",
  name: "TypeShift",
  description: "排版流 · 草稿错落 → 啪地重排成版式",
  tags: ["聚散飞行"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    lines: "把结尾的升华放在这里|它会一行一行铺开|*停在最重的那一句|— 小字署名收尾",
    shiftAtMs: 1600,
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
    { key: "lines", label: "行(| 分隔;*开头=大标,—开头=小字)", type: "text" },
    { key: "shiftAtMs", label: "何时重排", type: "range", min: 800, max: 4000, step: 100, unit: "ms" },
    { key: "accent", label: "大标颜色", type: "select", options: ACCENT_OPTIONS },
    ...GLASS_CONTROLS,
    ...OFFSET_CONTROLS,
  ],
  Component: TypeShift,
};
