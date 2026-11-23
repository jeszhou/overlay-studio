import type { EffectDef, EffectProps } from "../../types";
import {
  clamp01,
  cues,
  enterStyle,
  lerp,
  NV_BASE_DEFAULTS,
  NvKicker,
  NvPlate,
  NvRoot,
  nvControls,
  outCubic,
  px,
  rich,
  springAt,
  useNvTime,
  wobbleAt,
  type NvBaseParams,
} from "./kit";
import { parseRows, rollFigure } from "./dataKit";

/** 相邻类别在格子里紧挨着,色阶要比 toneColor 拉得更开 */
const toneColor = (i: number, n: number) =>
  `color-mix(in srgb, var(--hud-acc) ${n <= 1 ? 100 : Math.round(100 - (i / (n - 1)) * 80)}%, var(--nv-plate-solid))`;

export interface WaffleFillParams extends NvBaseParams {
  kickerEn: string;
  kickerZh: string;
  title: string;
  /** 一行一类:名称:数值(2–8 类,按比例分进 100 格) */
  items: string;
  unit: string;
  /** 灌完后聚焦第几类(1 起,0 = 不聚焦) */
  focus: number;
  /** 开始灌 | 聚焦 */
  times: string;
}

const G = 10;
const CELL = 22; // 收过一档:卡宽 560 时图例的类名不被截
const GAP = 5;
const STEP = CELL + GAP;
const SIZE = G * STEP - GAP;
const TOP = 46; // 格子上方留给水流的高度
const POUR = 2.5; // 100 格灌完的秒数(按速度缩放)
const CAT_PAUSE = 0.2; // 换一类时水流停一下

/** 把各类数值按最大余数法分成正好 100 格 */
function allot(vals: number[]) {
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  const raw = vals.map((v) => (v / sum) * 100);
  const base = raw.map(Math.floor);
  let left = 100 - base.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => ({ i, f: r - Math.floor(r) }))
    .sort((a, b) => b.f - a.f)
    .forEach(({ i }) => {
      if (left > 0) {
        base[i]++;
        left--;
      }
    });
  return base;
}

/** 第 k 格(从底往上、蛇形)的格子坐标 */
function cellXY(k: number) {
  const row = Math.floor(k / G);
  const c = k % G;
  const col = row % 2 ? G - 1 - c : c;
  return { x: col * STEP, y: TOP + (G - 1 - row) * STEP };
}

