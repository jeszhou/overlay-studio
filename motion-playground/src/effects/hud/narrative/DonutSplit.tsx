import type { EffectDef, EffectProps } from "../../types";
import {
  cues,
  enterStyle,
  lerp,
  NV_BASE_DEFAULTS,
  NvKicker,
  NvPlate,
  NvRoot,
  nvControls,
  outBack,
  outCubic,
  px,
  rich,
  springAt,
  useNvTime,
  type NvBaseParams,
} from "./kit";
import { fmtNum, parseRows, toneColor } from "./dataKit";
import { secList } from "./kit";

export interface DonutSplitParams extends NvBaseParams {
  countUnit: string;
  kickerEn: string;
  kickerZh: string;
  title: string;
  /** 一行一项:名称:数值(2–6 项) */
  items: string;
  unit: string;
  /** 聚焦前圆心显示的字 */
  centerLabel: string;
  /** 开始画环 */
  times: string;
  /** 每项被念到的秒(| 分隔,空 = 不逐项聚焦) */
  focusTimes: string;
}

const C = 130;
const R_OUT = 104;
const R_IN = 70;
const GAP = 0.035; // 段间缝(弧度)

const pt = (a: number, r: number) => ({ x: C + r * Math.sin(a), y: C - r * Math.cos(a) });

function arc(a0: number, a1: number, ro: number, ri: number) {
  if (a1 - a0 < 0.002) return "";
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = pt(a0, ro);
  const o1 = pt(a1, ro);
  const i1 = pt(a1, ri);
  const i0 = pt(a0, ri);
  const f = (v: number) => v.toFixed(2);
  return `M${f(o0.x)} ${f(o0.y)}A${ro} ${ro} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)}L${f(i1.x)} ${f(i1.y)}A${ri} ${ri} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)}Z`;
}

