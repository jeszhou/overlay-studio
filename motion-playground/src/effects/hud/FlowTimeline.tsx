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
import { tProg, tInOutCubic, tOutBack, tClamp } from "./ease";

export interface FlowTimelineParams {
  theme: "dark" | "light";
  position: "left" | "center" | "right";
  /** 里程碑,用 / 分隔,最多 6 个 */
  labels: string;
  accent: string;
  /** 光点跑完全程时长(ms),按 SRT 卡点调 */
  travelMs: number;
  offsetX?: number;
  offsetY?: number;
}

function accentRgb(accent: string): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function splitLabels(labels: string): string[] {
  const arr = labels
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr.slice(0, 6) : ["起点", "终点"];
}

/* ── 流光时间轴:
   暗轨道 + 亮段随光点增长,发光光点沿线从左跑到右,每个里程碑被扫到就点亮 + 标签弹起。 ── */
function FlowTimeline({ params, playToken }: EffectProps<FlowTimelineParams>) {
  const t = useCardElapsed(params as FlowTimelineParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const travelMs = Number(params.travelMs) || 2200;
  const travelDur = Math.max(0.6, travelMs / 1000);
  const acc = accentRgb(accent);
  const labels = splitLabels(params.labels);
  const n = labels.length;

  const fadeIn = tProg(t, 0, 0.3);
  const travel = tInOutCubic(tProg(t, 0.2, 0.2 + travelDur));
  const dotXPct = 8 + travel * 84;
  const xOf = (i: number) => (n > 1 ? 8 + (i / (n - 1)) * 84 : 50);

  return (
    <div
      className={`hud ft hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div data-fx-role="group" style={{ position: "relative", width: 900, height: 190, opacity: fadeIn }}>
        {/* 轨道底(暗) */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "8%",
            right: "8%",
            top: 100,
            height: 3,
            background: "var(--hud-line, rgba(128,128,128,0.25))",
            borderRadius: 2,
          }}
        />
        {/* 已点亮段(亮,随光点增长) */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "8%",
            top: 100,
            height: 3,
            width: `${Math.max(0, dotXPct - 8).toFixed(1)}%`,
            background: `linear-gradient(90deg, ${rgba(acc, 0.5)}, ${rgba(acc, 0.95)})`,
            borderRadius: 2,
            boxShadow: `0 0 10px ${rgba(acc, 0.6)}`,
          }}
        />
        {/* 光点 */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${dotXPct.toFixed(1)}%`,
            top: 100,
            width: 16,
            height: 16,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, #fff 0%, ${rgba(acc, 0.9)} 60%)`,
            boxShadow: `0 0 16px ${rgba(acc, 0.9)}, 0 0 36px ${rgba(acc, 0.5)}`,
            opacity: tClamp(travel * 8),
          }}
        />
        {/* 里程碑节点 + 标签 */}
        {labels.map((lab, i) => {
          const xi = xOf(i);
          const np = tOutBack(tProg(dotXPct, xi, xi + 5));
          return (
            <span key={i}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: `${xi.toFixed(1)}%`,
                  top: 100,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  transform: `translate(-50%, -50%) scale(${np.toFixed(3)})`,
                  background:
                    np > 0.02
                      ? `radial-gradient(circle, #fff 0%, ${rgba(acc, 0.9)} 60%)`
                      : "var(--hud-line, rgba(128,128,128,0.4))",
                  boxShadow: `0 0 ${np * 14}px ${rgba(acc, 0.8 * np)}`,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: `${xi.toFixed(1)}%`,
                  top: 64,
                  transform: `translate(-50%, ${(1 - np) * 12}px)`,
                  fontSize: 22,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.04em",
                  color: "var(--hud-ink)",
                  opacity: tClamp(np * 1.5),
                }}
              >
                {lab}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const flowTimelineDef: EffectDef<FlowTimelineParams> = {
  id: "flow-timeline",
  name: "FlowTimeline",
  description: "流光时间轴  光点沿线跑过,里程碑逐个点亮弹标签",
  tags: ["生长描画", "扫过点亮"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    labels: "起步 / 加速 / 爆发 / 登顶",
    accent: "blue",
    travelMs: 2200,
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
    { key: "labels", label: "里程碑(用 / 分隔,最多 6 个)", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "travelMs", label: "跑完时长", type: "range", min: 800, max: 5000, step: 100, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: FlowTimeline,
};
