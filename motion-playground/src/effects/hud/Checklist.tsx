import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
} from "./accent";

export interface ChecklistParams {
  stepMs?: number;
  theme: "dark" | "light";
  position: "left" | "right" | "top-left";
  title: string;
  items: string; // 用 | 分隔
  checked: number; // 已完成数量
  /** 末尾几项打码上锁(显示 ??? + 锁,不剧透后面讲什么) */
  locked?: number;
  /** 新动效左上角的英文小标签(空 = 不显示) */
  kicker?: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

const STAGGER = 160;


/* ── 精修版:「步骤清单」板,动法逐拍照搬隔离 Opus 的一次性作品 ──
   卡片一行一行往下长;每条:出现 → 0.55s 后打勾三拍(圆圈描边 → 实心弹出带回弹 → 勾线写出 + 光晕爆开);
   左侧竖线 / 标题下进度条 / 右上「n / 总数」三处同步;最新一条呼吸光、旧的退到 68%;
   全部勾完一道光扫过;有终点时最后 0.5s 向外滑出淡掉。 */
const CK_FIRST = 0.2; // 第一条出现
const CK_CHECK = 0.55; // 出现后多久打勾
const CK_OUT = 0.5; // 退场时长
const CK_W = 600; // 参考作品卡宽
const CK_PAD_T = 34;
const CK_PAD_B = 30;
const CK_PAD_X = 38; // 卡宽被安全区收窄时左右留白收到 30,好让参考作品那样的标题仍排一行
const CK_KICK_H = 32; // 小标签 + 计数那一行
const ckClamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const ckProg = (t: number, s: number, d: number) => ckClamp((t - s) / d, 0, 1);
const ckOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const ckInCubic = (x: number) => x * x * x;
const ckOutBack = (x: number) => {
  const c = 1.9;
  const c3 = c + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
const ckOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

/* 长内容排版:先换行(最多两行、从中间自然断开、行首不放标点),两行还放不下再缩字号,有下限 */
const ckGlyph = (ch: string) => (/[⺀-￿]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.68 : ch === " " ? 0.3 : 0.56);
const ckTextW = (s: string, fs: number, ls: number) => Array.from(s).reduce((w, ch) => w + (ckGlyph(ch) + ls) * fs, 0);
const CK_PUNCT = /^[，。、！？；：,.!?;:）)」』”’》%]/;
/** 一分为二:有空格挑离中点最近的空格;没有就按宽度对半,英文单词不拆、行首不放标点 */
function ckSplit2(s: string): [string, string] {
  const cs = Array.from(s);
  const total = cs.reduce((w, ch) => w + ckGlyph(ch), 0);
  let acc = 0;
  let cut = 1;
  let bestSpace = -1;
  let bestD = Infinity;
  cs.forEach((ch, i) => {
    if (acc < total / 2) cut = i + 1;
    if (ch === " " && i > 0 && i < cs.length - 1 && Math.abs(acc - total / 2) < bestD) {
      bestD = Math.abs(acc - total / 2);
      bestSpace = i;
    }
    acc += ckGlyph(ch);
  });
  if (bestSpace > 0) return [cs.slice(0, bestSpace).join(""), cs.slice(bestSpace + 1).join("")];
  // 中文按词断(「参考视频」不拆成「参考视 / 频」):挑离中点最近的词边界
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ index: number }> } }).Segmenter;
  if (Seg) {
    const u16ToCp: number[] = [];
    cs.forEach((ch, i) => { for (let j = 0; j < ch.length; j++) u16ToCp.push(i); });
    let best = -1;
    let bd = Infinity;
    for (const sg of new Seg("zh", { granularity: "word" }).segment(s)) {
      const at = u16ToCp[sg.index] ?? -1;
      if (at <= 0 || at >= cs.length || CK_PUNCT.test(cs[at])) continue;
      const w = cs.slice(0, at).reduce((x, ch) => x + ckGlyph(ch), 0);
      const d = Math.abs(w - total / 2);
      if (d < bd) { bd = d; best = at; }
    }
    if (best > 0 && bd <= total * 0.25) return [cs.slice(0, best).join(""), cs.slice(best).join("")];
  }
  const word = /[A-Za-z0-9]/;
  while (cut > 1 && cut < cs.length && word.test(cs[cut - 1]) && word.test(cs[cut])) cut--;
  while (cut < cs.length - 1 && CK_PUNCT.test(cs[cut])) cut++;
  cut = Math.max(1, Math.min(cs.length - 1, cut));
  return [cs.slice(0, cut).join(""), cs.slice(cut).join("")];
}
/** 两行在下限字号还放不下时的兜底:按宽度贪心折成多行(标点跟着上一行) */
function ckGreedy(s: string, fs: number, ls: number, maxW: number): string[] {
  const lines: string[] = [];
  let cur = "";
  Array.from(s).forEach((ch) => {
    if (cur && !CK_PUNCT.test(ch) && ckTextW(cur + ch, fs, ls) > maxW) {
      lines.push(cur);
      cur = ch === " " ? "" : ch;
    } else cur += ch;
  });
  if (cur) lines.push(cur);
  return lines;
}
/** 单行原字号 → 单行微缩到 oneLineMin → 两行(从原字号往下缩到 min) → 下限字号多行兜底 */
function ckFit(s: string, maxW: number, base: number, oneLineMin: number, min: number, ls: number) {
  for (let fs = base; fs >= oneLineMin; fs--) if (ckTextW(s, fs, ls) <= maxW) return { fs, lines: [s] };
  if (Array.from(s).length >= 2) {
    const two = ckSplit2(s);
    for (let fs = base; fs >= min; fs--) if (Math.max(ckTextW(two[0], fs, ls), ckTextW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  }
  return { fs: min, lines: ckGreedy(s, min, ls, maxW) };
}
/** 卡宽上限(安全区):左锚右边缘 ≤ x700、右锚左边缘 ≥ x1220。
 *  人脸线只按默认大小、默认位置(scale=1、offsetX=0)算:拉大就真变大、拖开卡宽锁住只平移;
 *  出画按真实 scale/offsetX 算(离边 48;右锚从右边缩放,右缘固定不外凸) */
function ckMaxWidth(position: string, ox: number, s: number) {
  if (position === "right") {
    // 锚点 right:120,缩放原点在右边:右缘固定在 1920−120+ox,左边缘 = 右缘 − W·s
    const face = 1920 - 120 - 1220; // 人脸线按 scale=1、ox=0:左缘 = 1800 − W ≥ 1220
    return Math.min(face, (1920 - 120 + ox - 48) / s);
  }
  // left / top-left:锚点 left:120,缩放原点在左边
  return Math.min(700 - 120, (1920 - 48 - 120 - ox) / s);
}
/** 卡高上限(舞台像素,未乘 scale):上下各留 40 */
function ckMaxHeight(position: string, oy: number, s: number) {
  if (position === "top-left") return (1040 - 96 - oy) / s;
  return (2 * (500 - Math.abs(oy))) / s;
}

type CkRGB = [number, number, number];
const ckHex = (h: string): CkRGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as CkRGB;
const ckMix = (a: CkRGB, b: CkRGB, k: number): CkRGB => a.map((v, i) => Math.round(v + (b[i] - v) * k)) as CkRGB;
const ckRgb = (c: CkRGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** 配色:宝石青直接用参考作品的原色;其余强调色按同样的明暗关系从主色推出来 */
function ckPalette(accent: string) {
  if (accent === "teal") {
    return {
      hi: "#3ff2d2", main: "#22dcbf", deep: "#12b8a6", light: "#5cffe2", edgeTop: "#2ff0cf", rail: "#2fe6c8",
      ring: "rgba(160,255,240,0.55)", tick: "#062a26", glow: [60, 255, 220] as CkRGB, sheen: [120, 255, 230] as CkRGB,
      count: "#bff", panelA: "rgba(10,30,32,0.86)", panelB: "rgba(6,16,20,0.80)",
    };
  }
  const A = ckHex(/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? ACCENT_SWATCH.blue);
  const W: CkRGB = [255, 255, 255];
  const K: CkRGB = [0, 0, 0];
  return {
    hi: ckRgb(ckMix(A, W, 0.22)), main: ckRgb(A), deep: ckRgb(ckMix(A, K, 0.2)), light: ckRgb(ckMix(A, W, 0.38)),
    edgeTop: ckRgb(ckMix(A, W, 0.15)), rail: ckRgb(ckMix(A, W, 0.1)),
    ring: ckRgb(ckMix(A, W, 0.6), 0.55), tick: ckRgb(ckMix(A, K, 0.86)), glow: ckMix(A, W, 0.3), sheen: ckMix(A, W, 0.5),
    count: ckRgb(ckMix(A, W, 0.72)), panelA: ckRgb(ckMix([8, 12, 14], A, 0.1), 0.86), panelB: ckRgb(ckMix([5, 8, 10], A, 0.05), 0.8),
  };
}

function Checklist({ params, playToken }: EffectProps<ChecklistParams>) {
  const { position, title, items, accent } = params;
  const tp = params as ChecklistParams & { __t?: number; __start?: number; __end?: number };
  const t = useCardElapsed(tp, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const P = (a: number, o: number, d: number) => ckProg(t, a + o / spd, d / spd);
  const end = tp.__end;
  const dur = typeof end === "number" ? Math.max(0, end - (tp.__start ?? 0)) : null;
  const pal = ckPalette(accent);
  const list = items.split("|").map((s) => s.trim()).filter(Boolean);
  const n = list.length;
  const lockedN = ckClamp(Math.round(params.locked ?? 0), 0, n);
  const doneN = ckClamp(Math.round(params.checked ?? 0), 0, n - lockedN);
  const gap = Math.max(0.1, (params.stepMs ?? STAGGER) / 1000);
  const right = position === "right";

  // ── 排版:卡宽受安全区限制;标题 44 起不缩(只换行),每条 33 → 单行微缩到 30 → 两行 ──
  const extra = params as { scale?: number; __scale?: number };
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const W = Math.floor(Math.min(CK_W, ckMaxWidth(position, params.offsetX ?? 0, cardScale)));
  const padX = W < CK_W ? 30 : CK_PAD_X;
  const inner = W - padX * 2;
  const tFit = ckFit(title, inner, 44, 44, 44, 0.02);
  const titleLH = tFit.fs * 1.2;
  const headH = CK_KICK_H + 12 + tFit.lines.length * titleLH + 20 + 4 + 22;
  const numW = ckTextW("00", 16, 0.1) + 12;
  const textMax = inner - 48 - 24 - numW;
  const rows = list.map((s, i) => {
    const locked = i >= n - lockedN;
    const f = ckFit(locked ? "? ? ?" : s, textMax, 33, 30, 30, 0.01);
    const lh = f.fs * 1.25;
    return { ...f, locked, lh, textH: f.lines.length * lh };
  });
  // 条数多放不下:先收紧行距(行上下留白 30 → 14),还不够再整体等比缩
  const maxH = ckMaxHeight(position, params.offsetY ?? 0, cardScale);
  const rowHOf = (vpad: number) => rows.map((r) => (r.lines.length > 1 ? Math.max(48 + vpad, r.textH + vpad * 0.55) : 48 + vpad));
  const fullOf = (hs: number[]) => CK_PAD_T + headH + hs.reduce((a, b) => a + b, 0) + CK_PAD_B;
  let vpad = 30;
  while (vpad > 14 && fullOf(rowHOf(vpad)) > maxH) vpad--;
  const rowH = rowHOf(vpad);
  const fullH = fullOf(rowH);
  const k = Math.max(0.6, Math.min(1, maxH / fullH));
  const centers: number[] = [];
  rowH.reduce((y, h) => (centers.push(y + h / 2), y + h), 0);

  // ── 整卡进/出 ──
  const pin = ckOutExpo(P(0, 0, 0.6));
  const pout = dur == null ? 0 : ckInCubic(ckProg(t, dur - CK_OUT / spd, CK_OUT / spd));
  const px = (-50 * (1 - pin) - 70 * pout) * (right ? -1 : 1);
  const edge = ckOutCubic(P(0, 0.05, 0.5));
  const kick = P(0, 0.15, 0.4);

  // ── 各条 ──
  const appear = (i: number) => CK_FIRST + gap * i;
  let done = 0;
  let activeIdx = -1;
  const rs = rows.map((r, i) => {
    const t0 = appear(i);
    const canCheck = i < doneN;
    const tc = t0 + CK_CHECK / spd;
    const a = ckOutCubic(P(t0, 0, 0.5));
    const ringP = ckOutCubic(P(t0, 0.05, 0.4));
    const cp = canCheck ? ckProg(t, tc, 0.35 / spd) : 0;
    const fillS = canCheck ? ckOutBack(ckProg(t, tc, 0.32 / spd)) : 0;
    const tickP = canCheck ? ckOutCubic(ckProg(t, tc + 0.1 / spd, 0.28 / spd)) : 0;
    if (t >= t0) activeIdx = i;
    done += ckOutCubic(cp);
    // 打勾那一下光晕爆开;勾完且还是最新一条时轻轻呼吸
    const burst = cp > 0 ? Math.sin(Math.PI * ckProg(t, tc, 0.6 / spd)) : 0;
    const breath = cp >= 1 ? 0.18 + 0.12 * Math.sin((t - tc) * spd * 4.2) : 0;
    const nextA = i + 1 < n ? P(appear(i + 1), 0, 0.4) : 0;
    const g = Math.max(burst, breath * (1 - nextA));
    // 旧条目退到 68%;没讲到的(未勾)再灰一档,上锁的更灰
    const dim = (1 - 0.32 * nextA) * (r.locked ? 0.45 : canCheck ? 1 : 0.6);
    return { ...r, a, ringP, fillS, tickP, burst, g, dim };
  });
  void activeIdx;
  let listH = 0;
  let railH = 0;
  rows.forEach((_, i) => {
    const grow = ckOutCubic(P(appear(i), -0.05, 0.45));
    listH += rowH[i] * grow;
    if (i > 0) railH += (centers[i] - centers[i - 1]) * grow;
  });
  let shown = 0;
  rows.forEach((_, i) => (shown += ckOutCubic(P(appear(i), -0.05, 0.45))));
  const railP = shown > 1 ? ckClamp((done - 1) / (shown - 1), 0, 1) : 0;
  const whole = Math.floor(done + 1e-6);
  let pulse = 0;
  for (let m = 0; m < doneN; m++) {
    const q = P(appear(m), CK_CHECK + 0.2, 0.4);
    if (q > 0 && q < 1) pulse = Math.max(pulse, Math.sin(Math.PI * q));
  }
  // 全部勾完:一道光扫过卡片
  const allDone = n > 0 && doneN === n ? appear(n - 1) + (CK_CHECK + 0.25) / spd : Infinity;
  const sw = ckProg(t, allDone, 0.55 / spd);
  const panelH = CK_PAD_T + headH + listH + CK_PAD_B;
  let ci = 0;

  return (
    // 有终点时退场由自己收(滑出 + 淡出),行内 opacity:1 盖掉 hud.css 通用的 [data-outro] .hud 淡出,免得叠两层
    // 右锚点从右边缘放大(右缘固定往左长);换卡居中时交给 CSS 的中心缩放
    <div className={`hud hud-anchor hud-anchor--${position}`} style={{ ...offsetVars(params), ...(dur != null ? { opacity: 1 } : null), ...(right && (params as { centerOnStage?: boolean }).centerOnStage !== true ? { transformOrigin: "100% 50%" } : null) }}>
      {/* 外框按最终高度占位,卡片从顶边往下长,锚点不随生长上下漂 */}
      <div style={{ position: "relative", width: W * k, height: fullH * k }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, transform: `scale(${k.toFixed(4)})`, transformOrigin: "0 0" }}>
          <div
            data-fx-role="group"
            style={{
              position: "relative", width: W, height: panelH, padding: `${CK_PAD_T}px ${padX}px ${CK_PAD_B}px`, boxSizing: "border-box",
              borderRadius: 22, overflow: "hidden", color: "#fff",
              fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
              background: `linear-gradient(160deg, ${pal.panelA}, ${pal.panelB})`,
              boxShadow: `0 24px 60px rgba(0,0,0,0.35), inset 0 0 0 1px ${ckRgb(pal.sheen, 0.14)}`,
              filter: undefined,
              transformOrigin: right ? "100% 50%" : "0 50%",
              opacity: +(pin * (1 - pout)).toFixed(4),
              transform: `translateX(${px.toFixed(2)}px) scale(${(0.97 + 0.03 * pin).toFixed(4)})`,
            }}
          >
            <div style={{ position: "absolute", left: 0, top: 0, width: 5, height: "100%", background: `linear-gradient(${pal.edgeTop}, ${pal.deep})`, transformOrigin: "50% 0", transform: `scaleY(${edge.toFixed(4)})` }} />
            <div
              style={{
                position: "absolute", top: "-20%", left: 0, width: 180, height: "140%", pointerEvents: "none",
                background: `linear-gradient(90deg, ${ckRgb(pal.sheen, 0)}, ${ckRgb(pal.sheen, 0.16)}, ${ckRgb(pal.sheen, 0)})`,
                opacity: sw > 0 && sw < 1 ? 1 : 0,
                transform: `translateX(${(-220 + (W + 300) * ckOutCubic(sw)).toFixed(1)}px) skewX(-18deg)`,
              }}
            />
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: CK_KICK_H }}>
                <span style={{ fontSize: 17, letterSpacing: "0.32em", color: pal.hi, fontWeight: 600, opacity: +kick.toFixed(3), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 12 }}>{params.kicker ?? "STEP BY STEP"}</span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em", fontSize: 20, color: pal.count, whiteSpace: "nowrap",
                    opacity: +P(0, 0.2, 0.4).toFixed(3), transform: `scale(${(1 + 0.18 * pulse).toFixed(3)})`,
                  }}
                >
                  <b style={{ color: pal.hi, fontSize: 26 }}>{whole}</b> / {n}
                </span>
              </div>
              <div style={{ marginTop: 12, fontSize: tFit.fs, fontWeight: 800, lineHeight: 1.2, letterSpacing: "0.02em", whiteSpace: "nowrap", textShadow: "0 2px 10px rgba(0,0,0,0.35)" }}>
                {tFit.lines.map((ln, li) => (
                  <div key={li}>
                    {Array.from(ln).map((ch) => {
                      const e = ckOutCubic(P(0, 0.08 + ci * 0.035, 0.45));
                      ci++;
                      return (
                        <span key={ci} style={{ display: "inline-block", whiteSpace: "pre", opacity: +e.toFixed(3), transform: `translateY(${(18 * (1 - e)).toFixed(2)}px)`, filter: `blur(${(6 * (1 - e)).toFixed(2)}px)` }}>
                          {ch}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ position: "relative", marginTop: 20, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                <i
                  style={{
                    position: "absolute", left: 0, top: 0, height: "100%", width: "100%", borderRadius: 2,
                    background: `linear-gradient(90deg, ${pal.deep}, ${pal.light})`, transformOrigin: "0 50%",
                    transform: `scaleX(${n ? (done / n).toFixed(4) : 0})`,
                  }}
                />
              </div>
            </div>
            <div style={{ position: "relative", marginTop: 22, height: listH }}>
              <div style={{ position: "absolute", left: 23, top: (rowH[0] ?? 78) / 2 - 9, width: 2, height: railH, background: "rgba(255,255,255,0.14)" }}>
                <i style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: pal.rail, transformOrigin: "50% 0", transform: `scaleY(${railP.toFixed(4)})` }} />
              </div>
              {rs.map((r, i) => (
                <div
                  key={i}
                  data-fx-role="item"
                  style={{ position: "relative", display: "flex", alignItems: "center", height: rowH[i], opacity: +r.a.toFixed(4), transform: `translateX(${(-28 * (1 - r.a)).toFixed(2)}px)` }}
                >
                  <div style={{ position: "relative", width: 48, height: 48, flex: "none" }}>
                    <div
                      style={{
                        position: "absolute", left: -10, top: -10, width: 68, height: 68, borderRadius: "50%",
                        background: `radial-gradient(circle, ${ckRgb(pal.glow, 0.55)}, ${ckRgb(pal.glow, 0)} 70%)`,
                        opacity: +r.g.toFixed(3), transform: `scale(${(0.7 + 0.5 * r.burst).toFixed(3)})`,
                      }}
                    />
                    <svg width="48" height="48" viewBox="0 0 48 48" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
                      <circle
                        cx="24" cy="24" r="21" fill="none" stroke={pal.ring} strokeWidth="2.5" strokeDasharray={r.locked ? "4 5" : "132"}
                        strokeDashoffset={r.locked ? 0 : (132 * (1 - r.ringP)).toFixed(2)} transform="rotate(-90 24 24)"
                        opacity={r.locked ? +(r.ringP * 0.7).toFixed(3) : 1}
                      />
                      {r.locked ? (
                        // 上锁:虚线圈里一把小锁,不打勾
                        <g fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.4" strokeLinecap="round" opacity={+r.ringP.toFixed(3)}>
                          <rect x="16" y="22" width="16" height="12" rx="2.5" />
                          <path d="M19.5 22 V18.5 a4.5 4.5 0 0 1 9 0 V22" />
                        </g>
                      ) : (
                        <>
                          <circle cx="24" cy="24" r="22" fill={pal.main} transform={`translate(24 24) scale(${Math.max(0, r.fillS).toFixed(4)}) translate(-24 -24)`} />
                          <path
                            d="M14 24.5 L21 31.5 L34.5 17" fill="none" stroke={pal.tick} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"
                            strokeDasharray="32" strokeDashoffset={(32 * (1 - r.tickP)).toFixed(2)}
                          />
                        </>
                      )}
                    </svg>
                  </div>
                  <div
                    style={{
                      marginLeft: 24, display: "flex", alignItems: "baseline", fontSize: r.fs, fontWeight: 600, letterSpacing: "0.01em", lineHeight: 1.25,
                      textShadow: "0 2px 8px rgba(0,0,0,0.3)", opacity: +r.dim.toFixed(3), filter: `blur(${(5 * (1 - r.a)).toFixed(2)}px)`,
                    }}
                  >
                    <span style={{ position: "relative", top: -4, fontSize: 16, color: pal.hi, fontWeight: 700, letterSpacing: "0.1em", marginRight: 12, fontVariantNumeric: "tabular-nums", flex: "none" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div style={{ whiteSpace: "nowrap", letterSpacing: r.locked ? "0.2em" : undefined }}>
                      {r.lines.map((ln, li) => (
                        <div key={li}>{ln}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export const checklistDef: EffectDef<ChecklistParams> = {
  id: "checklist",
  name: "Checklist",
  description: "步骤打勾 · 流程逐项完成打√",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    stepMs: 160,
    theme: "dark",
    position: "left",
    title: "步骤打勾",
    items: "列出流程步骤|讲到哪条勾哪条|完成的亮起来|没讲到的先灰着",
    checked: 3,
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "stepMs", label: "每条间隔(卡点用)", type: "range", min: 100, max: 8000, step: 100, unit: "ms" },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
        { label: "左上(叠在全屏画面上)", value: "top-left" },
      ],
    },
    { key: "title", label: "小标题", type: "text" },
    { key: "items", label: "步骤(用 | 分隔)", type: "text" },
    { key: "checked", label: "已完成到第几步", type: "range", min: 0, max: 8, step: 1 },
    { key: "accent", label: "打勾色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: Checklist,
};
