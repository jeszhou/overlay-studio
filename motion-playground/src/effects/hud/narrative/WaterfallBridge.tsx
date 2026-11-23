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
  outBack,
  outCubic,
  px,
  rich,
  springAt,
  useNvTime,
  type NvBaseParams,
} from "./kit";
import { fmtNum, parseRows } from "./dataKit";
import { secList } from "./kit";

export interface WaterfallBridgeParams extends NvBaseParams {
  kickerEn: string;
  kickerZh: string;
  title: string;
  /** 起点:名称:数值 */
  start: string;
  /** 一行一步:名称:+数值 / -数值(1–6 步) */
  steps: string;
  /** 终点柱的名字 */
  endLabel: string;
  unit: string;
  /** 起点柱升起 | 终点柱升起 */
  times: string;
  /** 每一步落下的秒(| 分隔,空 = 自动等距) */
  stepTimes: string;
}

const CH = 230; // 柱区高度
const COL_W = 52;

function WaterfallBridge({ params, playToken }: EffectProps<WaterfallBridgeParams>) {
  const { t, sp, act } = useNvTime(params, playToken);
  const steps = parseRows(params.steps).slice(0, 6);
  const [startRow] = parseRows(params.start);
  const startName = startRow?.name ?? "";
  const startVal = startRow?.nums[0] || 0;
  const k = steps.length;
  const autoStep = Array.from({ length: k }, (_, i) => 1.4 + i * 0.75);
  const [tStart, tEnd] = cues(params.times, [0.4, 1.4 + k * 0.75 + 0.2]);
  const given = secList(params.stepTimes);
  const stepAt = autoStep.map((f, i) => (Number.isFinite(given[i]) ? given[i] : f));

  // 累计水位
  const levels = [startVal];
  steps.forEach((s) => levels.push(levels[levels.length - 1] + (s.nums[0] || 0)));
  const endVal = levels[k];
  const top = Math.max(0, ...levels) * 1.12;
  const bottom = Math.min(0, ...levels) * 1.12;
  const y = (v: number) => CH - ((v - bottom) / (top - bottom || 1)) * CH;
  const base = y(0);

  const cols = k + 2;
  const W = Math.max(380, cols * (COL_W + 22));
  const slot = W / cols;
  const colX = (i: number) => slot * i + (slot - COL_W) / 2;
  const unit = params.unit;

  // 起点柱
  const sG = springAt((t - tStart) * sp, 14, 7);
  // 终点柱
  const eG = springAt((t - tEnd) * sp, 13, 6);
  const eP = outCubic(act(tEnd, 0.9));
  const endGlow = Math.exp(-Math.max(0, t - tEnd - 0.8 / sp) * 2.5) * (t > tEnd ? 1 : 0);
  const delta = endVal - startVal;
  const deltaPct = startVal ? (delta / startVal) * 100 : 0;
  const badgeIn = outBack(act(tEnd + 0.7, 0.45), 2);

  const enter = act(0, 0.5);

  return (
    <NvRoot params={params} className="nv-wf">
      <NvPlate className="nv-wf-plate" style={{ ...enterStyle(enter), width: px(W + 56) }}>
        <NvKicker en={params.kickerEn} zh={params.kickerZh} />
        <div className="nv-wf-title">{rich(params.title)}</div>
        <div className="nv-wf-chart" style={{ width: px(W), height: px(CH + 54) }}>
          <svg width={W} height={CH + 4} className="nv-wf-svg" aria-hidden>
            {/* 网格 */}
            {[0.25, 0.5, 0.75].map((g) => (
              <line key={g} x1={0} x2={W * outCubic(act(0.15 + g * 0.2, 0.6))} y1={CH * g} y2={CH * g} className="nv-wf-grid" />
            ))}
            <line x1={0} x2={W} y1={base} y2={base} className="nv-wf-axis" />

            {/* 连接虚线:每一级水位横着牵到下一根 */}
            {levels.map((lv, i) => {
              const at = i === 0 ? tStart + 0.5 : stepAt[i - 1] + 0.45;
              const p = outCubic(act(at, 0.35));
              if (p <= 0 || i > k) return null;
              const x0 = colX(i) + COL_W;
              const x1 = colX(i + 1);
              return <line key={i} x1={x0} x2={lerp(x0, x1, p)} y1={y(lv)} y2={y(lv)} className="nv-wf-link" />;
            })}

            {/* 起点柱 */}
            {t >= tStart && <rect x={colX(0)} y={Math.min(base, lerp(base, y(startVal), sG))} width={COL_W} height={Math.abs(base - y(startVal)) * sG} rx={6} className="nv-wf-base" />}

            {/* 增减块 */}
            {steps.map((s, i) => {
              const v = s.nums[0] || 0;
              const lo = Math.min(levels[i], levels[i + 1]);
              const hi = Math.max(levels[i], levels[i + 1]);
              const yTop = y(hi);
              const h = y(lo) - y(hi);
              const at = stepAt[i];
              if (t < at) return null;
              const x = colX(i + 1);
              if (v >= 0) {
                // 加:从上方掉下来,落地压扁回弹
                const fall = clamp01(((t - at) * sp) / 0.38);
                // 从图区顶边落下(原先从图区上方 60px 起落,会划过标题);开头 0.1 段淡入,不硬冒出来
                const dy = -yTop * (1 - fall * fall);
                const squash = fall >= 1 ? 1 - 0.14 * Math.sin(Math.PI * clamp01(((t - at) * sp - 0.38) / 0.18)) : 1;
                return (
                  <rect
                    key={i}
                    x={x - (COL_W * (1 / squash - 1)) / 2}
                    y={yTop + dy + h * (1 - squash)}
                    width={COL_W / squash}
                    height={h * squash}
                    rx={6}
                    className="nv-wf-up"
                    style={{ opacity: clamp01(fall * 4) }}
                  />
                );
              }
              // 减:从上一级水位往下「抽走」,块从顶边往下长出来
              const g = outCubic(act(at, 0.45));
              return <rect key={i} x={x} y={yTop} width={COL_W} height={h * g} rx={6} className="nv-wf-down" />;
            })}

            {/* 终点柱 */}
            {t >= tEnd && (
              <rect
                x={colX(k + 1)}
                y={Math.min(base, lerp(base, y(endVal), eG))}
                width={COL_W}
                height={Math.abs(base - y(endVal)) * eG}
                rx={6}
                className="nv-wf-end"
                style={{ filter: `drop-shadow(0 0 ${px(6 + 18 * endGlow)} color-mix(in srgb, var(--hud-acc) 60%, transparent))` }}
              />
            )}
          </svg>

          {/* 数值标签 */}
          {t >= tStart && (
            <span className="nv-wf-val" style={{ left: px(colX(0) + COL_W / 2), top: px(y(startVal) - 30), opacity: outCubic(act(tStart + 0.3, 0.3)) }}>
              {fmtNum(startVal * outCubic(act(tStart, 0.6)))}
              {unit}
            </span>
          )}
          {steps.map((s, i) => {
            const v = s.nums[0] || 0;
            const p = outBack(act(stepAt[i] + 0.3, 0.35), 2.2);
            if (p <= 0) return null;
            const yy = v >= 0 ? y(levels[i + 1]) - 30 : y(levels[i + 1]) + 4;
            return (
              <span
                key={i}
                className={`nv-wf-val ${v >= 0 ? "is-up" : "is-down"}`}
                style={{ left: px(colX(i + 1) + COL_W / 2), top: px(yy), transform: `translateX(-50%) scale(${p.toFixed(3)})` }}
              >
                {v >= 0 ? "+" : "−"}
                {fmtNum(Math.abs(v))}
                {unit}
              </span>
            );
          })}
          {t >= tEnd && (
            <span className="nv-wf-val is-end" style={{ left: px(colX(k + 1) + COL_W / 2), top: px(y(endVal) - 38), opacity: outCubic(act(tEnd + 0.2, 0.3)) }}>
              {fmtNum(endVal * eP)}
              {unit}
            </span>
          )}

          {/* 底部名称 */}
          {[startName, ...steps.map((s) => s.name), params.endLabel].map((name, i) => (
            <span
              key={i}
              className={`nv-wf-name ${i === k + 1 ? "is-end" : ""}`}
              style={{ left: px(colX(i) + COL_W / 2), top: px(CH + 12), width: px(slot - 4), opacity: outCubic(act(0.3 + i * 0.05, 0.4)) }}
            >
              {name}
            </span>
          ))}

          {/* 总变化徽章 */}
          {badgeIn > 0 && (
            <div
              className={`nv-wf-badge ${delta >= 0 ? "is-up" : "is-down"}`}
              style={{ right: 0, top: px(-46), transform: `scale(${badgeIn.toFixed(3)})` }}
            >
              <b className="nv-mono">
                {delta >= 0 ? "▲ +" : "▼ −"}
                {fmtNum(Math.abs(delta))}
                {unit}
              </b>
              {startVal !== 0 && <small className="nv-mono">{fmtNum(Math.abs(deltaPct), 1)}%</small>}
            </div>
          )}
        </div>
      </NvPlate>
    </NvRoot>
  );
}

