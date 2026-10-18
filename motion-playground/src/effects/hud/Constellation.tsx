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
import { tProg, tInOutCubic, tOutBack } from "./ease";

export interface ConstellationParams {
  theme: "dark" | "light";
  position: "left" | "center" | "right";
  /** 小标题(星图下方的标注) */
  title: string;
  accent: string;
  /** 连线绘出时长(ms),按 SRT 卡点调 */
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

/** 固定星图布局:0 为中心枢纽,其余辐射 + 顶部弧 */
const NODES = [
  { x: 300, y: 210 },
  { x: 130, y: 110 },
  { x: 470, y: 120 },
  { x: 150, y: 330 },
  { x: 470, y: 340 },
  { x: 300, y: 70 },
];
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
  [2, 5],
];
const nodeStart = (i: number) => 0.1 + i * 0.12;

/* ── 星图连线:
   节点带过冲错峰弹入,连线用 stroke-dashoffset 逐条"画"出来,长成一张网络。
   整组 data-fx-role=group,呼吸层开启时整体微漂。 ── */
function Constellation({ params, playToken }: EffectProps<ConstellationParams>) {
  const t = useCardElapsed(params as ConstellationParams & { __t?: number; __start?: number }, playToken);
  const { position, accent } = params;
  const drawMs = Number(params.drawMs) || 500;
  const drawDur = Math.max(0.2, drawMs / 1000);
  const acc = accentRgb(accent);
  const titleOp = tProg(t, 0.1, 0.6);

  const lineStart = (a: number, b: number) => Math.max(nodeStart(a), nodeStart(b)) + 0.15;

  return (
    <div
      className={`hud cst hud-anchor hud-anchor--${position} is-in`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div data-fx-role="group" style={{ position: "relative", width: 600, height: 420 }}>
        {/* 连线(SVG) */}
        <svg width={600} height={420} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {EDGES.map(([a, b], j) => {
            const A = NODES[a];
            const B = NODES[b];
            const len = Math.hypot(B.x - A.x, B.y - A.y);
            const lp = tInOutCubic(tProg(t, lineStart(a, b), lineStart(a, b) + drawDur));
            return (
              <line
                key={j}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke={rgba(acc, 0.6)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={len}
                strokeDashoffset={len * (1 - lp)}
                opacity={lp > 0 ? 1 : 0}
              />
            );
          })}
        </svg>
        {/* 节点 */}
        {NODES.map((n, i) => {
          const ns = tOutBack(tProg(t, nodeStart(i), nodeStart(i) + 0.4));
          const hub = i === 0;
          const size = hub ? 22 : 14;
          return (
            <span
              key={i}
              style={{
                position: "absolute",
                left: n.x,
                top: n.y,
                width: size,
                height: size,
                borderRadius: "50%",
                background: hub
                  ? `radial-gradient(circle, #fff 0%, ${rgba(acc, 0.9)} 60%)`
                  : rgba(acc, 0.95),
                transform: `translate(-50%, -50%) scale(${ns.toFixed(3)})`,
                opacity: ns > 0 ? 1 : 0,
                boxShadow: `0 0 12px ${rgba(acc, 0.9)}, 0 0 28px ${rgba(acc, 0.5)}`,
              }}
            />
          );
        })}
        {/* 小标题 */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: -34,
            transform: "translateX(-50%)",
            fontSize: 20,
            letterSpacing: "0.28em",
            whiteSpace: "nowrap",
            color: "var(--hud-muted)",
            opacity: titleOp,
          }}
        >
          {params.title}
        </div>
      </div>
    </div>
  );
}

export const constellationDef: EffectDef<ConstellationParams> = {
  id: "constellation",
  name: "Constellation",
  description: "星图连线  节点错峰弹入、连线逐条画出,长成一张关系网",
  tags: ["生长描画", "聚散飞行"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    title: "全景",
    accent: "blue",
    drawMs: 500,
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
    { key: "title", label: "小标题", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "drawMs", label: "连线时长", type: "range", min: 200, max: 1500, step: 50, unit: "ms" },
    ...OFFSET_CONTROLS,
  ],
  Component: Constellation,
};