function WaffleFill({ params, playToken }: EffectProps<WaffleFillParams>) {
  const { t, sp, act } = useNvTime(params, playToken);
  const [tPour, tFocus] = cues(params.times, [0.5, 4]);
  const rows = parseRows(params.items).slice(0, 8);
  const n = rows.length;
  const counts = allot(rows.map((r) => Math.max(0, r.nums[0] || 0)));
  const cat: number[] = [];
  counts.forEach((c, i) => {
    for (let s = 0; s < c; s++) cat.push(i);
  });

  // 每格落位的时刻:按序灌,换类时停一下
  const at = cat.map((ci, k) => tPour + ((k / 100) * POUR + ci * CAT_PAUSE) / sp);
  const pourEnd = tPour + (POUR + (n - 1) * CAT_PAUSE) / sp;
  let level = 0; // 已落位的格数
  at.forEach((a) => {
    if (t >= a) level++;
  });
  const pouring = t >= tPour && level < 100;
  const curCat = level < 100 ? cat[level] : -1;
  // 水流在两类之间要停:下一格还没到点、且是新的一类时,流断开
  const gapNow = pouring && level > 0 && cat[level] !== cat[level - 1] && t < at[level] - 0.02 / sp;

  const fi = params.focus - 1;
  const hasFocus = fi >= 0 && fi < n;
  const focusP = hasFocus ? outCubic(act(tFocus, 0.45)) : 0;
  const focusPop = hasFocus ? springAt((t - tFocus) * sp, 16, 7) : 0;

  // 水流的落点:当前那格的上沿,x 平滑跟着走
  const kNow = Math.min(99, level);
  const head = cellXY(kNow);
  const prev = cellXY(Math.max(0, kNow - 1));
  const u = level < 100 ? clamp01(((t - (at[kNow - 1] ?? tPour)) * sp) / (POUR / 100)) : 1;
  const streamX = lerp(prev.x, head.x, outCubic(u)) + CELL / 2;
  const streamY = head.y;
  const streamIn = outCubic(act(tPour - 0.15, 0.25)) * (1 - outCubic(act(pourEnd, 0.3)));

  const enter = act(0, 0.5);

  return (
    <NvRoot params={params} className="nv-wff">
      <NvPlate className="nv-wff-plate" style={enterStyle(enter)}>
        <div className="nv-wff-head">
          <div>
            <NvKicker en={params.kickerEn} zh={params.kickerZh} />
            <div className="nv-wff-title">{rich(params.title)}</div>
          </div>
          {hasFocus && focusP > 0 && (
            <div className="nv-wff-big" style={{ opacity: focusP, transform: `translateY(${px(10 * (1 - focusP))})` }}>
              <span>{rows[fi].name}</span>
              <b className="nv-mono">
                {rollFigure(rows[fi].raw[0] ?? "0", focusP)}
                <small>{params.unit}</small>
              </b>
            </div>
          )}
        </div>
        <div className="nv-wff-row">
          <svg width={SIZE} height={TOP + SIZE} viewBox={`0 0 ${SIZE} ${TOP + SIZE}`} className="nv-wff-grid" aria-hidden>
            {/* 空格子 */}
            {Array.from({ length: 100 }, (_, k) => {
              const p = cellXY(k);
              const show = outCubic(act(0.1 + ((p.x + (TOP + SIZE - p.y)) / (SIZE * 2)) * 0.5, 0.35));
              return <rect key={`e${k}`} x={p.x} y={p.y} width={CELL} height={CELL} rx={6} className="nv-wff-empty" style={{ opacity: show }} />;
            })}
            {/* 水流:细柱 + 往下滚的水珠 */}
            {streamIn > 0.01 && !gapNow && curCat >= 0 && (
              <g style={{ opacity: streamIn }}>
                <line x1={streamX} x2={streamX} y1={-4} y2={streamY - 2} stroke={toneColor(curCat, n)} className="nv-wff-stream" />
                {[0, 1, 2, 3].map((d) => {
                  const f = (t * 2.6 * sp + d / 4) % 1;
                  return <circle key={d} cx={streamX} cy={lerp(-4, streamY - 4, f * f)} r={2.6} fill={toneColor(curCat, n)} />;
                })}
                <ellipse cx={streamX} cy={streamY - 1} rx={9} ry={2.6} fill={toneColor(curCat, n)} className="nv-wff-splash" />
              </g>
            )}
            {/* 已灌的格子:从底部弹起来,落位后在水面轻轻晃 */}
            {cat.map((ci, k) => {
              if (t < at[k]) return null;
              const p = cellXY(k);
              const dt = (t - at[k]) * sp;
              const rise = springAt(dt, 20, 8);
              const bob = -2.6 * wobbleAt(dt - 0.1, 18, 5);
              const flash = Math.exp(-dt * 7);
              const on = hasFocus && ci === fi;
              const dim = hasFocus && !on ? lerp(1, 0.28, focusP) : 1;
              const s = on ? 1 + 0.12 * focusPop * Math.exp(-Math.max(0, (t - tFocus) * sp - 0.3) * 3) : 1;
              const cx = p.x + CELL / 2;
              const by = p.y + CELL;
              return (
                <rect
                  key={k}
                  x={p.x}
                  y={p.y}
                  width={CELL}
                  height={CELL}
                  rx={6}
                  fill={toneColor(ci, n)}
                  transform={`translate(${cx} ${by + bob}) scale(${(s * (0.7 + 0.3 * rise)).toFixed(3)} ${(s * rise).toFixed(3)}) translate(${-cx} ${-by})`}
                  style={{
                    opacity: dim,
                    filter: flash > 0.05 ? `brightness(${(1 + 0.6 * flash).toFixed(2)})` : on && focusP > 0 ? `drop-shadow(0 0 ${px(6 * focusP)} color-mix(in srgb, var(--hud-acc) 60%, transparent))` : undefined,
                  }}
                />
              );
            })}
          </svg>

          <div className="nv-wff-legend">
            {rows.map((r, i) => {
              const inP = outCubic(act(0.25 + i * 0.08, 0.45));
              const first = cat.indexOf(i);
              const filled = cat.reduce((a, c, k) => a + (c === i && t >= at[k] ? 1 : 0), 0);
              const fp = counts[i] ? filled / counts[i] : 1;
              const live = curCat === i && pouring;
              const on = hasFocus && fi === i;
              const op = hasFocus ? lerp(1, on ? 1 : 0.4, focusP) : first >= 0 && t < at[first] ? 0.55 : 1;
              return (
                <div
                  key={i}
                  className={`nv-wff-item ${live ? "is-live" : ""} ${on && focusP > 0 ? "is-on" : ""}`}
                  style={{ opacity: inP * op, transform: `translateX(${px(16 * (1 - inP) + (on ? 6 * focusPop : 0))})` }}
                >
                  <i style={{ background: toneColor(i, n) }} />
                  <span>{r.name}</span>
                  <b className="nv-mono">
                    {rollFigure(r.raw[0] ?? "0", fp)}
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

export const waffleFillDef: EffectDef<WaffleFillParams> = {
  id: "waffle-fill",
  name: "WaffleFill",
  description: "百格华夫 · 10×10 方格从底部蛇形灌满,一道水流按类别依次倒进去,每格弹起落位后在水面轻晃,图例数字跟着灌的进度滚;灌完可聚焦某一类,其余压暗",
  tags: ["堆叠累积", "逐条落位", "滚动计数"],
  selfPosition: true,
  defaults: {
    ...NV_BASE_DEFAULTS,
    kickerEn: "SHARE OF 100",
    kickerZh: "占比",
    title: "百格图:100 个里*占多少*",
    items: "聚焦的这类:38|其余自动压暗:27|按占比灌格子:20|其他:15",
    unit: "%",
    focus: 1,
    times: "0.5|4",
  },
  controls: nvControls([
    { key: "kickerEn", label: "眉题英文", type: "text" },
    { key: "kickerZh", label: "眉题中文", type: "text" },
    { key: "title", label: "标题(*词* 强调)", type: "text" },
    { key: "items", label: "类别(一行一类:名称:数值,2–8 类,按比例分进 100 格)", type: "textarea", rows: 5 },
    { key: "unit", label: "数值后的单位", type: "text" },
    { key: "focus", label: "灌完聚焦第几类(0 = 不聚焦)", type: "range", min: 0, max: 8, step: 1 },
    { key: "times", label: "卡点秒:开始灌 | 聚焦", type: "text" },
  ]),
  Component: WaffleFill,
};
