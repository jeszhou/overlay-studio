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
import { tProg, tInOutCubic, tBell } from "./ease";

export interface NeonTraceParams {
  theme: "dark" | "light";
  position: "left" | "center" | "right";
  /** 要霓虹亮起的词 */
  text: string;
  accent: string;
  /** 描边绘出时长(ms),按 SRT 卡点调 */
  drawMs: number;
  offsetX?: number;
  offsetY?: number;
}

function accentRgb(accent: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* ── 霓虹光绘:
   空心描边 + 发光,clipPath 从左到右"自己画出来"(带一道移动的光笔前缘)
   → 点亮瞬间电流抖动 → 转入缓慢的霓虹呼吸。 ── */
function NeonTrace({ params, playToken }: EffectProps<NeonTraceParams>) {
  const t = useCardElapsed(params as NeonTraceParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const drawMs = Number(params.drawMs) || 900;
  const acc = accentRgb(accent);

  const dEnd = 0.1 + drawMs / 1000;
  const draw = tInOutCubic(tProg(t, 0.1, dEnd)); // 左→右绘出
  // 点亮后短暂电流抖动,再转入缓慢呼吸
  const flk = tProg(t, dEnd, dEnd + 0.3);
  const flick = flk > 0 && flk < 1 ? 1 - 0.45 * Math.abs(Math.sin(t * 46)) * tBell(flk) : 1;
  const breathe = 0.82 + 0.18 * Math.sin(t * 2.2);
  const glow = draw * flick * (flk >= 1 ? breathe : 1);

  const leadX = draw * 100;
  const leading = draw > 0 && draw < 1;

  return (
    <div
      className={`hud nt hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div data-fx-role="group" style={{ position: "relative", display: "inline-block", padding: "0.15em 0.3em" }}>
        {/* 底层柔光(点亮后渐显) */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: "110%",
            height: "120%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(ellipse at center, ${rgba(acc, 0.5)} 0%, transparent 70%)`,
            filter: "blur(14px)",
            opacity: draw * 0.5,
          }}
        />
        {/* 霓虹描边文字:空心描边 + 发光,clipPath 从左到右绘出 */}
        <div
          style={{
            position: "relative",
            fontSize: 132,
            fontWeight: 900,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            letterSpacing: "0.02em",
            color: rgba(acc, 0.16 * draw),
            WebkitTextStroke: `2.5px ${rgba(acc, 0.95)}`,
            clipPath: `inset(0 ${(100 * (1 - draw)).toFixed(2)}% 0 0)`,
            opacity: flick,
            textShadow: `0 0 10px ${rgba(acc, 0.9 * glow)}, 0 0 28px ${rgba(acc, 0.6 * glow)}, 0 0 64px ${rgba(
              acc,
              0.4 * glow,
            )}`,
          }}
        >
          {params.text}
        </div>
        {/* 光笔前缘:正在画到的那一道亮光 */}
        {leading && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "8%",
              bottom: "8%",
              left: `${leadX.toFixed(1)}%`,
              width: 4,
              transform: "translateX(-50%)",
              background: `linear-gradient(180deg, transparent, ${rgba(acc, 0.95)} 30%, #ffffff 50%, ${rgba(
                acc,
                0.95,
              )} 70%, transparent)`,
              boxShadow: `0 0 16px ${rgba(acc, 0.9)}`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export const neonTraceDef: EffectDef<NeonTraceParams> = {
  id: "neon-trace",
  name: "NeonTrace",
  description: "霓虹光绘  描边自己画出来,点亮后电流抖+霓虹呼吸",
  tags: ["生长描画", "扫过点亮"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    text: "下一站",
    accent: "blue",
    drawMs: 900,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "居中", value: "center" },
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "text", label: "词", type: "text" },
    { key: "accent", label: "霓虹色", type: "select", options: ACCENT_OPTIONS },
    { key: "drawMs", label: "绘出时长", type: "range", min: 400, max: 2000, step: 50, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: NeonTrace,
};
