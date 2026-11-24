import type { CSSProperties, ReactNode } from "react";
import { ACCENT_OPTIONS, ACCENT_VAR, OFFSET_CONTROLS, OFFSET_DEFAULTS, offsetVars, THEME_OPTIONS } from "../accent";
import { useCardElapsed, usePlateSpeed } from "../useTimelineTime";
export function secList(v?: string): number[] {
  return (v ?? "")
    .split("|")
    .filter((x) => x.trim() !== "")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x));
}
import type { Control } from "../../types";

/**
 * 叙事卡底座(2026-10 新动效批次共用)。
 *
 * 一张叙事卡 = 一个讲清一件事的小场景,画面全是时间 t 的纯函数(预览和导出同一帧一致)。
 * 这里只放所有卡都要的东西:根节点(锚点/强调色/主题/微调)、深色底板、眉题、时间工具。
 * 每张卡自己的版式和动法写在自己的文件里,样式类名用各自的前缀,公共类一律 nv- 开头。
 */

export type NvPosition = "left" | "center" | "right";

export interface NvBaseParams {
  theme?: "dark" | "light";
  position?: NvPosition;
  accent?: string;
  offsetX?: number;
  offsetY?: number;
  /** 整屏卡(NvStage)的垫底:不垫 / 压暗口播 / 满屏底色 */
  backdrop?: "none" | "dim" | "solid";
  __t?: number;
  __start?: number;
}

export const NV_BASE_DEFAULTS = {
  theme: "dark" as const,
  position: "left" as NvPosition,
  accent: "orange",
  ...OFFSET_DEFAULTS,
};

const POSITION_LABEL: Record<NvPosition, string> = { left: "左列", center: "居中", right: "右侧" };

/** 通用控件:主题 / 落位 / 强调色 / 微调。卡自己的控件放在中间。 */
export function nvControls(own: Control[], positions: NvPosition[] = ["left", "center", "right"]): Control[] {
  return [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    { key: "position", label: "落位", type: "select", options: positions.map((p) => ({ label: POSITION_LABEL[p], value: p })) },
    ...own,
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...(OFFSET_CONTROLS as unknown as Control[]),
  ];
}

/**
 * 卡内时间:t = 进场秒数;sp = 动画速度倍数。
 * 卡点时刻(times)不随 sp 变,卡点之后的动作时长除以 sp —— 动作变快,踩台词的时刻不变。
 */
export function useNvTime(params: NvBaseParams, playToken: number) {
  const t = useCardElapsed(params, playToken);
  const sp = usePlateSpeed();
  /** 从 at 秒开始、持续 dur 秒(按速度缩放)的 0→1 进度 */
  const act = (at: number, dur: number) => clamp01(((t - at) * sp) / Math.max(0.001, dur));
  return { t, sp, act };
}

/** 卡点列表:"0.4|1.2|2" 或 "0.4/1.2/2";缺的位置用 fallback 补 */
export function cues(times: string | undefined, fallback: number[], speed = 1): number[] {
  const got = secList(times);
  return fallback.map((f, i) => {
    const at = Number.isFinite(got[i]) ? got[i] : f;
    // 用动画时钟比较时也要换算卡点；负数是「不收走」等开关。
    return at < 0 ? at : at * speed;
  });
}

/** 文本列表:按 | 或换行切,去空 */
export function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 显式台词卡点，换算到卡片的动画时钟。 */
export function cueList(value: string | undefined, speed: number): number[] {
  return list(value).map(Number).filter(Number.isFinite).map(at => at * speed);
}

