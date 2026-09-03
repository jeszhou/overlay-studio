/* 【这个文件每次更新都会被替换】你在这里改的东西,更新后不会自动保留,需要手工搬运。 */
import type { CSSProperties } from "react";

/** HUD 族共用的强调色映射(对应 hud.css 里的主题令牌) */
export const ACCENT_VAR: Record<string, string> = {
  pink: "var(--hud-blue)" /* 公开版:已裁掉的色降级成蓝 */,
  blue: "var(--hud-blue)",
  teal: "var(--hud-blue)" /* 公开版:已裁掉的色降级成蓝 */,
  violet: "var(--hud-blue)" /* 公开版:已裁掉的色降级成蓝 */,
  lav: "var(--hud-blue)" /* 公开版:已裁掉的色降级成蓝 */,
  alert: "var(--hud-alert)",
  green: "var(--hud-blue)" /* 公开版:已裁掉的色降级成蓝 */,
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

/** 皮肤下拉选项(对应 hud.css 里的 data-skin 令牌组;空 = 默认配色)。
 *
 *  想要自己的一套配色,两步:
 *    1) hud.css 里照默认那组令牌,复制一份改成 [data-skin="你的名字"] 的覆盖
 *       (暗/亮两个主题各写一组,只需覆盖要改的令牌,其余自动继承默认)
 *    2) 回到这里加一行 { label: "你的名字", value: "你的名字" }
 *  卡片一个都不用改 —— 卡里的颜色全部走 var(--hud-*),换令牌就换全场。 */
export const SKIN_OPTIONS = [{ label: "默认", value: "" }];

/** 风格骨架下拉选项(对应 hud.css 里的 data-style 令牌组;和皮肤正交:
 *  skin 换配色,style 换材质骨架 —— 圆角、描边、阴影、底纹这类"手感"。
 *
 *  本仓带一套 HUD 骨架。想长出第二套(比如手绘、纸质、拟物),两步:
 *    1) hud.css 末尾加一段 .stage[data-style="你的名字"] 的覆盖
 *    2) 回到这里加一行 { label: "你的名字", value: "你的名字" }
 *  同样不用碰任何卡片。 */
export const STYLE_OPTIONS = [{ label: "HUD", value: "" }];

/** 文字卡通用「玻璃底色」:黑/白/无 三选 + 透明度,字看不清就加一块垫底 */
export const GLASS_OPTIONS = [
  { label: "无", value: "none" },
  { label: "🌙 黑玻璃", value: "dark" },
  { label: "🌞 白玻璃", value: "light" },
];

/** 玻璃底默认值:默认无底,视觉与旧行为一致 */
export const GLASS_DEFAULTS = { glass: "none" as const, glassAlpha: 0.6 };

/** 玻璃底参数面板控件,放在 OFFSET_CONTROLS 前 */
export const GLASS_CONTROLS = [
  { key: "glass", label: "玻璃底色", type: "select", options: GLASS_OPTIONS },
  { key: "glassAlpha", label: "底色透明度(越小越透)", type: "range", min: 0.2, max: 1, step: 0.05, unit: "" },
] as const;

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
 * 空值返回空对象 = 用皮肤自带的取值。
 *
 * 为什么要多写一份 `-doc` 变量:主题/皮肤令牌是写在「舞台」和「逐卡主题」两层上的
 * (hud.css 里 `[data-card-theme="dark"]` 会在卡片自己身上重新定义 --hud-ink)。
 * 只在舞台上写 --hud-ink,带逐卡主题的卡会就地覆盖掉,全局色一点都落不下去
 * (实测:0/16 处文字跟随)。所以令牌定义统一改成
 * `--hud-ink: var(--hud-ink-doc, 皮肤默认值)`,这里只需要把 `-doc` 一层挂在舞台上,
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
