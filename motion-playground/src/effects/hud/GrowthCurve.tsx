import { useId } from "react";
import type { CSSProperties } from "react";
import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
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
  /** 精修版:大字 / 光环落在哪个点(末点 = 现在的结果,最高点 = 峰值) */
  focus?: "last" | "max";
  /** 精修版:大字旁边显示首尾倍数(×5.5 / −40%),首点和重点不可比时自动不显示 */
  delta?: boolean;
  offsetX?: number;
  offsetY?: number;
}

/**
 * 增长曲线卡:平滑曲线从左到右动画画出,曲线下渐变面积,
 * 数据点跟着画到的位置依次亮起,右上角峰值滚动计数 —
 * "资产越攒越多/粉丝一路上涨"式的复利叙事一张卡讲完。
 */
/* ── 精修版「增长曲线」:动作逐拍照搬隔离 Opus 一次性作品 board.html 的 renderAt(t) ──
   深色磨砂卡从外侧滑入、横向揭开,左缘强调色细条自上而下拉出 → 眉题逐字打出(带光标)→ 标题逐行遮罩上升
   → 网格虚线与底线依次拉出 → 单调三次插值的平滑曲线被遮罩从左往右揭开,亮笔尖带光晕走在最前,
   笔尖经过每个点:点位回弹弹出、竖向虚线落下、数值上浮、横轴标签提亮
   → 画完那一拍:重点处一圈波纹扩散,大字从 0 滚到终值、收尾轻轻一顿放大,倍数药丸弹出,小注淡入。
   停留:光晕 / 面积 / 线的辉光随时间呼吸,重点每 1.25s 一次心跳波纹,一道高光沿曲线扫过一次。
   退场:最后 0.5s 各元素错开往外侧滑出淡出。
   通用化:原作的眉题 / 标题 / 月份 / 数值 / 单位 / 口径小注全部来自卡片已有参数;点数 2~8 个都能排、数值可降可负;
   「×5.5」由首点和重点自动算(下降显示 −xx%,不可比时不显示);大字标末点或最高点由参数选。
   横版居中会压脸 → 挂到人脸下方改成左文右图横排。全部画面是 t 的纯函数;只用行内样式 */
const GC_FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const GC_NUM = '"SF Pro Display", "Helvetica Neue", "PingFang SC", sans-serif';
const GC_MONO = '"SF Mono", "Menlo", "PingFang SC", monospace';
const GC_FACE_X = 700; // 横版人脸线:左卡右缘 / 右卡左缘(对称)不越过
const GC_MARGIN = 48;
const GC_LOW_TOP = 712; // 横版居中:挂到人脸下方
const GC_LOW_BOTTOM = 1040;
const GC_OUT = 0.5; // 最后 0.5s 收走
const GC_CW = 448; // 参考作品图表宽
const GC_X0 = 26;
const GC_X1 = 412;
const GC_TOP = 78.7; // 最大值离图表顶(参考作品 66 → y78.7,头上留给数值和波纹)
const GC_PAD_L = 44;
const GC_PAD_R = 40;

