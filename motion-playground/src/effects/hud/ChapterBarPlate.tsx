import type { EffectProps } from "../types";
import { STAGE } from "../../stage";
import { useTimelineTime, usePlateSpeed } from "./useTimelineTime";
import { ACCENT_VAR, offsetVars } from "./accent";
import type { ChapterBarParams } from "./ChapterBar";

/**
 * 章节导航条 · 精修版(隔离 Opus 原作逐拍移植)
 * 通栏 48px 顶条:章宽按时长分、01/02 编号、三档亮度(未到 / 讲完 / 当前)、
 * 进场从顶部滑入 + 标签错峰浮起 + 指示条从中心展开;切章时指示条「右沿先走、左沿跟上」,
 * 刚讲完那格橙色轻提亮再回落。待机只有进度在推,不做循环动画。全部是 t 的纯函数。
 */

const BAR_H = 48;
const MIN_W = 260; // 原作章节保底宽
const NAME_FS = 19; // 原作章名字号(也是下限附近,只允许缩到 18 再截断)
const NAME_FS_MIN = 18;
const NUM_FS = 12;
const ENTER = 0.26; // 滑入时长
const HANDOFF = 0.55; // 切章交接时长

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** 先比端点:b 为 Infinity 时不算出 NaN */
const prog = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

interface Chapter {
  label: string;
  start: number;
}

/** 与原卡同一套解析:"引入 0 | 变现问题 17" → 按 start 升序 */
function parseChapters(raw: string): Chapter[] {
  return (raw ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(.*?)\s+([\d.]+)$/);
      return m ? { label: m[1].trim(), start: parseFloat(m[2]) } : { label: seg, start: 0 };
    })
    .sort((a, b) => a.start - b.start);
}

/** 估算文字宽(纯函数,导出逐帧确定):全角按 1em,半角按字形粗估,再加字距 */
function textW(s: string, fs: number, ls: number) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c > 0x2e80) w += fs;
    else if (ch === " ") w += fs * 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += fs * 0.64;
    else w += fs * 0.54;
    w += ls * fs;
  }
  return w;
}

