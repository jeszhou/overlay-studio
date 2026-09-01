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

export interface VersusCardParams {
  theme: "dark" | "light";
  aKicker: string;
  aTitle: string;
  aSub: string;
  aAccent: string;
  bKicker: string;
  bTitle: string;
  bSub: string;
  winner: "a" | "b" | "none"; // 强调哪边(另一边降调)
  offsetX?: number;
  offsetY?: number;
}

function VersusCard({ params, playToken }: EffectProps<VersusCardParams>) {
  const { aKicker, aTitle, aSub, aAccent, bKicker, bTitle, bSub, winner } = params;
  const entered = useEnter(playToken);
  const accent = ACCENT_VAR[aAccent];

  const dimA = winner === "b";
  const dimB = winner === "a";

  return (
    <div
      className={`hud vs hud-anchor hud-anchor--center ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: accent, ...offsetVars(params) }}
    >
      <div
        className={`vs-side a ${dimA ? "is-dim" : ""}`}
        style={{ ["--vs-c" as string]: accent }}
      >
        <div className="vs-kicker">{aKicker}</div>
        <div className="vs-title">{aTitle}</div>
        <div className="vs-sub">{aSub}</div>
      </div>

      <div className="vs-badge">VS</div>

      <div
        className={`vs-side b ${dimB ? "is-dim" : ""}`}
        style={{ ["--vs-c" as string]: accent, transitionDelay: "140ms" }}
      >
        <div className="vs-kicker">{bKicker}</div>
        <div className="vs-title">{bTitle}</div>
        <div className="vs-sub">{bSub}</div>
      </div>
    </div>
  );
}

export const versusCardDef: EffectDef<VersusCardParams> = {
  id: "versus-card",
  name: "VersusCard",
  description: "VS 对比卡 · 双卡对撞 + 中央徽章",
  tags: ["对撞并置"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    aKicker: "主推 · 会点亮",
    aTitle: "选项 A",
    aSub: "胜出的一边高亮",
    aAccent: "pink",
    bKicker: "对照 · 会变灰",
    bTitle: "选项 B",
    bSub: "落败的一边压暗",
    winner: "a",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    { key: "aKicker", label: "左卡小标", type: "text" },
    { key: "aTitle", label: "左卡标题", type: "text" },
    { key: "aSub", label: "左卡说明", type: "text" },
    { key: "aAccent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "bKicker", label: "右卡小标", type: "text" },
    { key: "bTitle", label: "右卡标题", type: "text" },
    { key: "bSub", label: "右卡说明", type: "text" },
    {
      key: "winner",
      label: "强调哪边",
      type: "select",
      options: [
        { label: "左边", value: "a" },
        { label: "右边", value: "b" },
        { label: "都不", value: "none" },
      ],
    },
    ...OFFSET_CONTROLS,
  ],
  Component: VersusCard,
};