const gcClamp = (x: number) => Math.min(1, Math.max(0, x));
// 先比端点:没有结束时间时退场时刻是 Infinity,直接相除会得 NaN
const gcProg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const gcOCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const gcOQuint = (x: number) => 1 - Math.pow(1 - x, 5);
const gcIOCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const gcICubic = (x: number) => x * x * x;
const gcOBack = (x: number) => {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const gcLerp = (a: number, b: number, x: number) => a + (b - a) * x;

/* 字宽估算(排版用):中文 1em,英文 / 数字按常见比例 */
const gcWide = (c: string) => /[⺀-鿿豈-﫿＀-￯　-〿]/.test(c);
const gcEm = (c: string) =>
  gcWide(c) ? 1 : c === " " ? 0.3 : /[A-Z]/.test(c) ? 0.68 : /[0-9]/.test(c) ? 0.6 : /[a-z]/.test(c) ? 0.56 : 0.4;
const gcW = (s: string, fs: number, ls = 0) => Array.from(s).reduce((w, c) => w + (gcEm(c) + ls) * fs, 0);
const gcWord = (c: string) => /[A-Za-z0-9.%+\-]/.test(c);
const GC_NO_HEAD = /[，。、！？：；,.!?:;）)」』》”’·…]/; // 不放行首
/** 一分为二:不拆英文单词 / 数字、行首不放标点,在两行最均衡的地方断 */
function gcSplit2(s: string): [string, string] | null {
  const cs = Array.from(s);
  const total = gcW(s, 1);
  let best: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += gcEm(cs[i - 1]);
    if (gcWord(cs[i - 1]) && gcWord(cs[i])) continue;
    if (GC_NO_HEAD.test(cs[i])) continue;
    const cost = Math.max(acc, total - acc) * (cs[i - 1] === " " || cs[i] === " " ? 0.97 : 1);
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  return best ? [cs.slice(0, best.at).join("").trim(), cs.slice(best.at).join("").trim()] : null;
}
/** 按宽度贪心折行(不拆英文单词,行首不放标点) */
function gcGreedy(s: string, fs: number, maxW: number, ls = 0): string[] {
  const toks = s.match(/[A-Za-z0-9.%+\-]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let cur = "";
  toks.forEach((tk) => {
    if (cur && gcW(cur + tk, fs, ls) > maxW && !GC_NO_HEAD.test(tk)) {
      lines.push(cur.trim());
      cur = /^\s+$/.test(tk) ? "" : tk;
    } else cur += tk;
  });
  if (cur.trim()) lines.push(cur.trim());
  return lines.filter(Boolean);
}
/** 标题:一行放得下就一行;放不下按语义两行;两行还放不下再按宽度多行(字号不缩,参考作品 30px 已是正文下限) */
function gcTitleLines(s: string, maxW: number, fs: number): string[] {
  const t = s.trim();
  if (!t) return [];
  if (gcW(t, fs, 0.02) <= maxW) return [t];
  const two = gcSplit2(t);
  if (two && Math.max(gcW(two[0], fs, 0.02), gcW(two[1], fs, 0.02)) <= maxW) return two;
  return gcGreedy(t, fs, maxW, 0.02);
}

type GcPt = { label: string; raw: string; v: number; dec: number; comma: boolean };
/** 「标签 数值」:数值可带千分位、小数、负号 */
function gcParsePoints(raw: string): GcPt[] {
  return raw
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(.*?)\s*(-?\d[\d,]*(?:\.\d+)?)$/);
      if (!m) return { label: seg, raw: "0", v: 0, dec: 0, comma: false };
      const num = m[2];
      return {
        label: m[1].trim(),
        raw: num,
        v: parseFloat(num.replace(/,/g, "")) || 0,
        dec: num.includes(".") ? num.split(".")[1].length : 0,
        comma: num.includes(","),
      };
    });
}
const gcFmt = (v: number, p: GcPt) =>
  p.comma ? v.toLocaleString("en-US", { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec }) : v.toFixed(p.dec);
/** 首点 → 重点:涨了显示 ×倍数,跌了显示 −百分比;首点 ≤0、重点 ≤0 或几乎没变就不显示 */
function gcDelta(first: number, last: number): string {
  if (!(first > 0) || !(last > 0)) return "";
  const r = last / first;
  if (r >= 1.05) return "×" + (r >= 10 ? String(Math.round(r)) : r.toFixed(1).replace(/\.0$/, ""));
  if (r <= 0.95) return "−" + Math.round((1 - r) * 100) + "%";
  return "";
}

