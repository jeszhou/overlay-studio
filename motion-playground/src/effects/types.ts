import type { ComponentType } from "react";

/** 动效在画布里的落位:左侧 / 右侧 */
export type Side = "left" | "right";

/** 参数控件类型 */
export type Control =
  | {
      key: string;
      label: string;
      type: "range";
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | { key: string; label: string; type: "text" }
  | {
      key: string;
      label: string;
      type: "textarea";
      rows?: number;
      /** 语法速查表(多行预格式化文本):渲染成折叠面板,label 只留一句话 */
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: { label: string; value: string }[];
    }
  | { key: string; label: string; type: "toggle" }
  | { key: string; label: string; type: "color" };

/** 每个动效组件收到的属性:参数 + 一个用于重放动画的 token */
export interface EffectProps<P> {
  params: P;
  /** 每次「播放」自增,用来重启动画 */
  playToken: number;
}

/**
 * 视觉标签词汇表 · 描述「这张卡看起来怎么动」
 * 与 EFFECT_GROUPS 的分组(「这张卡是干什么的」)是两个正交维度:
 * 组是互斥的,每张卡只属于一个;标签可以有多个,跨组检索。
 */
export const VISUAL_TAGS = {
  // 运动机制 · 怎么动
  "滚动计数": "数字滚轮、递增计数",
  "逐条落位": "一条条依次出现并留下",
  "堆叠累积": "越堆越多、不消失",
  "生长描画": "线条/曲线/图形自己画出来",
  "对撞并置": "两个东西并排或对撞比较",
  "翻转轮换": "卡片翻面、词槽轮换",
  "聚散飞行": "元素飞聚或四散",
  "扫过点亮": "光/马克笔/对焦框扫过高亮",
  // 镜头空间 · 画面怎么变
  "推近定格": "镜头快推后定住",
  "3D 浮屏": "浮窗倾斜、立体展示",
  "取景重构": "人物缩框、留白给内容",
  // 质感氛围 · 看起来什么感觉
  "玻璃虚化": "毛玻璃、羽化、压暗底板",
  "光效发光": "光环、放射线、发光描边",
  "故障噪点": "glitch、乱码、扫描线",
  "粒子流场": "粒子、星轨、流体、点阵漂浮",
} as const;

/** 视觉标签(取自 VISUAL_TAGS 的键) */
export type VisualTag = keyof typeof VISUAL_TAGS;

/** 一个动效的完整定义 */
export interface EffectDef<P = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  defaults: P;
  controls: Control[];
  Component: ComponentType<EffectProps<P>>;
  /** HUD 族:组件自己用锚点定位,不放进左右槽;并启用主题底色 */
  selfPosition?: boolean;
  /** 视觉标签:这张卡「看起来怎么动」,可多个,用于跨组检索 */
  tags?: VisualTag[];
  /**
   * 竖版让位档:这张卡在场时,口播人像该退到哪(只在 9:16 竖版生效,横版忽略)。
   *   still 不让 = 小卡,整个待在上下安全带里,人不动(缺省值)
   *   half  半让 = 中型卡,人下沉到下方,上半屏让给特效
   *   full  全让 = 大卡,人缩成角落小窗,特效近乎占满
   * 同屏多张卡时取最重的一档(full > half > still)。
   *
   * **新卡必须显式写**,哪怕写的就是 "still" —— 类型上留成可选只为兼容豁免的老卡,
   * 实际由 `npm run check:vtier` 强制(名单 scripts/vtier-grandfathered.json)。
   * 不知道该写哪档就量一下(先 npm run dev):
   *     node scripts/measure-stage.mjs <effectId> --ratio v
   */
  vTier?: "still" | "half" | "full";
}
