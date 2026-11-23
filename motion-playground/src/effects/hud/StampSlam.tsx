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
import { tProg, tOutCubic, tBell, hash01 } from "./ease";

export interface StampSlamParams {
  theme: "dark" | "light";
  position: "left" | "center" | "right";
  /** 要砸下来的词 */
  text: string;
  accent: string;
  /** 落锤后震屏时长(ms),按 SRT 卡点调 */
  shakeMs: number;
  offsetX?: number;
  offsetY?: number;
}

/** 强调色 → rgb,逐帧算色(暗底令牌一致);未知值落到转变橙 */
function accentRgb(accent: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#f0a24f";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const DUST = 14;

/* ── 盖章锤砸:
   一个词从上方 2.6 倍快速砸到 1 倍 → 落地挤压回弹 → 高频震屏(幅度衰减)+ 底部溅尘。
   全部是 t 的纯函数,导出逐帧确定。 ── */
function StampSlam({ params, playToken }: EffectProps<StampSlamParams>) {
  const t = useCardElapsed(params as StampSlamParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const shakeMs = Number(params.shakeMs) || 400;
  const acc = accentRgb(accent);

  // 砸落:0.05→0.32 从 2.6 倍砸到 1 倍(自上方落下,带一点初倾角)
  const drop = tOutCubic(tProg(t, 0.05, 0.32));
  const slamScale = 2.6 - 1.6 * drop;
  const slamY = (1 - drop) * -70;
  const rot = (1 - drop) * -6;
  // 落地挤压:横向压扁、竖向抬升,再回正
  const squash = tBell(tProg(t, 0.32, 0.62));
  const sqX = squash * 0.16;
  const sqY = squash * -0.14;
  // 震屏:落地瞬间起,高频抖动、幅度随时间衰减
  const shakeT = tProg(t, 0.3, 0.3 + shakeMs / 1000);
  const env = shakeT > 0 ? 1 - shakeT : 0;
  const shakeX = Math.sin(t * 92) * env * 5;
  const shakeY = Math.cos(t * 74) * env * 4;
  // 印痕光晕(落定后亮起)+ 尘埃(落锤时从底部溅出)
  const glow = tOutCubic(tProg(t, 0.3, 0.8));
  const u = tProg(t, 0.3, 0.9);

  return (
    <div
      className={`hud ss hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div
        data-fx-role="group"
        style={{
          position: "relative",
          display: "inline-block",
          transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`,
        }}
      >
        {/* 印痕光晕 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "60%",
            width: "160%",
            height: "130%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(ellipse at center, ${rgba(acc, 0.55)} 0%, transparent 70%)`,
            filter: "blur(8px)",
            opacity: glow * 0.55,
          }}
        />
        {/* 印章词 */}
        <div
          style={{
            position: "relative",
            fontSize: 128,
            fontWeight: 900,
            lineHeight: 1.12,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            color: "var(--hud-ink)",
            transform: `translateY(${slamY.toFixed(2)}px) scale(${(slamScale + sqX).toFixed(3)}, ${
              (slamScale + sqY).toFixed(3)
            }) rotate(${rot.toFixed(2)}deg)`,
            transformOrigin: "bottom center",
            textShadow: `0 6px 30px ${rgba(acc, 0.4 * drop)}`,
          }}
        >
          {params.text}
        </div>
        {/* 尘埃 */}
        {Array.from({ length: DUST }).map((_, i) => {
          const r1 = hash01(i * 3 + 1);
          const r2 = hash01(i * 3 + 2);
          const r3 = hash01(i * 3 + 3);
          const side = r1 < 0.5 ? -1 : 1;
          const vx = side * (40 + 90 * r2);
          const up = 60 + 95 * r3;
          const px = vx * tOutCubic(u);
          const py = -up * u + 150 * u * u;
          const size = 3 + 5 * r2;
          return (
            <span
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                bottom: "3%",
                width: size,
                height: size,
                borderRadius: "50%",
                background: i % 4 === 0 ? rgba(acc, 1) : "var(--hud-ink)",
                opacity: u > 0 ? (1 - u) * 0.85 : 0,
                transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export const stampSlamDef: EffectDef<StampSlamParams> = {
  id: "stamp-slam",
  name: "StampSlam",
  description: "盖章锤砸  一个词从上方砸落,震屏+溅尘",
  tags: ["聚散飞行"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    text: "就这么定了",
    accent: "orange",
    shakeMs: 420,
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
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "shakeMs", label: "震屏时长", type: "range", min: 100, max: 900, step: 20, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: StampSlam,
};
