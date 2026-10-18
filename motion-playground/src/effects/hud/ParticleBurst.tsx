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
import { tProg, tOutCubic, tOutBack, tBell, hash01 } from "./ease";

export interface ParticleBurstParams {
  theme: "dark" | "light";
  position: "left" | "center" | "right";
  /** 爆点中心的高亮数字/词 */
  text: string;
  accent: string;
  /** 爆发时长(ms),按 SRT 卡点调 */
  burstMs: number;
  offsetX?: number;
  offsetY?: number;
}

function accentRgb(accent: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#f0a24f";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const N = 30;

/* ── 粒子爆点:
   中心词弹入(tOutBack 过冲)→ 径向粒子迸发 + 双冲击波环扩散 + 一帧白闪 → 词留驻发光。
   粒子用 hash01 定位,跨帧/跨预览导出稳定。 ── */
function ParticleBurst({ params, playToken }: EffectProps<ParticleBurstParams>) {
  const t = useCardElapsed(params as ParticleBurstParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const burstMs = Number(params.burstMs) || 700;
  const acc = accentRgb(accent);
  const accStr = acc.join(",");

  const core = tOutBack(tProg(t, 0.05, 0.42));
  const flash = tBell(tProg(t, 0.08, 0.34));
  const bStart = 0.1;
  const bDur = Math.max(0.2, burstMs / 1000);
  const p = tProg(t, bStart, bStart + bDur);

  return (
    <div
      className={`hud pb hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div data-fx-role="group" style={{ position: "relative", width: 420, height: 300 }}>
        {/* 冲击波环(两道,错开起爆) */}
        {[0, 1].map((k) => {
          const rp = tProg(t, bStart + k * 0.06, bStart + k * 0.06 + bDur * 1.15);
          const rs = 0.25 + 2.4 * tOutCubic(rp);
          const ro = (1 - rp) * 0.7;
          return (
            <span
              key={k}
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 220,
                height: 220,
                borderRadius: "50%",
                border: `${2 + (1 - rp) * 2}px solid ${rgba(acc, 0.9)}`,
                transform: `translate(-50%, -50%) scale(${rs.toFixed(3)})`,
                opacity: rp > 0 ? ro : 0,
              }}
            />
          );
        })}
        {/* 白闪 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 320,
            height: 320,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)",
            opacity: flash * 0.7,
          }}
        />
        {/* 径向粒子 */}
        {Array.from({ length: N }).map((_, i) => {
          const ang = (i / N) * Math.PI * 2 + (hash01(i) - 0.5) * 0.35;
          const spd = 120 + hash01(i + 100) * 170;
          const dr = spd * tOutCubic(p);
          const px = Math.cos(ang) * dr;
          const py = Math.sin(ang) * dr * 0.82;
          const size = 3 + hash01(i + 200) * 6;
          const c = i % 3 === 0 ? "255,255,255" : accStr;
          return (
            <span
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: size,
                height: size,
                borderRadius: "50%",
                background: `rgba(${c},1)`,
                opacity: p > 0 ? (1 - p) * 0.9 : 0,
                transform: `translate(calc(-50% + ${px.toFixed(1)}px), calc(-50% + ${py.toFixed(1)}px))`,
              }}
            />
          );
        })}
        {/* 核心高亮词 */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `translate(-50%, -50%) scale(${core.toFixed(3)})`,
            fontSize: 120,
            fontWeight: 900,
            lineHeight: 1,
            whiteSpace: "nowrap",
            color: "var(--hud-ink)",
            textShadow: `0 0 24px ${rgba(acc, 0.7)}, 0 0 60px ${rgba(acc, 0.4)}`,
          }}
        >
          {params.text}
        </div>
      </div>
    </div>
  );
}

export const particleBurstDef: EffectDef<ParticleBurstParams> = {
  id: "particle-burst",
  name: "ParticleBurst",
  description: "粒子爆点  关键数字/词迸发,径向粒子+冲击波+白闪",
  tags: ["聚散飞行"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    text: "翻 3 倍",
    accent: "orange",
    burstMs: 700,
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
    { key: "text", label: "中心词/数字", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "burstMs", label: "爆发时长", type: "range", min: 300, max: 1500, step: 50, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: ParticleBurst,
};