export const waterfallBridgeDef: EffectDef<WaterfallBridgeParams> = {
  id: "waterfall-bridge",
  name: "WaterfallBridge",
  description: "瀑布图 · 起点柱升起,每个增项像积木从上方砸下落地回弹、每个减项从水位往下抽走,水位虚线一级级牵过去,最后终点柱发光升起并弹出总变化",
  tags: ["堆叠累积", "生长描画", "滚动计数"],
  selfPosition: true,
  defaults: {
    ...NV_BASE_DEFAULTS,
    kickerEn: "BRIDGE",
    kickerZh: "变化拆解",
    title: "瀑布图:一步步看*差在哪*",
    start: "起点数:100",
    steps: "加项砸下:+38|一级级叠:+12|减项抽走:-21|带正负号:-9",
    endLabel: "终点",
    unit: "",
    times: "0.4|4.6",
    stepTimes: "1.4|2.2|3|3.8",
  },
  controls: nvControls([
    { key: "kickerEn", label: "眉题英文", type: "text" },
    { key: "kickerZh", label: "眉题中文", type: "text" },
    { key: "title", label: "标题(*词* 强调)", type: "text" },
    { key: "start", label: "起点(名称:数值)", type: "text" },
    { key: "steps", label: "每一步(一行一步:名称:+数值 / -数值,最多 6 步)", type: "textarea", rows: 6 },
    { key: "endLabel", label: "终点柱名字", type: "text" },
    { key: "unit", label: "数值单位", type: "text" },
    { key: "times", label: "卡点秒:起点柱 | 终点柱", type: "text" },
    { key: "stepTimes", label: "每一步落下的秒(| 分隔,空 = 自动)", type: "text" },
  ]),
  Component: WaterfallBridge,
};
