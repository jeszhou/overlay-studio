import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
import { FxVideo } from "./MediaImg";
import { useStageRatio } from "../../stage";
import { focusCamGeom } from "./camGeom";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface FocusCardParams {
  theme: "dark" | "light";
  /** 全屏底色:米色 / 雾白 / 暗色 */
  bg: "cream" | "mist" | "dark";
  /** 口播缩到哪一侧(另一侧留白/放要点/自己叠动效卡) */
  side?: "left" | "right";
  /** 要点,| 分隔 */
  items: string;
  stepMs: number;
  /** 口播视频(H264):填了就把"满屏缩进左框"运镜直接烤进导出 */
  camSrc?: string;
  accent: string;
  showRing: boolean;
  /** 口播框位置微调(px,相对该侧默认落位) */
  camDX?: number;
  camDY?: number;
  /** 口播框大小(px) */
  camW?: number;
  camH?: number;
  offsetX?: number;
  offsetY?: number;
}

/** 导出模式下视频不自动播,由导出脚本逐帧 seek */
const IS_EXPORT =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("export") === "1";

/**
 * 人物聚焦卡:全屏纯色底,口播缩进左侧圆角方框,右侧要点胶囊逐条弹入。
 * 成片时口播轨放在动效层之上,按落位框缩放对齐(同 screen-demo 的用法)。
 */
function FocusCard({ params, playToken }: EffectProps<FocusCardParams>) {
  const { bg, side, items, stepMs, camSrc, accent, showRing, camDX, camDY, camW, camH } = params;
  const entered = useEnter(playToken);
  const parsed = items.split("|").map((s) => s.trim()).filter(Boolean);
  // 口播框几何走 camGeom 那一份 —— 预览(Canvas)和导出(这里)必须同源,
  // 以前两边各写一份,竖版改排版时只改了一处,人像和落位框就对不上了
  const g = focusCamGeom({ side, camDX, camDY, camW, camH }, useStageRatio());

  return (
    <div
      className={`hud fcd ${entered ? "is-in" : ""}`}
      data-bg={bg}
      data-side={side ?? "left"}
      style={{
        ["--hud-acc" as string]: ACCENT_VAR[accent],
        ["--fcd-x" as string]: `${g.x}px`,
        ["--fcd-y" as string]: `${g.y}px`,
        ["--fcd-w" as string]: `${g.w}px`,
        ["--fcd-h" as string]: `${g.h}px`,
        ...offsetVars(params),
      }}
    >
      <div className="fcd-bg" />

      {/* 口播烤入导出:满屏起步 → 缩进左框,接管无痕(仅导出渲染,预览走 PIP) */}
      {IS_EXPORT && camSrc && <FxVideo className="fcd-cam" src={camSrc} tStart={0} />}

      {/* 口播落位框:圆角方框,成片时口播画面对齐这里(已烤入则不显示) */}
      {showRing && !camSrc && <div className="fcd-ring" />}

      <div className="fcd-list">
        {parsed.map((label, i) => (
          <div
            className="fcd-chip"
            key={i}
            style={{ transitionDelay: `${520 + i * stepMs}ms` }}
          >
            <span className="fcd-ic">✦</span>
            <span className="fcd-lb">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const focusCardDef: EffectDef<FocusCardParams> = {
  id: "focus-card",
  name: "FocusCard",
  description: "人物聚焦运镜 · 口播缩进左框 + 要点逐条弹入",
  tags: ["取景重构", "逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    bg: "dark",
    side: "left",
    items: "本段要点一|本段要点二",
    stepMs: 600,
    camSrc: "",
    accent: "blue",
    showRing: true,
    camDX: 0,
    camDY: 0,
    camW: 700,
    camH: 700,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "bg",
      label: "底色",
      type: "select",
      options: [
        { label: "米色", value: "cream" },
        { label: "雾白", value: "mist" },
        { label: "暗色", value: "dark" },
      ],
    },
    {
      key: "side",
      label: "口播缩到哪侧",
      type: "select",
      options: [
        { label: "左侧(要点在右)", value: "left" },
        { label: "右侧(左侧留白,自己叠动效)", value: "right" },
      ],
    },
    { key: "items", label: "要点(| 分隔,空 = 留白)", type: "text" },
    { key: "camSrc", label: "口播视频(烤进导出)", type: "text" },
    { key: "stepMs", label: "每条间隔(卡点用)", type: "range", min: 200, max: 8000, step: 100, unit: "ms" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "showRing", label: "显示口播落位框", type: "toggle" },
    { key: "camDX", label: "口播框水平移动", type: "range", min: -1100, max: 1100, step: 10, unit: "px" },
    { key: "camDY", label: "口播框垂直移动", type: "range", min: -400, max: 600, step: 10, unit: "px" },
    { key: "camW", label: "口播框宽", type: "range", min: 300, max: 1200, step: 10, unit: "px" },
    { key: "camH", label: "口播框高", type: "range", min: 300, max: 1000, step: 10, unit: "px" },
    ...OFFSET_CONTROLS,
  ],
  Component: FocusCard,
};