/** `*重点*` → 强调色 span */
export function rich(text: string): ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return parts.map((p, i) =>
    p.startsWith("*") && p.endsWith("*") ? (
      <em key={i} className="nv-hi">
        {p.slice(1, -1)}
      </em>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/* ── 缓动 ── */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const outCubic = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);
export const inCubic = (p: number) => Math.pow(clamp01(p), 3);
export const inOutCubic = (p: number) => {
  const q = clamp01(p);
  return q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
};
export const outBack = (p: number, s = 1.6) => {
  const q = clamp01(p) - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
};
/** 阻尼弹簧:dt 秒后 0→1,带过冲 */
export const springAt = (dt: number, w = 18, z = 7) => (dt <= 0 ? 0 : 1 - Math.exp(-dt * z) * Math.cos(dt * w));
/** 衰减摆动:在 0 附近摆,幅度 1 起 */
export const wobbleAt = (dt: number, w = 22, z = 6) => (dt <= 0 ? 0 : Math.exp(-dt * z) * Math.sin(dt * w));
export const px = (v: number) => `${v.toFixed(1)}px`;

/** 进场:上浮 + 淡入 + 轻微放大(所有叙事卡统一的入场手感) */
export function enterStyle(p: number): CSSProperties {
  const e = outCubic(p);
  return { opacity: e, transform: `translateY(${px(24 * (1 - e))}) scale(${(0.96 + 0.04 * e).toFixed(4)})` };
}

/* ── 根节点 ── */

/* ── 整屏叙事卡外壳(2026-11-21) ──
 * 版式按舞台坐标摆的整屏卡用这个当根:
 * - 内容层吃位置微调(--hud-ox/oy,画布拖拽写的就是它)和整卡缩放(--hud-scale),所以能拖、能改大小;
 * - 内容层外面可以垫一层:不垫 / 压暗口播 / 满屏底色,内容卡就能变成全屏卡;
 * - 整层鼠标穿透,只有各卡在自己样式文件末尾登记的主要元素能点中拖动,空白处不挡别的卡。
 */
export type NvBackdrop = NonNullable<NvBaseParams["backdrop"]>;

/** 位置微调 / 大小由编辑台通用控件提供(这里不重复加) */
export const NV_STAGE_DEFAULTS = { backdrop: "none" as NvBackdrop, ...OFFSET_DEFAULTS };

export const NV_STAGE_CONTROLS: Control[] = [
  {
    key: "backdrop",
    label: "垫底(压暗口播 / 满屏底色 = 变成全屏卡)",
    type: "select",
    options: [
      { label: "不垫(叠在口播上)", value: "none" },
      { label: "压暗口播", value: "dim" },
      { label: "满屏底色", value: "solid" },
    ],
  },
];

export function NvStage({
  params,
  className,
  style,
  defaultTheme = "dark",
  children,
}: {
  params: NvBaseParams & { backdrop?: NvBackdrop };
  className: string;
  style?: CSSProperties;
  defaultTheme?: "dark" | "light";
  children: ReactNode;
}) {
  const theme = params.theme === "light" || params.theme === "dark" ? params.theme : defaultTheme;
  const bd = params.backdrop ?? "none";
  return (
    <div data-fx-role="group" data-nv-theme={theme} className={`hud nv nv-stagefx-root ${className}`} style={style}>
      {bd !== "none" && <div className={`nv-backdrop is-${bd}`} />}
      <div className="nv-stagefx" style={offsetVars(params)}>
        {children}
      </div>
    </div>
  );
}

export function NvRoot({
  params,
  className,
  children,
  style,
}: {
  params: NvBaseParams;
  className: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const position = params.position ?? "left";
  return (
    <div
      data-fx-role="group"
      data-nv-theme={params.theme === "light" ? "light" : "dark"}
      className={`hud nv ${className} hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[params.accent ?? "orange"] ?? ACCENT_VAR.orange, ...offsetVars(params), ...style }}
    >
      {children}
    </div>
  );
}

/** 深色底板。精修·无底板(bare)时去底,靠投影托字 */
export function NvPlate({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`nv-plate ${className}`} style={style}>
      {children}
    </div>
  );
}

/** 眉题:强调色小圆点 + mono 英文 + 中文小字 */
export function NvKicker({ en, zh, style }: { en?: string; zh?: string; style?: CSSProperties }) {
  if (!en && !zh) return null;
  return (
    <div className="nv-kicker" data-small-text="kicker" style={style}>
      <i className="nv-dot" />
      {en && <span className="nv-kicker-en">{en}</span>}
      {zh && <span className="nv-kicker-zh">{zh}</span>}
    </div>
  );
}

/** 头像:有图用图,没图用首字 */
export function NvAvatar({ src, name, size = 56 }: { src?: string; name?: string; size?: number }) {
  return (
    <span className="nv-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {src ? <img src={src} alt="" /> : <b>{(name ?? "?").trim().slice(0, 1)}</b>}
    </span>
  );
}
