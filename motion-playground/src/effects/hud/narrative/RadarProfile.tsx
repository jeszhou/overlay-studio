import type { EffectDef, EffectProps } from "../../types";
import {
  clamp01,
  cues,
  enterStyle,
  lerp,
  list,
  NV_BASE_DEFAULTS,
  NvKicker,
  NvPlate,
  NvRoot,
  nvControls,
  outBack,
  outCubic,
  rich,
  springAt,
  useNvTime,
  type NvBaseParams,
} from "./kit";
import { fmtNum } from "./dataKit";

export interface RadarProfileParams extends NvBaseParams {
  kickerEn: string;
  kickerZh: string;
  title: string;
  /** 维度名,| 分隔(3–10 个) */
  axes: string;
  nameA: string;
  valuesA: string;
  /** 对比对象(空 = 不对比) */
  nameB: string;
  valuesB: string;
  /** 满分 */
  max: number;
  /** A 长出 | B 叠上 | 差距最大的轴闪 */
  times: string;
}

const SW = 520;
const SH = 360;
const C = { x: SW / 2, y: SH / 2 + 4 };
const R = 124;
const RINGS = 4;

function RadarProfile({ params, playToken }: EffectProps<RadarProfileParams>) {
  const { t, sp, act } = useNvTime(params, playToken);
  const [tA, tB, tGap] = cues(params.times, [0.5, 1.9, 3.1]);
  const axes = list(params.axes).slice(0, 10);
  while (axes.length < 3) axes.push(`维度 ${axes.length + 1}`);
  const N = axes.length;
  const max = Number(params.max) > 0 ? Number(params.max) : 100;
  const nums = (s: string) => list(s).map((v) => Number(v) || 0);
  const va = axes.map((_, i) => nums(params.valuesA)[i] ?? 0);
  const hasB = !!params.nameB?.trim();
  const vb = axes.map((_, i) => nums(params.valuesB)[i] ?? 0);

  const ang = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;
  const at = (i: number, r: number) => ({ x: C.x + r * Math.cos(ang(i)), y: C.y + r * Math.sin(ang(i)) });

  // 网格:整体从 -24° 转进来、轻微放大到位
  const gridP = outCubic(act(0.1, 0.8));
  const gridRot = -24 * (1 - gridP);

  // 每个顶点各自弹出去,错开一点,带过冲
  const radii = (vals: number[], t0: number) =>
    vals.map((v, i) => clamp01(v / max) * R * Math.max(0, springAt((t - t0) * sp - i * 0.07, 12, 6)));
  const ra = radii(va, tA);
  const rb = hasB ? radii(vb, tB) : [];
  const poly = (rs: number[]) =>
    rs.map((r, i) => at(i, Math.max(0, r))).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";

  // 差距最大的轴
  let gi = -1;
  if (hasB) {
    let best = -1;
    va.forEach((a, i) => {
      const d = Math.abs(a - vb[i]);
      if (d > best) {
        best = d;
        gi = i;
      }
    });
  }
  const gapP = gi >= 0 ? act(tGap, 0.5) : 0;
  // 闪三下,越闪越弱
  const gdt = (t - tGap) * sp;
  const flash = gapP > 0 ? 0.5 + 0.5 * Math.cos(gdt * 14) * Math.exp(-gdt * 1.6) : 0;
  const delta = gi >= 0 ? va[gi] - vb[gi] : 0;

  const enter = act(0, 0.5);
  const aIn = outCubic(act(tA, 0.3));
  const bIn = hasB ? outCubic(act(tB, 0.3)) : 0;

  return (
    <NvRoot params={params} className="nv-rd">
      <NvPlate className="nv-rd-plate" style={enterStyle(enter)}>
        <div className="nv-rd-head">
          <div>
            <NvKicker en={params.kickerEn} zh={params.kickerZh} />
            <div className="nv-rd-title">{rich(params.title)}</div>
          </div>
          <div className="nv-rd-legend">
            <span style={{ opacity: aIn }}>
              <i className="is-a" />
              {params.nameA}
            </span>
            {hasB && (
              <span style={{ opacity: bIn }}>
                <i className="is-b" />
                {params.nameB}
              </span>
            )}
          </div>
        </div>
        <svg className="nv-rd-svg" width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`} aria-hidden>
          <g transform={`rotate(${gridRot.toFixed(2)} ${C.x} ${C.y}) translate(${C.x} ${C.y}) scale(${(0.86 + 0.14 * gridP).toFixed(4)}) translate(${-C.x} ${-C.y})`} style={{ opacity: gridP }}>
            {Array.from({ length: RINGS }, (_, k) => {
              const r = (R * (k + 1)) / RINGS;
              const d = axes.map((_, i) => at(i, r)).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";
              return <path key={k} d={d} className={`nv-rd-ring ${k === RINGS - 1 ? "is-outer" : ""}`} />;
            })}
            {axes.map((_, i) => {
              const p = at(i, R * outCubic(act(0.2 + i * 0.04, 0.5)));
              return <line key={i} x1={C.x} y1={C.y} x2={p.x} y2={p.y} className="nv-rd-spoke" />;
            })}
          </g>

          {/* 差距最大的轴:轴线点亮 + 两个顶点之间拉一道亮杆 */}
          {gapP > 0 && (
            <g>
              <line x1={C.x} y1={C.y} x2={at(gi, R).x} y2={at(gi, R).y} className="nv-rd-gap-axis" style={{ opacity: outCubic(gapP) * (0.45 + 0.55 * flash) }} />
            </g>
          )}

          {hasB && bIn > 0 && (
            <g>
              <path d={poly(rb)} className="nv-rd-b" />
              {rb.map((r, i) => {
                const p = at(i, Math.max(0, r));
                return <circle key={i} cx={p.x} cy={p.y} r={3.4} className="nv-rd-b-dot" />;
              })}
            </g>
          )}
          {aIn > 0 && (
            <g>
              <path d={poly(ra)} className="nv-rd-a" />
              {ra.map((r, i) => {
                const p = at(i, Math.max(0, r));
                return <circle key={i} cx={p.x} cy={p.y} r={4.2} className="nv-rd-a-dot" />;
              })}
            </g>
          )}

          {gapP > 0 && (() => {
            const pa = at(gi, ra[gi]);
            const pb = at(gi, rb[gi]);
            const grow = outCubic(gapP);
            const mid = { x: lerp(pb.x, pa.x, 0.5), y: lerp(pb.y, pa.y, 0.5) };
            const e = { x: lerp(mid.x, pa.x, grow), y: lerp(mid.y, pa.y, grow) };
            const s = { x: lerp(mid.x, pb.x, grow), y: lerp(mid.y, pb.y, grow) };
            return (
              <g>
                <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="nv-rd-gap-glow" style={{ opacity: 0.25 + 0.35 * flash }} />
                <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="nv-rd-gap" />
              </g>
            );
          })()}

          {axes.map((name, i) => {
            const p = at(i, R + 26);
            const c = Math.cos(ang(i));
            const anchor = c > 0.2 ? "start" : c < -0.2 ? "end" : "middle";
            const sy = Math.sin(ang(i));
            const dy = sy < -0.5 ? -6 : sy > 0.5 ? 14 : 4;
            const on = i === gi && gapP > 0;
            const lin = outCubic(act(0.4 + i * 0.05, 0.4));
            const chipIn = on ? outBack(act(tGap + 0.15, 0.4), 2.4) : 0;
            return (
              <g key={i} style={{ opacity: lin * (gapP > 0 && !on ? lerp(1, 0.55, outCubic(gapP)) : 1) }}>
                <text x={p.x} y={p.y + dy} textAnchor={anchor} className={`nv-rd-label ${on ? "is-on" : ""}`}>
                  {name}
                </text>
                <text x={p.x} y={p.y + dy + 18} textAnchor={anchor} className="nv-rd-val" style={{ opacity: on ? 0 : aIn }}>
                  {fmtNum(va[i] * outCubic(act(tA + i * 0.07, 0.8)))}
                </text>
                {on && (
                  <text
                    x={p.x}
                    y={p.y + dy + 20}
                    textAnchor={anchor}
                    className={`nv-rd-delta ${delta < 0 ? "is-down" : ""}`}
                    style={{ opacity: clamp01(chipIn) }}
                  >
                    {delta >= 0 ? "+" : "−"}
                    {fmtNum(Math.abs(delta) * clamp01(chipIn))}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </NvPlate>
    </NvRoot>
  );
}

export const radarProfileDef: EffectDef<RadarProfileParams> = {
  id: "radar-profile",
  name: "RadarProfile",
  description: "雷达画像 · 网格旋转着展开,主对象的多边形从圆心长出(每个顶点各自弹出带过冲),对比对象的虚线形叠上来;最后差距最大的那根轴闪三下,两顶点间拉出亮杆,轴名旁跳出差值",
  tags: ["生长描画", "对撞并置"],
  selfPosition: true,
  defaults: {
    ...NV_BASE_DEFAULTS,
    kickerEn: "PROFILE",
    kickerZh: "能力画像",
    title: "雷达图:强在哪,*差在哪*",
    axes: "填维度名|凸出是强|差最大会闪|凹进是弱|虚线是对比|对比可留空",
    nameA: "主对象",
    valuesA: "86|72|90|58|78|70",
    nameB: "对比对象",
    valuesB: "64|80|62|74|60|76",
    max: 100,
    times: "0.5|1.9|3.1",
  },
  controls: nvControls([
    { key: "kickerEn", label: "眉题英文", type: "text" },
    { key: "kickerZh", label: "眉题中文", type: "text" },
    { key: "title", label: "标题(*词* 强调)", type: "text" },
    { key: "axes", label: "维度名(| 分隔,3–10 个)", type: "text" },
    { key: "nameA", label: "主对象名", type: "text" },
    { key: "valuesA", label: "主对象各维度分(| 分隔)", type: "text" },
    { key: "nameB", label: "对比对象名(空 = 不对比)", type: "text" },
    { key: "valuesB", label: "对比对象各维度分(| 分隔)", type: "text" },
    { key: "max", label: "满分", type: "range", min: 1, max: 1000, step: 1 },
    { key: "times", label: "卡点秒:主对象长出 | 对比叠上 | 差距轴闪", type: "text" },
  ]),
  Component: RadarProfile,
};
