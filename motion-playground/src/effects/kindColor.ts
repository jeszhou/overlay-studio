import { EFFECT_GROUPS } from "./registry";

/** 卡片"用途分组"配色:时间轴色块和左栏色点共用,一眼看出类型搭配 */
export const GROUP_COLORS: Record<string, string> = {
  常驻层: "#c2cad6",
  证据实证: "#7ed3a0",
  数据指标: "#5fa0fa",
  对比取舍: "#ef8e7d",
  金句观点: "#f87bac",
  步骤流程: "#45c6cf",
  信息结构: "#8f86ea",
  教程标注: "#b9b2ee",
  文字进场: "#d9c07f",
  人物锚定: "#f2a35f",
  "场景 · 运镜": "#e6a54a",
  "场景 · B-roll": "#8a93a6",
};

const KIND_COLOR = new Map<string, string>();
for (const g of EFFECT_GROUPS)
  for (const e of g.effects) KIND_COLOR.set(e.id, GROUP_COLORS[g.title] ?? "#9aa3b2");

export function kindColor(kind: string): string {
  return KIND_COLOR.get(kind) ?? "#9aa3b2";
}
