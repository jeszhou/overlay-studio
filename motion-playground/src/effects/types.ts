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
  "3D 浮屏": "浮窗倾斜、立体展示",
  "取景重构": "人物缩框、留白给内容",
  // 质感氛围 · 看起来什么感觉
  "玻璃虚化": "毛玻璃、羽化、压暗底板",
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
}