type Rgb = [number, number, number];
const gcHex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const gcCss = (c: Rgb, a = 1) => `rgba(${c.map((v) => Math.round(v)).join(",")},${a})`;
const gcMix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** 配色:数据蓝 = 参考作品原色;其他强调色按同样的明暗关系推出来 */
function gcPalette(accent: string) {
  if (accent === "blue") {
    return {
      lineA: "#4f8dff", lineB: "#8fe9ff", area: "#5aa8ff", area2: "#3d7dff", hi: "#8fe3ff", edgeB: "#3d7dff",
      kick: "#8fc8ff", t2: "#9fd4ff", unit: "#cfe6ff", peakB: "#a9dcff", deltaB: "#6fb2ff", deltaInk: "#06203f",
      dotFill: "#0b1a3d", dotStroke: "#7fbcff", halo0: "#bff0ff", sheen: gcCss([80, 160, 255], 0.22), inset: gcCss([140, 190, 255], 0.18),
      grid: gcCss([150, 190, 255], 0.16), base: [170, 205, 255] as Rgb, drop: gcCss([150, 190, 255], 0.28), dropHi: gcCss([143, 227, 255], 0.55),
      xl: "#9fb8d8", xlHi: "#e6f4ff", vl: "#d8ebff", foot: "#7f97b8", ttl: "#f2f7ff",
      bg: "linear-gradient(160deg, rgba(14,30,66,0.86) 0%, rgba(8,18,44,0.90) 60%, rgba(6,14,36,0.92) 100%)", shadow: "rgba(2,8,30,0.45)",
    };
  }
  const A = gcHex(/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa");
  const W: Rgb = [255, 255, 255];
  const K: Rgb = [0, 0, 0];
  const N: Rgb = [150, 160, 176]; // 中性灰(次要字)
  const D = (k: number): Rgb => gcMix([8, 10, 16], A, k); // 深底:近黑里掺一点强调色
  return {
    lineA: gcCss(gcMix(A, K, 0.08)), lineB: gcCss(gcMix(A, W, 0.45)), area: gcCss(A), area2: gcCss(gcMix(A, K, 0.15)),
    hi: gcCss(gcMix(A, W, 0.4)), edgeB: gcCss(gcMix(A, K, 0.15)), kick: gcCss(gcMix(A, W, 0.4)), t2: gcCss(gcMix(A, W, 0.5)),
    unit: gcCss(gcMix(A, W, 0.75)), peakB: gcCss(gcMix(A, W, 0.6)), deltaB: gcCss(gcMix(A, W, 0.15)), deltaInk: gcCss(gcMix(A, K, 0.85)),
    dotFill: gcCss(D(0.12)), dotStroke: gcCss(gcMix(A, W, 0.25)), halo0: gcCss(gcMix(A, W, 0.7)), sheen: gcCss(A, 0.2), inset: gcCss(gcMix(A, W, 0.4), 0.18),
    grid: gcCss(gcMix(A, W, 0.5), 0.16), base: gcMix(A, W, 0.6), drop: gcCss(gcMix(A, W, 0.5), 0.28), dropHi: gcCss(gcMix(A, W, 0.4), 0.55),
    xl: gcCss(gcMix(N, A, 0.15)), xlHi: gcCss(gcMix(A, W, 0.88)), vl: gcCss(gcMix(A, W, 0.82)), foot: gcCss(gcMix([120, 130, 146], A, 0.12)), ttl: "#f4f6fa",
    bg: `linear-gradient(160deg, ${gcCss(D(0.14), 0.86)} 0%, ${gcCss(D(0.1), 0.9)} 60%, ${gcCss(D(0.08), 0.92)} 100%)`, shadow: "rgba(0,0,0,0.42)",
  };
}

/** 卡的远端边不越过离画面边 limit 的那条线时,允许的最大宽(照 TermCard 的 tWidthWithin) */
function gcWidthWithin(SW: number, side: string, scale: number, ox: number, limit: number) {
  const edge = 120; // .hud-anchor 左右锚点离边 120px
  const s = Math.max(0.2, scale);
  // 左锚点:缩放原点在左边,右缘 = 120 + ox + W·s;右锚点:新动效根元素从右缘缩放,左缘 = SW−120+ox − W·s
  return side === "right" ? (SW - edge + ox - limit) / s : (SW - limit - edge - ox) / s;
}

function GrowthCurve({ params, playToken }: EffectProps<GrowthCurveParams>) {
  const { position, kicker, kickerZh, points, unit, drawMs, caption, accent } = params;
  const tp = params as GrowthCurveParams & { __start?: number; __end?: number; scale?: number; __scale?: number;  centerOnStage?: boolean };
  const tRaw = useCardElapsed(tp, playToken);
  const gid = useId().replace(/:/g, "");
    const SW = 1920, SH = 1080;
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const END = typeof tp.__end === "number" ? Math.max(0, tp.__end - (tp.__start ?? 0)) : Infinity;
  const t = Math.max(0, Math.min(END, tRaw));
  const spd = usePlateSpeed(); // 动画速度:动作按它加快,退场仍在结束时刻收完
  const ts = t * spd;

  const onStage = tp.centerOnStage === true; // 「换卡居中」交给 hud.css 的中心缩放
  const side = onStage || position === "center" ? "center" : position === "right" ? "right" : "left";
  const low = !onStage && side === "center";
  const s = Math.max(0.2, (Number(tp.scale) || 1) * (Number(tp.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const pal = gcPalette(accent);
  const dir = side === "right" ? 1 : -1; // 从哪侧进、往哪侧收

  // ── 最大宽:躲脸只按默认大小、默认位置算,不出画按真实大小、偏移算 ──
  const maxW =
    side === "center"
      ? Math.min((SW - 2 * GC_MARGIN) / s, low ? 1300 : Infinity)
      : Math.min(
          gcWidthWithin(SW, side, 1, 0, SW - GC_FACE_X),
          gcWidthWithin(SW, side, s, ox, GC_MARGIN),
        );

  // ── 数据 ──
  const pts0 = gcParsePoints(points);
  const pts = pts0.length ? pts0 : [{ label: "", raw: "0", v: 0, dec: 0, comma: false }];
  const n = pts.length;
  const fi = params.focus === "max" ? pts.reduce((b, p, i) => (p.v > pts[b].v ? i : b), 0) : n - 1;
  const fp = pts[fi];
  const deltaTxt = params.delta === false || fi === 0 ? "" : gcDelta(pts[0].v, fp.v);
  const finalTxt = gcFmt(fp.v, fp);

  // ── 版式 ──
  const wide0 = low;
  // 横排的栏宽按默认大小定(拉大后放不下就整体缩,不退回竖排,保证拉大不会反而变窄)
  const maxW1 =
    side === "center"
      ? Math.min(SW - 2 * GC_MARGIN, low ? 1300 : Infinity)
      : gcWidthWithin(SW, side, 1, 0, SW - GC_FACE_X);
  const LW = wide0 ? Math.min(380, maxW1 * 0.97 - (GC_PAD_L + 28 + GC_CW + 36)) : 0;
  const wide = wide0 && LW >= 260; // 太窄横排不下就退回竖排
  const W = wide ? GC_PAD_L + LW + 28 + GC_CW + 36 : 520;
  const textW = wide ? LW : W - GC_PAD_L - GC_PAD_R;
  const CH = low && wide ? 210 : 300; // 图表高(人脸下方那条带矮,图表压扁一点)
  const BASE = CH - 20;
  const plotH = BASE - GC_TOP;

  const kTxt = (kicker ?? "").trim();
  const kLines = kTxt ? gcGreedy(kTxt, 18, textW - 20, 0.84 - 0.6) : []; // 等宽字 0.6em + 字距 0.24em
  const tLines = gcTitleLines(kickerZh ?? "", textW, 30);
  const capTxt = (caption ?? "").trim();
  const fLines = capTxt ? gcGreedy(capTxt, 18, textW, 0.04) : [];

  // 大字一行:倍数药丸 + 数字 + 单位,太长先缩数字(最小 44px)
  const unitTxt = (unit ?? "").trim();
  const deltaW = deltaTxt ? gcW(deltaTxt, 18) + 24 + 14 : 0;
  const unitW = unitTxt ? gcW(unitTxt, 26) + 8 : 0;
  const numEm = Array.from(finalTxt).reduce((w, c) => w + (/[0-9]/.test(c) ? 0.58 : c === "-" ? 0.42 : 0.3), 0);
  const peakFs = Math.max(44, Math.min(80, Math.floor((440 - deltaW - unitW) / Math.max(0.5, numEm))));
  const peakW = deltaW + numEm * peakFs + unitW;

  const xGap = n > 1 ? (GC_X1 - GC_X0) / (n - 1) : GC_CW;
  const xlW = Math.max(50, Math.min(140, xGap - 6));
  const xlRows = Math.max(1, ...pts.map((p) => gcGreedy(p.label, 18, xlW).length || 1));
  const xlH = 40 + (xlRows - 1) * 22; // 横轴标签区(参考作品 40,标签折两行时加高)

  // 纵向:眉题 40 / 标题 74、行距 40.5 / 图表 196 / 底注 586 / 底 640(参考作品)
  let y = 40;
  const kTop = y;
  if (kLines.length) y += kLines.length * 22 + 12;
  const tTop = y;
  y += tLines.length * 40.5;
  const textBottom = tLines.length || kLines.length ? (tLines.length ? y : y - 12) : 40;
  let chartL: number, chartTop: number, footTop: number, H: number;
  if (wide) {
    chartL = GC_PAD_L + LW + 28;
    chartTop = 40 + 60;
    footTop = textBottom + 28;
    const leftBottom = fLines.length ? footTop + fLines.length * 24 : textBottom;
    H = Math.max(leftBottom + 34, chartTop + CH + xlH + 24);
  } else {
    chartL = 36;
    const lastW = tLines.length ? gcW(tLines[tLines.length - 1], 30, 0.02) : 0;
    const clash = tLines.length > 0 && GC_PAD_L + lastW + 16 > chartL + GC_CW - 4 - peakW; // 标题末行会撞上大字 → 图表往下让
    chartTop = !tLines.length && !kLines.length ? 40 + 60 : textBottom + (clash ? 56 : 41);
    footTop = chartTop + CH + xlH + 50;
    H = fLines.length ? footTop + fLines.length * 24 + 30 : chartTop + CH + xlH + 28;
  }

  // ── 尺寸落到屏幕:放不下先整体缩(躲人像只按默认大小),再防出画 ──
  const fitZ = Math.min(
    1,
    maxW / W,
    low ? (GC_LOW_BOTTOM - GC_LOW_TOP) / H : 1,
    (SH - 2 * GC_MARGIN) / (H * s),
  );
  const visH = H * s * fitZ;
  let shiftY = 0;
  if (low) {
    const top = GC_LOW_TOP + oy;
    shiftY = top < 24 ? 24 - top : top + visH > SH - 24 ? SH - 24 - (top + visH) : 0;
  } else if (!onStage) {
    const cy = SH / 2 + oy;
    shiftY = cy - visH / 2 < GC_MARGIN ? GC_MARGIN - (cy - visH / 2) : cy + visH / 2 > SH - GC_MARGIN ? SH - GC_MARGIN - (cy + visH / 2) : 0;
  }

  // ── 图表几何(照搬参考作品:单调三次插值,x 线性的贝塞尔段) ──
  const vals = pts.map((p) => p.v);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals);
  const span = hi - lo > 0 ? hi - lo : 1;
  const yOf = (v: number) => BASE - ((v - lo) / span) * plotH;
  const P = pts.map((p, i) => ({ x: n > 1 ? GC_X0 + ((GC_X1 - GC_X0) * i) / (n - 1) : GC_X1, y: yOf(p.v) }));
  const LAST = P[n - 1];
  const tan: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) m[i] = (P[i + 1].y - P[i].y) / (P[i + 1].x - P[i].x);
  if (n > 1) {
    tan[0] = m[0];
    tan[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  const segs = P.slice(0, -1).map((p, i) => {
    const h = P[i + 1].x - p.x;
    return { x0: p.x, x1: P[i + 1].x, y0: p.y, c1: p.y + (tan[i] * h) / 3, c2: P[i + 1].y - (tan[i + 1] * h) / 3, y1: P[i + 1].y };
  });
  const yAtX = (x: number) => {
    if (x <= P[0].x) return P[0].y;
    for (const sg of segs) {
      if (x <= sg.x1) {
        const u = (x - sg.x0) / (sg.x1 - sg.x0);
        const v = 1 - u;
        return v * v * v * sg.y0 + 3 * v * v * u * sg.c1 + 3 * v * u * u * sg.c2 + u * u * u * sg.y1;
      }
    }
    return LAST.y;
  };
  let dLine = `M${P[0].x.toFixed(2)},${P[0].y.toFixed(2)}`;
  segs.forEach((sg) => {
    const k = (sg.x1 - sg.x0) / 3;
    dLine += ` C${(sg.x0 + k).toFixed(2)},${sg.c1.toFixed(2)} ${(sg.x0 + 2 * k).toFixed(2)},${sg.c2.toFixed(2)} ${sg.x1.toFixed(2)},${sg.y1.toFixed(2)}`;
  });
  const dArea = `${dLine} L${LAST.x.toFixed(2)},${BASE} L${P[0].x.toFixed(2)},${BASE} Z`;
  const gridY = [20, 40, 60].map((v) => BASE - (v / 66) * plotH); // 参考作品三条网格的相对高度

  // ── 时间轴(秒) ──
  const drawA = 0.62;
  const drawB = drawA + Math.max(0.4, (Number(drawMs) || 1600) / 1000);
  const countB = drawB + 0.93;
  const outA = END - GC_OUT / spd;
  const drawEase = (x: number) => gcIOCubic(x) * 0.25 + (1 - Math.pow(1 - x, 2.2)) * 0.75;
  const headXAt = (tt: number) => gcLerp(P[0].x, LAST.x, drawEase(gcProg(tt, drawA, drawB)));
  const reach = P.map((p, i) => {
    if (i === 0 || n < 2) return drawA;
    let a = drawA;
    let b = drawB;
    for (let k = 0; k < 40; k++) {
      const mid = (a + b) / 2;
      if (headXAt(mid) < p.x) a = mid;
      else b = mid;
    }
    return b;
  });
  const ex = (delay: number) => gcICubic(gcProg(t, outA + delay, END - 0.12 + delay * 0.4));

  // 卡身:横向揭开 + 外侧滑入
  const ci = gcOQuint(gcProg(ts, 0, 0.62));
  const ce = ex(0.12);
  const cardOp = gcClamp(ci * 1.6) * (1 - ce);
  const cardX = dir * ((1 - ci) * 46 + ce * 36);
  const cardS = 0.96 + 0.04 * ci;
  const wipe = (1 - gcOCubic(gcProg(ts, 0, 0.55))) * 100;
  const clip = side === "right" ? `inset(0 0 0 ${wipe.toFixed(2)}% round 28px)` : `inset(0 ${wipe.toFixed(2)}% 0 0 round 28px)`;
  const edgeS = gcOCubic(gcProg(ts, 0.1, 0.6));

  // 眉题:逐字打出
  const kp = gcProg(ts, 0.18, 0.7);
  const kAll = kLines.join("\n");
  const kN = Math.round(Array.from(kAll).length * kp);
  const kShown = Array.from(kAll).slice(0, kN).join("");
  const kOp = gcClamp(kp * 4) * (1 - ex(0));

  // 网格 / 图表整体
  const gp = gcOCubic(gcProg(ts, 0.35, 0.95));
  const chartOut = ex(0);

  // 曲线揭开 + 笔尖
  const drawing = ts >= drawA;
  const hx = headXAt(ts);
  const hy = yAtX(hx);
  const revealW = drawing ? hx + 20 + (ts >= drawB ? 20 : 0) : 0;
  const settle = gcProg(ts, drawB, drawB + 0.25);
  const breathe = 0.5 + 0.5 * Math.sin((ts - drawB) * Math.PI * 1.6);
  const headR = drawing ? gcLerp(6, 8, settle) : 0;
  const haloR = gcLerp(20, 26 + 6 * breathe * settle, settle);
  const haloOp = (drawing ? 1 : 0) * gcLerp(0.9, 0.6 + 0.4 * breathe, settle);

  // 停留:面积呼吸 + 高光扫一次
  const areaTop = 0.34 + 0.1 * breathe * settle;
  const sp = gcProg(ts, countB - 0.1, countB + 1.1);
  const so = gcLerp(-0.2, 1.1, gcIOCubic(sp));
  const shineOp = sp > 0 && sp < 1 ? 0.85 : 0;
  const glowOp = 0.45 + 0.2 * breathe * settle;

  // 重点波纹:到达时一圈,之后慢心跳
  const ringAt = fi === n - 1 ? drawB - 0.05 : reach[fi] - 0.05;
  const ring = (start: number, period: number) => {
    const local = ts - start;
    if (local < 0 || (!period && local > 0.9)) return { r: 0, o: 0 };
    const ph = period ? (local % period) / period : gcClamp(local / 0.9);
    return { r: 8 + 34 * gcOCubic(ph), o: (1 - ph) * 0.8 };
  };
  const r1 = ring(ringAt, 0);
  const r2 = ring(Math.max(ringAt, drawB) + 0.4, 1.25);

  // 大字滚动
  const cp = gcProg(ts, drawB, countB);
  const shownTxt = gcFmt(fp.v * (1 - Math.pow(1 - cp, 3)), fp);
  const lin = gcOCubic(gcProg(ts, drawB - 0.15, drawB + 0.3));
  const punch = ts >= countB ? Math.exp(-Math.max(0, ts - countB) * 7) : 0;
  const peakS = (0.9 + 0.1 * lin) * (1 + 0.06 * punch);
  const dpv = gcOBack(gcProg(ts, countB - 0.05, countB + 0.35));
  const footP = gcOCubic(gcProg(ts, countB, countB + 0.5));

  const txtF: CSSProperties = {};
  const dimC = (c: string) => (c);
  const abs: CSSProperties = { position: "absolute" };

  const rootStyle: CSSProperties = {
    ["--hud-acc" as string]: ACCENT_VAR[accent],
    ...offsetVars(params),
    opacity: 1, // 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的动作负责
    ...(side === "right" && !onStage ? { transformOrigin: "right center" } : {}),
    ...(low ? { top: GC_LOW_TOP, bottom: "auto", ["--anchor-tf" as string]: "translateX(-50%)", transformOrigin: "50% 0" } : {}),
  };

  return (
    <div className={`hud gcvx hud-anchor hud-anchor--${side} is-in`} style={rootStyle}>
      <div style={{ position: "relative", width: W * fitZ, height: H * fitZ, transform: shiftY ? `translateY(${(shiftY / s).toFixed(2)}px)` : undefined }}>
        <div style={{ ...abs, left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: fitZ < 1 ? `scale(${fitZ.toFixed(4)})` : undefined, fontFamily: GC_FONT, color: "#fff" }}>
          <div
            data-fx-role="group"
            style={{
              ...abs, left: 0, top: 0, width: W, height: H, borderRadius: 28, overflow: "hidden", boxSizing: "border-box",
              opacity: cardOp, clipPath: clip, transformOrigin: side === "right" ? "100% 50%" : "0% 50%",
              transform: `translateX(${cardX.toFixed(2)}px) scale(${cardS.toFixed(4)})`,
              ...({
                    background: pal.bg,
                    boxShadow: `0 30px 80px ${pal.shadow}, inset 0 0 0 1px ${pal.inset}`,
                    WebkitBackdropFilter: "blur(18px)",
                    backdropFilter: "blur(18px)",
                  }),
            }}
          >
            <div style={{ ...abs, inset: 0, pointerEvents: "none", background: `radial-gradient(420px 260px at 85% 18%, ${pal.sheen}, transparent 70%)` }} />
            <div style={{ ...abs, left: side === "right" ? undefined : 0, right: side === "right" ? 0 : undefined, top: 0, bottom: 0, width: 4, background: `linear-gradient(180deg, ${pal.hi}, ${pal.edgeB})`, transformOrigin: "50% 0%", transform: `scaleY(${edgeS.toFixed(4)})` }} />

            {kLines.length > 0 && (
              <div style={{ ...abs, left: GC_PAD_L, top: kTop, width: textW, display: "flex", alignItems: "flex-start", gap: 12, opacity: kOp, ...txtF }}>
                <span style={{ flex: "none", width: 8, height: 8, marginTop: 7, borderRadius: "50%", background: pal.hi, boxShadow: `0 0 12px ${pal.hi}` }} />
                <span data-small-text="kicker" style={{ fontFamily: GC_MONO, fontSize: 18, lineHeight: "22px", letterSpacing: "0.24em", color: pal.kick, whiteSpace: "pre" }}>
                  {kShown}
                  {kN < Array.from(kAll).length && kp > 0 ? "▍" : ""}
                </span>
              </div>
            )}

            {tLines.length > 0 && (
              <div data-fx-role="label" data-small-text="kickerZh" style={{ ...abs, left: GC_PAD_L, top: tTop, width: textW, fontSize: 30, fontWeight: 600, lineHeight: "40.5px", letterSpacing: "0.02em", ...txtF }}>
                {tLines.map((ln, i) => {
                  const a = gcOQuint(gcProg(ts, 0.28 + i * 0.1, 0.85 + i * 0.1));
                  const e = ex(0.02 + i * 0.03);
                  return (
                    <span key={i} style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", color: i === 0 ? pal.ttl : pal.t2, transform: `translateY(${((1 - a) * 44 - e * 44).toFixed(2)}px)` }}>{ln}</span>
                    </span>
                  );
                })}
              </div>
            )}

            <div style={{ ...abs, left: chartL, top: chartTop, width: GC_CW, height: CH + xlH, opacity: 1 - chartOut, transform: `translateY(${(chartOut * 14).toFixed(2)}px)` }}>
              <svg width={GC_CW} height={CH} viewBox={`0 0 ${GC_CW} ${CH}`} style={{ ...abs, left: 0, top: 0, overflow: "visible" }}>
                <defs>
                  <linearGradient id={`${gid}l`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={pal.lineA} />
                    <stop offset="1" stopColor={pal.lineB} />
                  </linearGradient>
                  <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={pal.area} stopOpacity={areaTop.toFixed(3)} />
                    <stop offset="1" stopColor={pal.area2} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={`${gid}s`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={GC_CW} y2="0">
                    <stop offset={gcClamp(so - 0.12).toFixed(3)} stopColor="#ffffff" stopOpacity={0} />
                    <stop offset={gcClamp(so).toFixed(3)} stopColor="#ffffff" stopOpacity={shineOp} />
                    <stop offset={gcClamp(so + 0.12).toFixed(3)} stopColor="#ffffff" stopOpacity={0} />
                  </linearGradient>
                  <filter id={`${gid}g`} x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="6" />
                  </filter>
                  <radialGradient id={`${gid}d`}>
                    <stop offset="0" stopColor={pal.halo0} stopOpacity={0.9} />
                    <stop offset="1" stopColor={pal.area} stopOpacity={0} />
                  </radialGradient>
                  <clipPath id={`${gid}c`}>
                    <rect x={-20} y={-40} width={revealW.toFixed(2)} height={CH + 80} />
                  </clipPath>
                </defs>
                <g>
                  {gridY.map((gy, i) => (
                    <line key={i} x1={0} y1={gy.toFixed(2)} y2={gy.toFixed(2)} x2={(GC_CW * gcOCubic(gcProg(ts, 0.35 + i * 0.06, 0.95 + i * 0.06))).toFixed(2)} stroke={pal.grid} strokeWidth={1} strokeDasharray="2 6" />
                  ))}
                  <line x1={0} y1={BASE} y2={BASE} x2={(GC_CW * gp).toFixed(2)} stroke={gcCss(pal.base, 0.35)} strokeWidth={1} />
                </g>
                {n > 1 && (
                  <g clipPath={`url(#${gid}c)`}>
                    <path d={dArea} fill={`url(#${gid}a)`} />
                    <path d={dLine} fill="none" stroke={pal.area} strokeWidth={10} strokeLinecap="round" opacity={glowOp.toFixed(3)} filter={`url(#${gid}g)`} />
                    <path data-fx-role="trace" d={dLine} fill="none" stroke={`url(#${gid}l)`} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
                    <path d={dLine} fill="none" stroke={`url(#${gid}s)`} strokeWidth={4.5} strokeLinecap="round" />
                  </g>
                )}
                <g>
                  {P.map((p, i) => {
                    const dp = gcOCubic(gcProg(ts, reach[i], reach[i] + 0.4));
                    const foc = i === fi;
                    return <line key={i} x1={p.x} x2={p.x} y1={BASE} y2={gcLerp(BASE, p.y + (foc ? 10 : 8), dp).toFixed(2)} opacity={dp.toFixed(3)} stroke={foc ? pal.dropHi : pal.drop} strokeWidth={1} strokeDasharray="3 4" />;
                  })}
                </g>
                <g>
                  {P.map((p, i) => {
                    const pp = gcProg(ts, reach[i] - 0.02, reach[i] + 0.34);
                    const sc = pp > 0 ? gcOBack(pp) : 0;
                    const foc = i === fi;
                    // 最后一点被笔尖盖住,不另画
                    return <circle key={i} data-fx-role="pigment" cx={p.x} cy={p.y.toFixed(2)} r={Math.max(0, sc * (foc ? 8 : 6)).toFixed(2)} opacity={i === n - 1 && n > 1 ? 0 : 1} fill={foc ? "#ffffff" : pal.dotFill} stroke={foc ? pal.hi : pal.dotStroke} strokeWidth={3} />;
                  })}
                </g>
                <circle cx={P[fi].x} cy={P[fi].y.toFixed(2)} r={r1.r.toFixed(2)} opacity={r1.o.toFixed(3)} fill="none" stroke={pal.hi} strokeWidth={2} />
                <circle cx={P[fi].x} cy={P[fi].y.toFixed(2)} r={r2.r.toFixed(2)} opacity={r2.o.toFixed(3)} fill="none" stroke={pal.hi} strokeWidth={2} />
                <circle cx={hx.toFixed(2)} cy={hy.toFixed(2)} r={haloR.toFixed(2)} opacity={haloOp.toFixed(3)} fill={`url(#${gid}d)`} />
                <circle cx={hx.toFixed(2)} cy={hy.toFixed(2)} r={headR.toFixed(2)} fill="#ffffff" />
              </svg>

              {/* 数值(重点的数值由大字显示) */}
              {P.map((p, i) => {
                if (i === fi) return null;
                const lp = gcOCubic(gcProg(ts, reach[i] + 0.04, reach[i] + 0.44));
                return (
                  <div key={i} style={{ ...abs, left: p.x, top: p.y - 44, transform: `translate(-50%, ${((1 - lp) * 10).toFixed(2)}px)`, opacity: lp.toFixed(3), fontFamily: GC_NUM, fontSize: 20, fontWeight: 600, color: pal.vl, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...txtF }}>
                    {pts[i].raw}
                  </div>
                );
              })}
              {/* 横轴标签 */}
              {P.map((p, i) => {
                const lp = gcOCubic(gcProg(ts, reach[i] + 0.04, reach[i] + 0.44));
                const left = Math.max(-28, Math.min(GC_CW + 28 - xlW, p.x - xlW / 2));
                return (
                  <div key={i} style={{ ...abs, left, top: CH, width: xlW, textAlign: "center", fontSize: 18, lineHeight: "22px", letterSpacing: "0.04em", color: i === fi ? (pal.xlHi) : dimC(pal.xl), fontWeight: i === fi ? 600 : 400, opacity: (gcClamp(gp * 1.5) * (0.35 + 0.65 * lp)).toFixed(3), ...txtF }}>
                    {pts[i].label}
                  </div>
                );
              })}
              {/* 大字:倍数药丸 + 滚动数字 + 单位 */}
              <div style={{ ...abs, right: 4, top: -52, display: "flex", alignItems: "flex-end", whiteSpace: "nowrap", transformOrigin: "100% 100%", opacity: lin.toFixed(3), transform: `translateY(${((1 - lin) * 16).toFixed(2)}px) scale(${peakS.toFixed(4)})`, ...txtF }}>
                {deltaTxt && (
                  <span style={{ display: "inline-block", marginRight: 14, marginBottom: 14, padding: "5px 12px", borderRadius: 999, fontSize: 18, fontWeight: 600, color: pal.deltaInk, background: `linear-gradient(90deg, ${pal.hi}, ${pal.deltaB})`, opacity: gcClamp(dpv).toFixed(3), transform: `scale(${Math.max(0, dpv).toFixed(4)})` }}>
                    {deltaTxt}
                  </span>
                )}
                <span style={{ fontFamily: GC_NUM, fontSize: peakFs, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", background: `linear-gradient(180deg, #ffffff 30%, ${pal.peakB} 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  {shownTxt}
                </span>
                {unitTxt && <span style={{ fontSize: 26, fontWeight: 600, color: pal.unit, marginLeft: 8, marginBottom: Math.round(peakFs * 0.1) }}>{unitTxt}</span>}
              </div>
            </div>

            {fLines.length > 0 && (
              <div data-fx-role="label" data-small-text="caption" style={{ ...abs, left: GC_PAD_L, top: footTop, width: textW, textAlign: wide ? "left" : "right", fontSize: 18, lineHeight: "24px", letterSpacing: "0.04em", color: dimC(pal.foot), opacity: (footP * (1 - ex(0.04))).toFixed(3), transform: `translateY(${((1 - footP) * 8).toFixed(2)}px)`, ...txtF }}>
                {fLines.map((ln, i) => (
                  <div key={i} style={{ whiteSpace: "nowrap" }}>{ln}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


export const growthCurveDef: EffectDef<GrowthCurveParams> = {
  id: "growth-curve",
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
    focus: "last",
    delta: true,
    ...OFFSET_DEFAULTS,
  },
  controls: [
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
    {
      key: "focus",
      label: "大字标哪个点(精修版)",
      type: "select",
      options: [
        { label: "最后一个点", value: "last" },
        { label: "最高的点", value: "max" },
      ],
    },
    { key: "delta", label: "大字旁显示首尾倍数(精修版)", type: "toggle" },
    ...OFFSET_CONTROLS,
  ],
  Component: GrowthCurve,
};