function DonutSplit({ params, playToken }: EffectProps<DonutSplitParams>) {
  const { t, sp, act } = useNvTime(params, playToken);
  const [tDraw] = cues(params.times, [0.4]);
  const rows = parseRows(params.items).slice(0, 6);
  const vals = rows.map((r) => Math.max(0, r.nums[0] || 0));
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  const n = rows.length;
  const focus = secList(params.focusTimes).slice(0, n);

  // 当前聚焦第几项(-1 = 还没开始聚焦)
  let fi = -1;
  focus.forEach((ft, i) => {
    if (Number.isFinite(ft) && t >= ft) fi = i;
  });
  const fStart = fi >= 0 ? focus[fi] : 0;
  const pop = fi >= 0 ? springAt((t - fStart) * sp, 16, 8) : 0;
  const prevPct = fi > 0 ? (vals[fi - 1] / sum) * 100 : 0;
  const curPct = fi >= 0 ? (vals[fi] / sum) * 100 : 0;
  const shownPct = lerp(prevPct, curPct, outCubic(act(fStart, 0.5)));

  // 分段起止角
  let acc = 0;
  const segs = vals.map((v) => {
    const a0 = (acc / sum) * Math.PI * 2;
    acc += v;
    return { a0, a1: (acc / sum) * Math.PI * 2 };
  });

  // 环外的指示点:滑到聚焦段的中线
  const midOf = (i: number) => (segs[i].a0 + segs[i].a1) / 2;
  const prevMid = fi > 0 ? midOf(fi - 1) : fi === 0 ? midOf(0) - 0.6 : 0;
  const dotA = fi >= 0 ? lerp(prevMid, midOf(fi), springAt((t - fStart) * sp, 13, 6)) : 0;
  const dotIn = fi >= 0 ? outBack(act(focus[0], 0.4)) : 0;

  const enter = act(0, 0.5);
  const drawDur = 1.3;
  const ticks = Array.from({ length: 60 }, (_, i) => i);

  return (
    <NvRoot params={params} className="nv-dn">
      <NvPlate className="nv-dn-plate" style={enterStyle(enter)}>
        <NvKicker en={params.kickerEn} zh={params.kickerZh} />
        <div className="nv-dn-title">{rich(params.title)}</div>
        <div className="nv-dn-row">
          <div className="nv-dn-ring">
            <svg width={2 * C} height={2 * C} viewBox={`0 0 ${2 * C} ${2 * C}`} aria-hidden>
              {/* 外圈细刻度,整体缓慢自转一点点 */}
              <g transform={`rotate(${(t * 4).toFixed(2)} ${C} ${C})`}>
                {ticks.map((i) => {
                  const a = (i / 60) * Math.PI * 2;
                  const p0 = pt(a, 120);
                  const p1 = pt(a, i % 5 === 0 ? 126 : 123);
                  return <line key={i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="nv-dn-tick" style={{ opacity: outCubic(act(0.1 + i * 0.008, 0.3)) }} />;
                })}
              </g>
              <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} strokeWidth={R_OUT - R_IN} className="nv-dn-track" style={{ opacity: outCubic(act(0.1, 0.4)) }} />
              {segs.map((s, i) => {
                // 各段依次顺时针长出来,前一段长到一半下一段就起
                const start = tDraw + ((s.a0 / (Math.PI * 2)) * drawDur) / sp;
                const len = ((s.a1 - s.a0) / (Math.PI * 2)) * drawDur;
                const g = outCubic(act(start, Math.max(0.18, len * 1.4)));
                const a0 = s.a0 + GAP / 2;
                const a1 = a0 + Math.max(0, s.a1 - s.a0 - GAP) * g;
                const on = fi === i;
                const dim = fi >= 0 && !on ? 0.38 : 1;
                const lift = on ? 9 * pop : 0;
                const mid = midOf(i);
                return (
                  <path
                    key={i}
                    d={arc(a0, a1, R_OUT + (on ? 8 * pop : 0), R_IN)}
                    fill={toneColor(i, n)}
                    transform={`translate(${(lift * Math.sin(mid)).toFixed(2)} ${(-lift * Math.cos(mid)).toFixed(2)})`}
                    style={{
                      opacity: dim,
                      filter: on ? `drop-shadow(0 0 ${px(14 * pop)} color-mix(in srgb, var(--hud-acc) 55%, transparent))` : undefined,
                    }}
                  />
                );
              })}
              {dotIn > 0 && (
                <circle cx={pt(dotA, 136).x} cy={pt(dotA, 136).y} r={5 * dotIn} className="nv-dn-dot" />
              )}
            </svg>
            <div className="nv-dn-center">
              {fi < 0 ? (
                <div style={{ opacity: outCubic(act(tDraw + 0.3, 0.4)) }}>
                  <span>{params.centerLabel}</span>
                  <b className="nv-mono">{n}<small>{params.countUnit}</small></b>
                </div>
              ) : (
                <div key={fi} style={{ opacity: outCubic(act(fStart, 0.25)), transform: `translateY(${px(8 * (1 - outCubic(act(fStart, 0.3))))})` }}>
                  <span>{rows[fi].name}</span>
                  <b className="nv-mono">
                    {fmtNum(shownPct, shownPct < 10 ? 1 : 0)}
                    <small>%</small>
                  </b>
                </div>
              )}
            </div>
          </div>

          <div className="nv-dn-legend">
            {rows.map((r, i) => {
              const inP = outCubic(act(tDraw + 0.2 + i * 0.12, 0.45));
              const on = fi === i;
              return (
                <div
                  key={i}
                  className={`nv-dn-item ${on ? "is-on" : ""}`}
                  style={{
                    opacity: inP * (fi >= 0 && !on ? 0.45 : 1),
                    transform: `translateX(${px(18 * (1 - inP) + (on ? 6 * pop : 0))})`,
                  }}
                >
                  <i style={{ background: toneColor(i, n) }} />
                  <span>{r.name}</span>
                  <b className="nv-mono">
                    {r.raw[0]}
                    {params.unit}
                  </b>
                </div>
              );
            })}
          </div>
        </div>
      </NvPlate>
    </NvRoot>
  );
}

export const donutSplitDef: EffectDef<DonutSplitParams> = {
  id: "donut-split",
  name: "DonutSplit",
  description: "环形占比 · 各段顺时针依次长出成一个环,念到哪项那段外弹发光、其余压暗,圆心切换成这一项的占比,环外小圆点滑过去指着",
  tags: ["生长描画", "扫过点亮", "滚动计数"],
  selfPosition: true,
  defaults: {
    ...NV_BASE_DEFAULTS,
    countUnit: " 项",
    kickerEn: "BREAKDOWN",
    kickerZh: "构成",
    title: "环形占比:讲清*由哪几块*组成",
    items: "念到哪块亮哪块:42|其余自动压暗:26|圆心显示占比:18|其他:14",
    unit: "%",
    centerLabel: "共",
    times: "0.4",
    focusTimes: "2.2|3.2|4.2|5.2",
  },
  controls: nvControls([
    { key: "kickerEn", label: "眉题英文", type: "text" },
    { key: "kickerZh", label: "眉题中文", type: "text" },
    { key: "title", label: "标题(*词* 强调)", type: "text" },
    { key: "items", label: "条目(一行一项:名称:数值,2–6 项)", type: "textarea", rows: 5 },
    { key: "unit", label: "图例数值后的单位", type: "text" },
    { key: "centerLabel", label: "聚焦前圆心的字", type: "text" },
    { key: "times", label: "开始画环(秒)", type: "text" },
    { key: "countUnit", label: "圆心条目数的单位", type: "text" },
    { key: "focusTimes", label: "每项念到的秒(| 分隔,空 = 不聚焦)", type: "text" },
  ]),
  Component: DonutSplit,
};
