/* 更新(git pull)会覆盖这个文件,不要直接改;要改请复制一份。
   想调整动效卡,请改卡片组件本身,不要改这里。 */
import type { EffectDef } from "./types";
import { quoteLockupDef } from "./QuoteLockup";
import { stepTimelineDef } from "./hud/StepTimeline";
import { rankBarsDef } from "./hud/RankBars";
import { punchPillDef } from "./hud/PunchPill";
import { termCardDef } from "./hud/TermCard";
import { checklistDef } from "./hud/Checklist";
import { terminal3DDef } from "./hud/Terminal3D";
import { ringMetricDef } from "./hud/RingMetric";
import { versusCardDef } from "./hud/VersusCard";
import { uiCalloutDef } from "./hud/UICallout";
import { typeShiftDef } from "./hud/TypeShift";
import { blurTextDef } from "./hud/BlurText";
import { odometerDef } from "./hud/Odometer";
import { focusCardDef } from "./hud/FocusCard";
import { chapterBarDef } from "./hud/ChapterBar";
import { captionTrackDef } from "./hud/CaptionTrack";
import { statProofDef } from "./hud/StatProof";
import { growthCurveDef } from "./hud/GrowthCurve";
import { entityChipsDef } from "./hud/EntityChips";
import { pinBoardDef } from "./hud/PinBoard";

/** 按用途分组:同组内是"同一类需求的可选项",挑一张用即可 */
export interface EffectGroup {
  title: string;
  effects: EffectDef<any>[];
}

export const EFFECT_GROUPS: EffectGroup[] = [
  {
    /* 全程在场的层:一张卡从 0 拉到视频结尾,让画面没有一帧"没人管" */
    title: "常驻层",
    effects: [chapterBarDef, pinBoardDef, captionTrackDef],
  },
  {
    /* 证据实证:观点用真素材/真数字背书,语义可视化的核心 */
    title: "证据实证",
    effects: [statProofDef],
  },
  {
    title: "数据指标",
    effects: [ringMetricDef, odometerDef, rankBarsDef, growthCurveDef],
  },
  {
    title: "对比取舍",
    effects: [versusCardDef],
  },
  {
    title: "金句观点",
    effects: [quoteLockupDef, punchPillDef],
  },
  {
    title: "步骤流程",
    effects: [stepTimelineDef, checklistDef],
  },
  {
    title: "教程标注",
    effects: [termCardDef, uiCalloutDef],
  },
  {
    title: "文字进场",
    effects: [blurTextDef, typeShiftDef],
  },
  {
    /* 人物锚定:效果直接"碰"人物 */
    title: "人物锚定",
    effects: [entityChipsDef],
  },
  {
    title: "场景 · 运镜",
    effects: [focusCardDef],
  },
  {
    title: "场景 · B-roll",
    effects: [terminal3DDef],
  },
];

// 平铺列表(消费端按 id 取用;id 即 overlay JSON 的 kind)
export const EFFECTS: EffectDef<any>[] = EFFECT_GROUPS.flatMap((g) => g.effects);
