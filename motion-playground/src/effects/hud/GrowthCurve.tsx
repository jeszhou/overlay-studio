import { useId } from "react";
import type { EffectDef, EffectProps } from "../types";
import { useCountUp, useEnter, useProgress } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface GrowthCurveParams {
  theme: "dark" | "light";
  position: "left" | "right" | "center";
  /** 顶部 EN 等宽 kicker */
  kicker: string;
  /** kicker 中文小注(什么在增长) */
  kickerZh: string;
  /** 数据点,| 分隔,每个「标签 数值」 */
  points: string;
  /** 数值单位(张/条/万) */
  unit: string;
  /** 曲线画完时长(卡点用) */
  drawMs: number;
  /** 右下小注(数据口径/出处) */
  caption: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

interface Pt {
  label: string;
  value: number;
}

function parsePoints(raw: string): Pt[] {
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(.*?)\s+([\d.]+)$/);
      return m ? { label: m[1].trim(), value: parseFloat(m[2]) } : { label: seg, value: 0 };
    });
}

/** Catmull-Rom → 贝塞尔:平滑穿过每个数据点(不是折线) */
function smoothPath(nodes: { x: number; y: number }[]): string {
  if (nodes.length < 2) return "";
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 0; i < nodes.length - 1; i++) {
    const p0 = nodes[i - 1] ?? nodes[i];
    const p1 = nodes[i];
    const p2 = nodes[i + 1];
    const p3 = nodes[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * 增长曲线卡:平滑曲线从左到右动画画出,曲线下渐变面积,
 * 数据点跟着画到的位置依次亮起,右上角峰值滚动计数 —
 * "资产越攒越多/粉丝一路上涨"式的复利叙事一张卡讲完。
 */
function GrowthCurve({ params, playToken }: EffectProps<GrowthCurveParams>) {
  const { position, kicker, kickerZh, points, unit, drawMs, caption, accent } = params;
  const entered = useEnter(playToken);
  const gid = useId(); // 渐变 id 按实例唯一,两张同类卡同屏不串色
  // 曲线绘制进度与峰值计数走 JS 钩子:吃倍速,导出虚拟时间下逐帧准确
  const draw = useProgress(Math.max(400, drawMs), playToken);
  const pts = parsePoints(points);

  const W = 640;
  const H = 310;
  const padL = 40;
  const padR = 96;
  const padT = 30;
  const padB = 52;
  const values = pts.map((p) => p.value);
  const yMax = Math.max(...values, 1) * 1.14;
  const yMin = Math.min(...values, 0) * 0.82;
  const px = (i: number) => padL + (i / Math.max(pts.length - 1, 1)) * (W - padL - padR);
  const py = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const nodes = pts.map((p, i) => ({ x: px(i), y: py(p.value) }));
  const baseY = H - padB;
  const line = smoothPath(nodes);
  const area =
    line && nodes.length > 1
      ? `${line} L ${nodes[nodes.length - 1].x} ${baseY} L ${nodes[0].x} ${baseY} Z`
      : "";
  const peak = values.length ? Math.max(...values) : 0;
  const shownPeak = useCountUp(peak, Math.max(400, drawMs) + 300, playToken);

  return (
    <div
      className={`hud gcv hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="gcv-box">
        <div className="gcv-head">
          <div>
            {kicker && (
              <div className="gcv-kicker">
                <i />
                <span>{kicker}</span>
              </div>
            )}
            {kickerZh && <div className="gcv-kicker-zh">{kickerZh}</div>}
          </div>
          <div className="gcv-peak">
            {Math.round(shownPeak)}
            <em>{unit}</em>
          </div>
        </div>
        <svg className="gcv-svg" width={W} height={H} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--hud-acc)" }} stopOpacity={0.38} />
              <stop offset="100%" style={{ stopColor: "var(--hud-acc)" }} stopOpacity={0} />
            </linearGradient>
          </defs>
          {area && <path d={area} fill={`url(#${gid})`} opacity={draw} />}
          {line && (
            <path
              className="gcv-line"
              d={line}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
          )}
          {nodes.map((n, i) => {
            // 数据点跟着画到的位置亮(阈值压到 0.9,保证最后一点也能在画完前亮全)
            const at = (pts.length > 1 ? i / (pts.length - 1) : 0) * 0.9;
            const on = Math.max(0, Math.min(1, (draw - at) / 0.15));
            return (
              <g key={i} className="gcv-pt" opacity={on}>
                <text className="gcv-val" x={n.x} y={n.y - 18} textAnchor="middle">
                  {pts[i].value}
                </text>
                <circle className="gcv-dot" cx={n.x} cy={n.y} r={7 * (0.4 + 0.6 * on)} />
                <text className="gcv-lb" x={n.x} y={baseY + 30} textAnchor="middle">
                  {pts[i].label}
                </text>
              </g>
            );
          })}
        </svg>
        {caption && (
          <div className="gcv-cap" style={{ opacity: draw }}>
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

export const growthCurveDef: EffectDef<GrowthCurveParams> = {
  id: "growth-curve",
  vTier: "half",
  name: "GrowthCurve",
  description: "增长曲线 · 平滑曲线动画画出+渐变面积,峰值滚动计数",
  tags: ["生长描画", "滚动计数"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    kicker: "GROWTH · EN KICKER",
    kickerZh: "什么在增长写在这",
    points: "标签一 12|标签二 26|标签三 45|标签四 66",
    unit: "张",
    drawMs: 1600,
    caption: "小注写数据口径/出处",
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "居中", value: "center" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "kicker", label: "顶部 kicker(英文等宽)", type: "text" },
    { key: "kickerZh", label: "kicker 中文小注", type: "text" },
    { key: "points", label: "数据点(标签 数值,| 分隔)", type: "text" },
    { key: "unit", label: "峰值单位(张/条/万)", type: "text" },
    { key: "drawMs", label: "曲线画完时长(卡点用)", type: "range", min: 600, max: 5000, step: 100, unit: "ms" },
    { key: "caption", label: "右下小注(数据口径/出处)", type: "text" },
    { key: "accent", label: "强调色(曲线/面积)", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: GrowthCurve,
};
