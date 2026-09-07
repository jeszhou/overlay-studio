/* 更新(git pull)会覆盖这个文件,不要直接改;要改请复制一份再引用。 */
import type { CSSProperties } from "react";

/** HUD 族共用的强调色映射(对应 hud.css 里的主题令牌) */
export const ACCENT_VAR: Record<string, string> = {
  pink: "var(--hud-blue)" /* 兼容旧值,渲染为蓝 */,
  blue: "var(--hud-blue)",
  teal: "var(--hud-blue)" /* 兼容旧值,渲染为蓝 */,
  violet: "var(--hud-blue)" /* 兼容旧值,渲染为蓝 */,
  lav: "var(--hud-blue)" /* 兼容旧值,渲染为蓝 */,
  alert: "var(--hud-alert)",
  green: "var(--hud-blue)" /* 兼容旧值,渲染为蓝 */,
  orange: "var(--hud-orange)",
};

/** 参数面板里"强调色"下拉的通用选项。
    语义制配色:观众能从颜色读出含义 —
    蓝=数据/里程碑 绿=达成/允许/已验证 红=否定/禁止 橙=转变/优先级 紫=引用/提问 */
export const ACCENT_OPTIONS = [
  { label: "数据蓝", value: "blue" },
  { label: "否定红", value: "alert" },
  { label: "转变橙", value: "orange" },
];

/** 主题下拉通用选项 */
export const THEME_OPTIONS = [
  { label: "🌞 亮底", value: "light" },
  { label: "🌙 暗底", value: "dark" },
];

/** 玻璃底默认值:默认无底,视觉与旧行为一致 */
export const GLASS_DEFAULTS = { glass: "none" as const, glassAlpha: 0.6 };

/** 玻璃底 class:none/未设时返回空串,不改变原布局 */
export function glassClass(glass?: string) {
  if (glass === "dark") return "hud-glass hud-glass--dark";
  if (glass === "light") return "hud-glass hud-glass--light";
  return "";
}

/** 玻璃底透明度 → CSS 变量 */
export function glassVars(alpha?: number): CSSProperties {
  return typeof alpha === "number"
    ? ({ "--hud-glass-alpha": alpha } as CSSProperties)
    : {};
}

/** 位置微调滑块(所有 HUD 卡通用),放在 controls 末尾 */
export const OFFSET_CONTROLS = [
  { key: "offsetX", label: "水平微调", type: "range", min: -700, max: 700, step: 10, unit: "px" },
  { key: "offsetY", label: "垂直微调", type: "range", min: -450, max: 450, step: 10, unit: "px" },
] as const;

/** 位置微调的默认值 */
export const OFFSET_DEFAULTS = { offsetX: 0, offsetY: 0 };

/** 把微调量转成锚点叠加用的 CSS 变量 */
export function offsetVars(p: { offsetX?: number; offsetY?: number }): CSSProperties {
  return {
    "--hud-ox": `${p.offsetX ?? 0}px`,
    "--hud-oy": `${p.offsetY ?? 0}px`,
  } as CSSProperties;
}

/**
 * 全局文字色 → CSS 令牌。
 * 只需要给一个主文字色,次要/更次要文字按同色自动降到 0.68 / 0.44 透明度 —— 免得
 * 每换一次配色都要调三个值,也保证主次对比关系不会被调乱。
 * 空值返回空对象 = 用主题自带的取值。
 *
 * 为什么要多写一份 `-doc` 变量:主题令牌是写在「舞台」和「逐卡主题」两层上的
 * (hud.css 里 `[data-card-theme="dark"]` 会在卡片自己身上重新定义 --hud-ink)。
 * 只在舞台上写 --hud-ink,带逐卡主题的卡会就地覆盖掉,全局色一点都落不下去
 * (没有一处文字跟着变)。所以令牌定义统一改成
 * `--hud-ink: var(--hud-ink-doc, 主题默认值)`,这里只需要把 `-doc` 一层挂在舞台上,
 * 各层重新定义时会自动接住它。--hud-ink/--hud-muted/--hud-faint 也照旧写一份,
 * 兜底卡片之外、不走主题令牌的文字。
 */
export function inkVars(ink?: string): Record<string, string> {
  if (!ink) return {};
  const m = /^#([0-9a-fA-F]{6})$/.exec(ink.trim());
  if (!m) return { ["--hud-ink"]: ink, ["--hud-ink-doc"]: ink };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const muted = `rgba(${r}, ${g}, ${b}, 0.68)`;
  const faint = `rgba(${r}, ${g}, ${b}, 0.44)`;
  return {
    ["--hud-ink"]: ink,
    ["--hud-muted"]: muted,
    ["--hud-faint"]: faint,
    ["--hud-ink-doc"]: ink,
    ["--hud-muted-doc"]: muted,
    ["--hud-faint-doc"]: faint,
  };
}