export function ChapterBarPlate({ params, playToken }: EffectProps<ChapterBarParams>) {
  const { accent, showProgress, progMode, progAccent, progAlpha, hideAt, theme } = params;
  const { w: SW } = STAGE;
  const tAbs = useTimelineTime(params, playToken); // 章节起始秒、隐藏时段都是时间轴绝对秒
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const items = parseChapters(params.chapters);
  if (!items.length) return null;
  const T = Math.max(0, Number.isFinite(tAbs) ? tAbs : 0);
  const te = Math.max(0, T - (params.__start ?? 0)); // 进场按卡内已过秒数
  const teS = te * spd; // 进场按 1 倍速计的秒数
  const n = items.length;

  // ---------- 整期结尾:用卡片自己的结束时间;没有/早于最后一章时给最后一章一个默认长度 ----------
  const gaps = items.slice(1).map((c, i) => Math.max(0, c.start - items[i].start)).filter((d) => d > 0);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 30;
  const lastStart = items[n - 1].start;
  const end = Number.isFinite(params.__end) && (params.__end as number) > lastStart + 0.5 ? (params.__end as number) : lastStart + avgGap;
  const durs = items.map((c, i) => Math.max(0.1, (i < n - 1 ? items[i + 1].start : end) - c.start));

  // ---------- 水平微调:通栏条整体平移会把一截推出画,改成「被推的那一侧往里收」——
  //            往右拖左沿右移、右沿贴住画面右边;往左拖反过来;最多收到剩 40% 宽,永不出画 ----------
  const ox = clamp(Number(params.offsetX) || 0, -SW * 0.6, SW * 0.6);
  const BX = Math.max(0, ox);
  const BW = SW - Math.abs(ox);

  // ---------- 布局:章宽按时长比例,保底宽;章多到放不下保底时均分 ----------
  const minW = Math.min(MIN_W, BW / n);
  const total = durs.reduce((a, b) => a + b, 0);
  let widths = durs.map((d) => Math.max(minW, (BW * d) / total));
  const over = widths.reduce((a, b) => a + b, 0) - BW;
  const flex = widths.map((w) => (w > minW ? w - minW : 0));
  const flexSum = flex.reduce((a, b) => a + b, 0);
  widths = widths.map((w, i) => w - (flexSum ? (over * flex[i]) / flexSum : 0));
  const lefts: number[] = [];
  widths.reduce((x, w) => (lefts.push(x), x + w), 0);

  // 标签排版:窄格收小左边距 → 太窄去掉编号 → 缩到 18px → 还放不下就省略号截断
  const labels = items.map((c, i) => {
    const w = widths[i];
    const pad = w >= 200 ? 24 : Math.max(10, Math.round(w * 0.1));
    const num = String(i + 1).padStart(2, "0");
    const numW = textW(num, NUM_FS, 0.06) + 10;
    const room = w - pad - 12;
    const showNum = room - numW >= NAME_FS * 3;
    const nameRoom = Math.max(0, room - (showNum ? numW : 0));
    const natural = textW(c.label, NAME_FS, 0.08);
    const fs = natural <= nameRoom ? NAME_FS : Math.max(NAME_FS_MIN, (NAME_FS * nameRoom) / natural);
    const nameW = Math.min(nameRoom, textW(c.label, fs, 0.08));
    return { pad, num, showNum, numW, fs, nameRoom, width: (showNum ? numW : 0) + nameW };
  });

  // ---------- 隐藏时段(原卡同款):整条淡出 0.25s,进度照常走 ----------
  const c01 = (v: number) => clamp(v, 0, 1);
  let hidden = 0;
  for (const seg of (hideAt ?? "").split("|")) {
    const [a, b] = seg.split("-").map((x) => parseFloat(x.trim()));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    hidden = Math.max(hidden, c01(((T - a) * spd) / 0.25) - c01(((T - b) * spd) / 0.25));
  }

  // ---------- 进场:从顶部滑入 ----------
  const e = easeOutCubic(prog(teS, 0, ENTER));

  let cur = 0;
  for (let i = 0; i < n; i++) if (T >= items[i].start) cur = i;
  const curStart = items[cur].start;
  const sinceSwitch = cur > 0 ? T - curStart : Infinity; // 第一章没有交接
  const h = cur > 0 ? easeInOutCubic(prog(T, curStart, curStart + HANDOFF / spd)) : 1;

  const light = theme === "light" && true;
  const ink = light ? "20,20,24" : "255,255,255";
  const accVar = ACCENT_VAR[accent];
  const progVar = ACCENT_VAR[progAccent || accent];
  const alpha = progAlpha ?? 0.25;
  const isFill = (progMode ?? "fill") === "fill";

  // ---------- 指示条:切章时从上一章滑到这一章(右沿先走、左沿后跟) ----------
  const indRect = (i: number) => ({ x: lefts[i] + labels[i].pad, w: labels[i].width });
  const A = indRect(Math.max(0, cur - 1));
  const B = indRect(cur);
  let x0: number;
  let x1: number;
  if (cur === 0 || h >= 1) {
    x0 = B.x;
    x1 = B.x + B.w;
  } else {
    const lead = easeInOutCubic(clamp(h * 1.35, 0, 1));
    const tail = easeInOutCubic(clamp(h * 1.35 - 0.35, 0, 1));
    x1 = lerp(A.x + A.w, B.x + B.w, lead);
    x0 = lerp(A.x, B.x, tail);
  }
  const indIn = easeOutCubic(prog(teS, 0.2, 0.55));
  const cx = (x0 + x1) / 2;
  const indW = (x1 - x0) * indIn;

  return (
    <div
      className="hud"
      style={{
        ...offsetVars(params),
        position: "absolute",
        left: BX,
        top: 0,
        width: BW,
        height: BAR_H,
        zIndex: 70,
        // 上下偏移走 --hud-oy;水平微调不平移(会出画),而是在上面把条从被推的一侧收窄
        transform: `translateY(var(--hud-oy, 0px)) translateY(${(1 - e) * -100}%)`,
        // 常驻层没有自己的退场:保留编辑台最后 0.3s 的统一淡出(--fx-outro),再乘进场/隐藏时段
        opacity: `calc(var(--fx-outro, 1) * ${(lerp(0.4, 1, e) * (1 - hidden)).toFixed(4)})`,
        ["--hud-acc" as string]: accVar,
        fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
        pointerEvents: "none",
      }}
    >
      {/* 底板:上深下浅 + 底部发丝线 */}
      <div
          style={{
            position: "absolute",
            inset: 0,
            background: light
              ? "linear-gradient(180deg, rgba(250,249,246,0.9) 0%, rgba(250,249,246,0.78) 100%)"
              : "linear-gradient(180deg, rgba(12,12,14,0.78) 0%, rgba(12,12,14,0.62) 100%)",
            boxShadow: `0 1px 0 rgba(${ink},0.10), 0 8px 24px rgba(0,0,0,0.18)`,
          }}
        />
      {items.map((c, i) => {
        const L = labels[i];
        let p = clamp((T - c.start) / durs[i], 0, 1);
        if (i === 0) p *= easeOutCubic(prog(teS, 0.15, 0.6)); // 首章填充随进场轻轻长出
        // 刚讲完的章:交接瞬间整格轻微提亮再回落
        const flash = i === cur - 1 && sinceSwitch * spd < 0.9 ? Math.sin(Math.PI * prog(sinceSwitch * spd, 0, 0.9)) : 0;
        const isCur = i === cur;
        const headOp = isCur && p > 0.002 ? 0.85 * (i === 0 ? e : h) : 0;
        const on = i === cur ? h : i === cur - 1 ? 1 - h : 0;
        const done = i < cur;
        const baseA = Math.min(0.92, (done ? 0.74 : 0.6));
        const a = easeOutCubic(prog(teS, 0.1 + i * 0.05, 0.4 + i * 0.05)); // 标签错峰浮起
        // 编号:当前章转成强调色(用强调色叠一层),否则淡白
        const numBase = Math.min(0.85, (done ? 0.5 : 0.42));
        const showFill = showProgress && (isFill || isCur);
        return (
          <div key={i} style={{ position: "absolute", top: 0, left: lefts[i], width: widths[i], height: BAR_H, overflow: "hidden" }}>
            {i > 0 && (
              <div style={{ position: "absolute", left: 0, top: 14, width: 1, height: 20, background: `rgba(${ink},${0.16})` }} />
            )}
            {showFill && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: `${p * 100}%`,
                  ...(isFill ? { top: 0, bottom: 0 } : { bottom: 0, height: 2 }),
                  background: progVar,
                  opacity: isFill ? Math.min(1, alpha + 0.12 * flash) : 0.6,
                }}
              />
            )}
            {showProgress && isFill && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: 2,
                  left: `${p * 100}%`,
                  marginLeft: -2,
                  background: progVar,
                  opacity: 0.9 * headOp,
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: L.pad,
                top: 0,
                height: BAR_H,
                display: "flex",
                alignItems: "center",
                gap: 10,
                whiteSpace: "nowrap",
                opacity: a,
                transform: `translateY(${(1 - a) * 6}px)`,
                filter: undefined,
              }}
            >
              {L.showNum && (
                <span style={{ position: "relative", fontFamily: '"SF Mono", Menlo, monospace', fontSize: NUM_FS, letterSpacing: "0.06em" }}>
                  <span style={{ color: `rgba(${ink},${on > 0.02 ? lerp(0.4, 0.95, on) * (1 - on) : numBase})` }}>{L.num}</span>
                  {on > 0.02 && (
                    <span style={{ position: "absolute", left: 0, top: 0, color: accVar, opacity: lerp(0.4, 0.95, on) * on }}>{L.num}</span>
                  )}
                </span>
              )}
              <span
                style={{
                  display: "inline-block",
                  maxWidth: L.nameRoom,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontSize: L.fs,
                  letterSpacing: "0.08em",
                  fontWeight: on > 0.5 ? 600 : 500,
                  color: `rgba(${ink},${lerp(baseA, 1, on).toFixed(3)})`,
                }}
              >
                {c.label}
              </span>
            </div>
          </div>
        );
      })}
      {/* 当前章底部指示条 */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          height: 3,
          left: cx - indW / 2,
          width: Math.max(0, indW),
          background: accVar,
          borderRadius: "2px 2px 0 0",
          filter: undefined,
        }}
      />
    </div>
  );
}
