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

export interface EntityChipsParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  /** 一行一块名牌:「牌面|名称|身份/EN」,牌面 light=白牌 dark=黑牌 */
  chips: string;
  /** 名牌右侧的小注(如股票代码/头衔),「上行|下行」 */
  note?: string;
  /** 名牌逐块滑入间隔 */
  stepMs?: number;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

interface Chip {
  style: string;
  name: string;
  sub: string;
}

function parseChips(raw: string): Chip[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((l) => {
      const [style = "light", name = "", sub = ""] = l.split("|").map((s) => s.trim());
      return { style, name, sub };
    });
}

/**
 * 实体名牌(人物/公司锚定):讲到某个人或机构时,
 * 一排名牌依次滑入并常驻——白牌(机构)+ 黑牌(人物·头衔)+ 侧注(代码/身份),
 * 之后整段讨论期间一直钉在画面上,观众随时知道"现在在说谁"。
 */
function EntityChips({ params, playToken }: EffectProps<EntityChipsParams>) {
  const { position, chips, note, stepMs, accent } = params;
  const entered = useEnter(playToken);
  const list = parseChips(chips);
  const [noteA = "", noteB = ""] = (note ?? "").split("|").map((s) => s.trim());
  const step = stepMs ?? 500;

  return (
    <div
      className={`hud etc hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="etc-row">
        {list.map((c, i) => (
          <div
            className={`etc-chip etc-chip--${c.style === "dark" ? "dark" : "light"}`}
            style={{ transitionDelay: `${i * step}ms` }}
            key={i}
          >
            <div className="etc-name">{c.name}</div>
            {c.sub && <div className="etc-sub">{c.sub}</div>}
          </div>
        ))}
        {(noteA || noteB) && (
          <div className="etc-note" style={{ transitionDelay: `${list.length * step}ms` }}>
            {noteA && <div className="etc-note-a">{noteA}</div>}
            {noteB && <div className="etc-note-b">{noteB}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export const entityChipsDef: EffectDef<EntityChipsParams> = {
  id: "entity-chips",
  name: "EntityChips",
  description: "实体名牌 · 人物/公司锚定牌,滑入后常驻",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    chips: "light|白牌写机构名|EN OR ROLE\ndark|黑牌写人名|头衔 · 点缀色",
    note: "侧注上行|下行写代码或身份",
    stepMs: 500,
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
        { label: "左侧", value: "left" },
        { label: "居中", value: "center" },
        { label: "右侧", value: "right" },
      ],
    },
    {
      key: "chips",
      label: "名牌(一行一块:light/dark|名称|身份或EN,最多 3 块)",
      type: "textarea",
      rows: 3,
    },
    { key: "note", label: "侧注(上行|下行,写代码/头衔类小字)", type: "text" },
    { key: "stepMs", label: "逐块滑入间隔", type: "range", min: 0, max: 1500, step: 100, unit: "ms" },
    { key: "accent", label: "点缀色(黑牌身份行)", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: EntityChips,
};
