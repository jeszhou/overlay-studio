import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface MarkerHighlightParams {
  theme: "dark" | "light";
  position: "left" | "right";
  /** 文案,用 *关键词* 包住要划亮的词;不标就划亮整句,可标多个 */
  text: string;
  accent: string;
  /** 马克笔扫过时长(ms),按 SRT 卡点调 */
  sweepMs: number;
  offsetX?: number;
  offsetY?: number;
}

/* ── 缓动:一切是卡片时间 t 的纯函数,预览和逐帧导出完全一致 ── */
const tClamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const tProg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : tClamp((t - a) / (b - a)));
const tOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const tInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** 强调色 → rgb,逐帧算色(暗底令牌一致);旧值/未知值落到转变橙 */
function accentRgb(accent: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#f0a24f";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const tRgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** 拆文案:普通段 / *关键词* 段;一个关键词都没标时,整句当作关键词 */
function parseText(text: string): { kw: boolean; s: string }[] {
  const parts = text.split(/(\*[^*]+\*)/g).filter((p) => p !== "");
  const has = parts.some((p) => /^\*[^*]+\*$/.test(p));
  if (!has) return [{ kw: true, s: text }];
  return parts.map((p) => (/^\*[^*]+\*$/.test(p) ? { kw: true, s: p.slice(1, -1) } : { kw: false, s: p }));
}

/* ── 关键词马克笔高亮:
   文案浮现 → 半透明马克笔笔迹从左往右扫亮重点词(微微倾斜,像随手一划)→ 落笔后一道光从已划亮处扫过。
   只用行内样式,不依赖 hud.css;呼吸层用独立 translate/rotate 属性,不碰这里的 transform。 ── */
function MarkerHighlight({ params, playToken }: EffectProps<MarkerHighlightParams>) {
  const t = useCardElapsed(params as MarkerHighlightParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const sweepMs = Number(params.sweepMs) || 520;

  const acc = accentRgb(accent);
  const segs = parseText(params.text ?? "");

  // 时间线(秒):文案 0.08-0.5 浮现;0.45 起马克笔扫亮(时长 sweepMs);扫亮后一道光扫过
  const appear = tOutCubic(tProg(t, 0.08, 0.5));
  const textY = (1 - appear) * 16;
  const swStart = 0.45;
  const swDur = Math.max(0.15, sweepMs / 1000);
  const sweep = tInOutCubic(tProg(t, swStart, swStart + swDur)); // 马克笔揭示 0→1
  const shineP = tInOutCubic(tProg(t, swStart + swDur, swStart + swDur + 0.55)); // 扫光
  const shineX = -120 + shineP * 460;
  const shineOp = shineP > 0 && shineP < 1 ? Math.sin(shineP * Math.PI) : 0;
  const hidden = (100 * (1 - sweep)).toFixed(2);

  return (
    <div
      className={`hud mh hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div
        data-fx-role="group"
        style={{
          maxWidth: 900,
          fontSize: 66,
          lineHeight: 1.28,
          fontWeight: 700,
          letterSpacing: "0.01em",
          color: "var(--hud-ink)",
          opacity: appear,
          transform: `translateY(${textY.toFixed(2)}px)`,
        }}
      >
        {segs.map((seg, i) =>
          seg.kw ? (
            <span key={i} style={{ position: "relative", display: "inline-block", padding: "0 0.04em" }}>
              {/* 马克笔笔迹:半透明色块,从左往右揭示 */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: "-0.05em",
                  right: "-0.05em",
                  top: "0.12em",
                  bottom: "-0.04em",
                  borderRadius: "0.14em",
                  background: `linear-gradient(180deg, ${tRgba(acc, 0.6)} 0%, ${tRgba(acc, 0.42)} 100%)`,
                  transform: "rotate(-0.5deg)",
                  clipPath: `inset(0 ${hidden}% 0 0 round 0.14em)`,
                }}
              />
              {/* 扫光:只在已划亮的部分里过一道 */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: "-0.05em",
                  right: "-0.05em",
                  top: "0.12em",
                  bottom: "-0.04em",
                  borderRadius: "0.14em",
                  overflow: "hidden",
                  clipPath: `inset(0 ${hidden}% 0 0)`,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: "45%",
                    background:
                      "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
                    transform: `translateX(${shineX.toFixed(1)}%)`,
                    opacity: shineOp,
                  }}
                />
              </span>
              {seg.s}
            </span>
          ) : (
            <span key={i} style={{ whiteSpace: "pre-wrap" }}>
              {seg.s}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export const markerHighlightDef: EffectDef<MarkerHighlightParams> = {
  id: "marker-highlight",
  name: "MarkerHighlight",
  description: "关键词马克笔高亮  一句话,重点词被马克笔扫光划亮",
  tags: ["扫过点亮"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    text: "这件事的*关键*就在这一下",
    accent: "orange",
    sweepMs: 520,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
      ],
    },
    {
      key: "text",
      label: "文案(*关键词*会划亮)",
      type: "textarea",
      rows: 2,
      help: "用 *词* 包住要划亮的关键词,可多个;不标就划亮整句。",
    },
    { key: "accent", label: "马克笔颜色", type: "select", options: ACCENT_OPTIONS },
    { key: "sweepMs", label: "扫过时长", type: "range", min: 200, max: 1200, step: 20, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: MarkerHighlight,
};
