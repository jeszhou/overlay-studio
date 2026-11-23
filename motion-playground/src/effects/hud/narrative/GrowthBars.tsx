import type { EffectDef, EffectProps } from "../../types";
import {
  clamp01,
  cues,
  list,
  NV_BASE_DEFAULTS,
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

export interface GrowthBarsParams extends NvBaseParams {
  /** 标题,*词* 强调色 */
  title: string;
  /** 标题下的小字(出处 / 口径,空 = 不要) */
  note: string;
  /** 前一根柱 */
  aLabel: string;
  aValue: number;
  /** 后一根柱 */
  bLabel: string;
  bValue: number;
  /** 数字后缀 */
  unit: string;
  /** 两柱之间的贴纸(空 = 不要) */
  sticker: string;
  /** 右边要点的小标题(空 = 不要) */
  pointsTitle: string;
  /** 右边要点,| 分隔,「主字:小字」可带一行说明;最后一颗用强调色 */
  points: string;
  /** 前柱长 | 后柱长 | 贴纸(秒) */
  times: string;
  /** 每颗要点亮起的秒,| 分隔 */
  pointTimes: string;
}

const MAX_POINTS = 5; // 要点最多几条:再多就比柱子还高,撑出画面
const BAR_H = 250; // 柱子最高
const BAR_W = 100;
const CH = BAR_H + 150; // 图区高度(顶上留给数字)
const BASE = 34; // 柱底到图区底(放柱名)

function GrowthBars({ params, playToken }: EffectProps<GrowthBarsParams>) {
  const { t, act } = useNvTime(params, playToken);
  const [aAt, bAt, stAt] = cues(params.times, [0.3, 1.0, 1.9]);
  const pts = list(params.points).slice(0, MAX_POINTS);
  const ptAt = cues(params.pointTimes, pts.map((_, i) => 2.4 + i * 0.5));
  const a = Math.max(0, Number(params.aValue) || 0);
  const b = Math.max(0, Number(params.bValue) || 0);
  const top = Math.max(a, b, 1);

  const plateIn = outCubic(act(0, 0.45));
  const aG = outCubic(act(aAt, 0.7));
  const bG = outBack(act(bAt, 0.8), 1.2);
  const hA = (BAR_H * a) / top;
  const hB = (BAR_H * b) / top;
  const num = (v: number, p: number) => `${Math.round(v * clamp01(p))}${params.unit ?? ""}`;

  // 贴纸:虚线弧从前柱顶画到后柱顶,贴纸弹进来
  const arc = outCubic(act(stAt - 0.25, 0.4));
  const st = springAt(t - stAt, 20, 8);
  const x1 = BAR_W / 2;
  const x2 = BAR_W + 40;
  const y1 = Math.max(70, CH - BASE - hA - 92); // 下跌时前柱最高:弧线和贴纸都别伸出图区顶
  const y2 = CH - BASE - hB - 40;

  return (
    <NvRoot params={params} className="nv-gb">
      <NvPlate className={`nv-gb-plate ${pts.length ? "has-points" : ""}`} style={{ opacity: plateIn, transform: `translateY(${px(24 * (1 - plateIn))})` }}>
        <div className="nv-gb-title">{rich(params.title)}</div>
        {params.note && <div className="nv-gb-note">{params.note}</div>}
        <div className="nv-gb-main">
          <div className="nv-gb-chart" style={{ height: px(CH), width: px(BAR_W * 2 + 40) }}>
            <svg className="nv-gb-arc" width={BAR_W * 2 + 40} height={CH} style={{ opacity: arc }}>
              {params.sticker && arc > 0 && (
                <path d={`M${x1} ${y1} C${x1} ${y1 - 70}, ${x2 - 30} ${y2 - 60}, ${x2} ${y2}`} />
              )}
            </svg>
            {[
              { label: params.aLabel, h: hA * aG, v: num(a, aG), on: aG > 0, cls: "is-a" },
              { label: params.bLabel, h: hB * bG, v: num(b, act(bAt, 0.8)), on: bG > 0, cls: "is-b" },
            ].map((c, i) => (
              <div key={i} className={`nv-gb-col ${c.cls}`} style={{ left: px(i * (BAR_W + 40)), width: px(BAR_W) }}>
                <b className="nv-gb-val" style={{ bottom: px(c.h + 40), opacity: c.on ? 1 : 0 }}>
                  {c.v}
                </b>
                <i className="nv-gb-bar" style={{ height: px(Math.max(0, c.h)) }} />
                <span className="nv-gb-lab">{c.label}</span>
              </div>
            ))}
            {params.sticker && t >= stAt && (
              // 前柱比后柱高(数值下跌)时 y1 会顶到图区上方、盖住副标题:夹在图区内
              <span className="nv-gb-sticker" style={{ left: px(x1 - 56), top: px(Math.max(0, y1 - 58)), transform: `rotate(-6deg) scale(${Math.max(0, st).toFixed(3)})` }}>
                {params.sticker}
              </span>
            )}
          </div>
          {pts.length > 0 && (
            <div className="nv-gb-points">
              {params.pointsTitle && <div className="nv-gb-ptitle" style={{ opacity: outCubic(act(ptAt[0] - 0.3, 0.4)) }}>{params.pointsTitle}</div>}
              {pts.map((p, i) => {
                const [main, sub] = p.split(/[:：]/);
                const q = act(ptAt[i], 0.4);
                const last = i === pts.length - 1;
                return (
                  <div
                    key={i}
                    className={`nv-gb-pt ${last && q > 0 ? "is-hot" : ""}`}
                    style={{ opacity: 0.25 + 0.75 * outCubic(q), transform: `translateX(${px(18 * (1 - outCubic(q)))}) scale(${(0.97 + 0.03 * outBack(q)).toFixed(4)})` }}
                  >
                    <i className="nv-gb-pt-dot">{last ? "✓" : String(i + 1)}</i>
                    <span>
                      <b>{main}</b>
                      {sub && <small>{sub}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </NvPlate>
    </NvRoot>
  );
}

export const growthBarsDef: EffectDef<GrowthBarsParams> = {
  id: "growth-bars",
  name: "GrowthBars",
  description: "前后两柱 + 涨幅 · 一根灰柱「之前」、一根强调色柱「之后」长上去,数字跟着滚;两柱之间虚线弧箭头 + 贴纸「翻了一倍多」;右边一列要点胶囊依次亮起,最后一颗用强调色 —— 讲一个比例前后变了多少、多出来的花在哪",
  tags: ["生长描画", "滚动计数"],
  defaults: {
    ...NV_BASE_DEFAULTS,
    title: "两根柱子:看*涨了多少*",
    note: "填上前后两个数就行",
    aLabel: "之前",
    aValue: 10,
    bLabel: "之后",
    bValue: 22,
    unit: "%",
    sticker: "变化贴这里",
    pointsTitle: "下面能列要点:",
    points: "写要点:主字加一句|念到哪:哪条就亮|三四条:别写太长",
    times: "0.3|1.0|1.9",
    pointTimes: "2.4|2.9|3.4",
  },
  controls: nvControls([
    { key: "title", label: "标题(*词* 强调色)", type: "text" },
    { key: "note", label: "标题下小字(空 = 不要)", type: "text" },
    { key: "aLabel", label: "前柱名", type: "text" },
    { key: "aValue", label: "前柱数值", type: "range", min: 0, max: 1000, step: 1 },
    { key: "bLabel", label: "后柱名", type: "text" },
    { key: "bValue", label: "后柱数值", type: "range", min: 0, max: 1000, step: 1 },
    { key: "unit", label: "数字后缀", type: "text" },
    { key: "sticker", label: "变化贴纸(涨跌都写在这,空 = 不要)", type: "text" },
    { key: "pointsTitle", label: "要点小标题(空 = 不要)", type: "text" },
    { key: "points", label: "要点(| 分隔,最多 5 条,写成「主字:补一句」;空 = 只要柱子)", type: "text" },
    { key: "times", label: "卡点秒:前柱|后柱|贴纸", type: "text" },
    { key: "pointTimes", label: "要点亮起秒(| 分隔)", type: "text" },
  ]),
  Component: GrowthBars,
  selfPosition: true,
};
