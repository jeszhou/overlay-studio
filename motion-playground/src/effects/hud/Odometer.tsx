import type { EffectDef, EffectProps } from "../types";
import { useId, type CSSProperties } from "react";
import { useCardElapsed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
  GLASS_DEFAULTS,
} from "./accent";

export interface OdometerParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  kicker: string;
  value: number; // 整数
  unit: string;
  label: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
  __t?: number;
  __start?: number;
}


/* ── 精修版:逐条照搬隔离 Opus 一次性作品(odometer board.html)的 renderAt,画面是 t 的纯函数 ──
 * 参考作品只演一位数 0→1;多位数时每一位一只鼓轮装在同一个机匣里,同一套圆柱鼓轮手法,
 * 个位先到位、往高位每位晚 0.12s(和原卡一样从个位往高位依次落),最后一位落下那拍才是重音。 */
const odClamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const odProg = (t: number, s: number, d: number) => odClamp((t - s) / d, 0, 1);
const odOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);
const odOutQuint = (u: number) => 1 - Math.pow(1 - u, 5);
const odInCubic = (u: number) => u * u * u;
const odOutBack = (u: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const OD_STEP_DEG = 48;
const OD_SPIN = 1.35; // 个位落位时刻(参考作品 SPIN_D)
const OD_STAGGER = 0.12; // 往高位每位晚落
const OD_EXIT = 0.5;
const OD_FACE_X = 700; // 横版人脸左缘约 720
const OD_V_MARGIN = 48; // 左右至少离画面边
const OD_INK = "#F4EFE9";
/** 鼓轮位置(格):起步咬合加速 → 长减速冲过一点 → 落位机械回弹 */
function odReelPos(t: number, steps: number, land: number) {
  if (t <= 0) return 0;
  if (t < land) {
    const u = t / land;
    const base = 1 - Math.pow(1 - u, 3.4);
    let ramp = odClamp(u / 0.1, 0, 1); ramp = ramp * ramp * (3 - 2 * ramp);
    return (steps + 0.14) * base * (0.35 + 0.65 * ramp);
  }
  const tau = t - land;
  return steps + 0.14 * Math.exp(-7 * tau) * Math.cos(16 * tau);
}
const odWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
/** 比例字宽(em) */
const odEm = (c: string) => (odWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
/** 等宽字宽(em) */
const odMonoEm = (c: string) => (odWide(c) ? 1 : 0.62);
const OD_NO_HEAD = /[，,、。.;；:：!！?？）)」』”’%]/;
/** 两行断点:最均衡,不拆英文单词/数字,行首不放标点 */
function odBreakTwo(chars: string[], w: number[]) {
  const tot = w.reduce((a, b) => a + b, 0);
  let best = -1, bestW = Infinity, acc = 0;
  for (let k = 1; k < chars.length; k++) {
    acc += w[k - 1];
    if (/[A-Za-z0-9]/.test(chars[k - 1]) && /[A-Za-z0-9]/.test(chars[k])) continue;
    if (OD_NO_HEAD.test(chars[k])) continue;
    const m = Math.max(acc, tot - acc);
    if (m < bestW) { best = k; bestW = m; }
  }
  return best < 0 ? null : { at: best, w: bestW };
}
/** 一行放得下就一行;放不下断两行;两行还放不下才缩字号(不小于 minF) */
function odFit(text: string, F0: number, minF: number, avail: number, emOf: (c: string) => number, spacing: number) {
  const chars = Array.from(text);
  const w = chars.map((c) => (emOf(c) + spacing) * 1.04);
  const tot = w.reduce((a, b) => a + b, 0);
  if (tot * F0 <= avail || chars.length < 2) return { F: Math.max(minF, Math.min(F0, avail / Math.max(tot, 0.01))), lines: [chars] };
  const two = odBreakTwo(chars, w);
  if (!two) return { F: Math.max(minF, avail / tot), lines: [chars] };
  return { F: Math.max(minF, Math.min(F0, avail / two.w)), lines: [chars.slice(0, two.at), chars.slice(two.at)] };
}
/** 卡片(未乘 scale)允许的最大宽:左/右锚点不越人脸线。
 *  人脸线 / 人脸下方的版面宽只按默认大小、默认位置(scale=1、offsetX=0)算:拉大就真的变大,拖开卡宽锁住只平移;
 *  出画(离画面边 OD_V_MARGIN)按真实 scale、offsetX 算 */
function odMaxWidth(position: string, scale: number, ox: number) {
  const SW = 1920;
  const s = Math.max(0.2, scale);
  const frame = (SW - 2 * OD_V_MARGIN - 2 * Math.abs(ox)) / s;
  if (position === "center") return Math.min(580, frame);
  return Math.min(odWidthWithin(SW, position, 1, 0, SW - OD_FACE_X), odWidthWithin(SW, position, s, ox, OD_V_MARGIN));
}
/** 左/右锚点:远端边不越过离画面边 limit 的线时的最大宽 */
function odWidthWithin(SW: number, position: string, s: number, ox: number, limit: number) {
  if (position !== "right") {
    // 左锚点:transform-origin 在左边,左缘 = 120 + ox
    return (SW - limit - 120 - ox) / s;
  }
  // 右锚点:transform-origin 在右边,右缘 = SW-120+ox 固定;放大后左缘 = 右缘 − W·s
  return (SW - 120 + ox - limit) / s;
}
const odMix = (c: string, pct: number, to = "transparent") => `color-mix(in srgb, ${c} ${odClamp(pct, 0, 100).toFixed(1)}%, ${to})`;

/** 横版居中:锚点改成顶边挂在 y712(人脸下方),水平仍居中;缩放从顶边往下 */
const OD_BELOW_FACE = { top: 712, bottom: "auto", ["--anchor-tf" as string]: "translateX(-50%)", transformOrigin: "50% 0" } as CSSProperties;
function Odometer({ params, playToken }: EffectProps<OdometerParams>) {
  const { position, kicker, value, unit, label, accent } = params;
  const t0 = useCardElapsed(params, playToken);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const end = (params as { __end?: number }).__end;
  const dur = typeof end === "number" ? end - (params.__start ?? 0) : null;
  const t = dur != null ? Math.min(t0, dur) : t0;
  const acc = ACCENT_VAR[accent] ?? ACCENT_VAR.orange;
  const accHi = odMix(acc, 62, "#ffffff"); // 参考作品的 orange-hi
  const font = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';

  // ── 排版:先算可用宽 ──
  const extra = params as { scale?: number; __scale?: number };
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const maxW = odMaxWidth(position, cardScale, params.offsetX ?? 0) * 0.96;
  const PAD_L = 54, PAD_R = 56;
  const inner = Math.max(200, maxW - PAD_L - PAD_R - 24); // 留出落位轻震/闪框的余量

  // 数字:每位一只鼓轮(单位宽 150、机匣两侧各 33,一位数时正好是参考作品的 216)
  const str = String(Math.max(0, Math.round(Number(value) || 0)));
  const digs = str.split("").map(Number);
  const n = digs.length;
  const unitEm = unit ? Array.from(unit).reduce((a, c) => a + odEm(c), 0) * 1.04 : 0;
  const gapU = unit ? 22 : 0;
  let u = Math.min(1, inner / (66 + 150 * n + gapU + 84 * unitEm));
  let unitF = 84 * u;
  // 单位和数字挤一行会把数字压到不到 0.6 倍时,单位换到数字下面一行(先换行、再缩)
  const unitBelow = !!unit && u < 0.6;
  if (unitBelow) {
    u = Math.min(1, inner / (66 + 150 * n));
    unitF = Math.max(44, Math.min(84, inner / Math.max(unitEm, 0.01)));
  } else if (unit && unitF < 44) {
    unitF = 44;
    u = Math.min(1, (inner - unitEm * 44 - 12) / (66 + 150 * n + 10));
  }
  u = Math.max(0.19, u); // 数字字号 236u 不小于 44
  // 眉题 34(两行放不下才缩,最小 24)
  const eye = kicker ? odFit(kicker, 34, 24, inner - 26, odEm, 0.04) : null;
  // TOKEN 行:等宽 30、字距 0.42em;放不下先收字距,再断两行,再缩(最小 18)
  let lab: { F: number; lines: string[][]; sp: number } | null = null;
  if (label) {
    for (const sp of [0.42, 0.12]) {
      const f = odFit(label, 30, 18, inner, odMonoEm, sp);
      lab = { ...f, sp };
      if (f.lines.length === 1 && f.F >= 30) break;
    }
  }

  // 横版居中会压脸:整块挪到人脸下方(上边 y712、底边离画面底 ≥40,即高 ≤328);
  // 放不下先收间距、再压鼓轮字号(数字不小于 44),最后才整卡缩小。拖动(offsetX/Y)照常叠加在这个基准上
  const below = position === "center";
  const G = below ? { top: 28, bot: 30, eyeGap: 18, ruleGap: 18, labGap: 12 } : { top: 40, bot: 42, eyeGap: 30, ruleGap: 30, labGap: 18 };
  const unitFAt = (uu: number) => (unitBelow || !unit ? unitF : Math.max(44, Math.min(unitF, 84 * uu)));
  const cardH = (uu: number) => {
    const uf = unitFAt(uu);
    const read = unitBelow ? 272 * uu + (unit ? 16 + uf : 0) : Math.max(272 * uu, unit ? uf * (1 + 14 / 84) : 0);
    const eyeH = eye ? Math.max(40, eye.lines.length * eye.F * (eye.lines.length > 1 ? 1.25 : 1)) + G.eyeGap : 0;
    const labH = lab ? G.labGap + lab.lines.length * lab.F * (lab.lines.length > 1 ? 1.3 : 1) : 0;
    return G.top + eyeH + read + G.ruleGap + 2 + labH + G.bot;
  };
  // 人脸下方的高只按默认大小(scale=1)算;拉大后快出画就整块往上挪(盖脸是用户自己选的),挪到顶还放不下才整体缩小
  const maxH = 1080 - 40 - 712 - 6; // 6 = 落位轻震余量
  if (below) while (u > 0.19 && cardH(u) > maxH) u = Math.max(0.19, u - 0.01);
  if (below) unitF = unitFAt(u);
  let fit = below ? Math.min(1, maxH / cardH(u)) : 1;
  let guardY = 0; // 屏幕像素
  if (below) {
    const room = 1080 - 40 - 40 - 6;
    if (cardH(u) * fit * cardScale > room) fit = room / (cardH(u) * cardScale);
    const top = 712 + (params.offsetY ?? 0);
    const bot = top + cardH(u) * fit * cardScale + 6;
    if (bot > 1080 - 40) guardY = 1080 - 40 - bot;
    if (top + guardY < 40) guardY = 40 - top;
  }
  const HW = (66 + 150 * n) * u; // 机匣宽
  const DH = 272 * u; // 机匣高
  const R = 218 * u;
  const unitMax = unitBelow ? inner : Math.max(unitF, inner - HW - gapU * u);


  // ── 时间 ──
  const LAND = OD_SPIN + (n - 1) * OD_STAGGER; // 最后一位(最高位)落下 = 重音那拍
  const exitU = dur != null ? odProg(t, dur - OD_EXIT, OD_EXIT) : 0;
  const exitE = odInCubic(exitU);

  // 卡片入场:从左向右展开;落位时整卡微震
  const inU = odOutCubic(odProg(t, 0, 0.45));
  const landK = t > LAND ? Math.exp(-9 * (t - LAND)) : 0;
  const thud = landK * Math.sin((t - LAND) * 38) * 4;
  const clipR = odClamp((1 - inU) * 100 + exitE * 100, 0, 100);
  const cardOp = Math.min(1, inU * 1.4) * (1 - exitE * 0.6);
  const cardTx = (1 - inU) * -28 - exitE * 30;
  const stripe = odOutCubic(odProg(t, 0.1, 0.5));

  const breathe = t > LAND + 0.6 ? 0.5 + 0.5 * Math.sin(((t - LAND - 0.6) * Math.PI * 2) / 3.4 - Math.PI / 2) : 0;
  const glow = (10 + 18 * landK + 14 * breathe) * u;
  const glowA = 0.35 + 0.25 * breathe + 0.4 * landK;

  // 落位闪光 + 扩散方框
  const flashOp = landK * 0.95 + (t > LAND ? 0.18 * breathe : 0);
  const ringU = odProg(t, LAND, 0.7);
  const ringOp = ringU > 0 && ringU < 1 ? (1 - ringU) * 0.8 : 0;
  const ringS = 1 + odOutCubic(ringU) * 0.22;

  // 高光扫过:落位一次,之后每 4.2 秒缓慢掠过
  let sx: number;
  const sweep = HW + 44 * u + 120 * u;
  if (t < LAND + 1.5) sx = -120 * u + odOutCubic(odProg(t, LAND - 0.05, 0.9)) * sweep;
  else { const ph = ((t - LAND - 1.5) % 4.2) / 4.2; sx = ph < 0.32 ? -120 * u + (ph / 0.32) * sweep : HW + 44 * u; }

  // 单位弹出
  const uu = odProg(t, LAND - 0.12, 0.5);
  const us = uu > 0 ? odOutBack(uu) : 0;
  // 分隔线 + 光点(每 5s 走一趟)
  const ru = odOutQuint(odProg(t, LAND - 0.05, 0.8));
  const sp = t < LAND + 0.8 ? -1 : ((t - LAND - 0.8) % 5.0) / 5.0;
  const sparkOn = sp >= 0 && sp < 0.45;
  // 圆点呼吸
  const ds = 1 + 0.22 * breathe;

  const eyeN = eye ? eye.lines.reduce((a, l) => a + l.length, 0) : 0;
  const eyeStep = Math.min(0.045, 0.6 / Math.max(1, eyeN));
  const labN = lab ? lab.lines.reduce((a, l) => a + l.length, 0) : 0;
  const labStep = Math.min(0.07, 0.8 / Math.max(1, labN));

  // 鼓轮:每位转 d + 10×圈数 格(最高位 1 圈,往低位多 1 圈,最多 3 圈);只画正面 ±88° 内的几格
  const wheels = digs.map((d, i) => {
    const place = n - 1 - i;
    const turns = 1 + Math.min(2, i);
    const steps = d + 10 * turns;
    const land = OD_SPIN + place * OD_STAGGER;
    const pos = odReelPos(t, steps, land) + exitE * 0.9;
    const v = (odReelPos(t + 0.008, steps, land) - odReelPos(Math.max(0, t - 0.008), steps, land)) / 0.016;
    const blur = odClamp(Math.abs(v) * 0.55, 0, 9) * u;
    const cells: { k: number; y: number; c: number; op: number; front: boolean }[] = [];
    for (let k = Math.max(0, Math.floor(pos - 2)); k <= Math.ceil(pos + 2); k++) {
      const a = (k - pos) * OD_STEP_DEG;
      if (Math.abs(a) >= 88) continue;
      const rad = (a * Math.PI) / 180, c = Math.cos(rad);
      cells.push({ k, y: R * Math.sin(rad), c, op: Math.pow(c, 7), front: Math.abs(a) < OD_STEP_DEG / 2 });
    }
    return { i, blur, cells };
  });

  const charSpan = (ch: string, key: number, op: number, dy: number, extraStyle?: object) => (
    <span key={key} style={{ display: "inline-block", whiteSpace: "pre", opacity: +op.toFixed(3), transform: `translateY(${dy.toFixed(2)}px)`, ...extraStyle }}>{ch}</span>
  );

  let eyeIdx = 0, labIdx = 0;
  return (
    // 有终点时退场由自己收(向左收起+鼓轮顺势再转),行内 opacity:1 盖掉 hud.css 通用的 [data-outro] .hud 淡出;右锚点从右边缘放大(换卡居中时交给 CSS)
    <div className={`hud hud-anchor hud-anchor--${position}`} style={{ ...offsetVars(params), ...(below ? OD_BELOW_FACE : null), ...(dur != null ? { opacity: 1 } : null), ...(position === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? { transformOrigin: "100% 50%" } : null) }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {wheels.map((w) => (
            <filter key={w.i} id={`odp-mb-${uid}-${w.i}`} x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation={`0 ${w.blur.toFixed(2)}`} />
            </filter>
          ))}
        </defs>
      </svg>
      <div
        data-fx-role="group"
        style={{
          position: "relative", padding: `${G.top}px ${PAD_R}px ${G.bot}px ${PAD_L}px`, borderRadius: 22,
          background: "linear-gradient(160deg, rgba(30,26,23,0.86) 0%, rgba(16,14,13,0.88) 100%)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.07)",
          filter: undefined,
          fontFamily: font, color: OD_INK, textAlign: "left",
          clipPath: `inset(0 ${clipR.toFixed(2)}% 0 0 round 22px)`,
          opacity: +cardOp.toFixed(3),
          transform: `translate(${cardTx.toFixed(2)}px,${(thud + guardY / cardScale).toFixed(2)}px)${fit < 1 ? ` scale(${fit.toFixed(4)})` : ""}`,
          transformOrigin: below ? "50% 0" : undefined,
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 28, bottom: 28, width: 5, borderRadius: "0 4px 4px 0", background: acc, transformOrigin: "50% 0", transform: `scaleY(${stripe.toFixed(3)})` }} />

        {eye && (
          <div data-small-text="kicker" style={{ display: "flex", alignItems: "flex-start", gap: 14, fontSize: eye.F, fontWeight: 500, letterSpacing: "0.04em", lineHeight: eye.lines.length > 1 ? 1.25 : 1, minHeight: 40, maxWidth: inner }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: acc, flex: "none", marginTop: Math.max(0, (Math.min(40, eye.F * (eye.lines.length > 1 ? 1.25 : 1)) - 12) / 2) + (eye.lines.length > 1 ? 0 : (40 - eye.F) / 2), transform: `scale(${ds.toFixed(3)})`, boxShadow: `0 0 ${(4 + 10 * breathe).toFixed(1)}px ${odMix(acc, (0.3 + 0.4 * breathe) * 100)}` }} />
            <span style={{ paddingTop: eye.lines.length > 1 ? 0 : (40 - eye.F) / 2 }}>
              {eye.lines.map((ln, li) => (
                <div key={li} style={{ whiteSpace: "nowrap" }}>
                  {ln.map((ch) => {
                    const i = eyeIdx++;
                    const e = odOutCubic(odProg(t, 0.12 + i * eyeStep, 0.4));
                    return charSpan(ch, i, e, (1 - e) * 14);
                  })}
                </div>
              ))}
            </span>
          </div>
        )}

        <div data-fx-role="reading" style={{ display: "flex", flexDirection: unitBelow ? "column" : "row", alignItems: unitBelow ? "flex-start" : "flex-end", gap: unitBelow ? 16 : gapU * u, marginTop: eye ? G.eyeGap : 0 }}>
          <div style={{ position: "relative", width: HW, height: DH, flex: "none" }}>
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 16 * u, overflow: "hidden",
                background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 74%, rgba(0,0,0,0.55) 100%), linear-gradient(90deg, #1b1714 0%, #2a221c 50%, #1b1714 100%)",
                boxShadow: `inset 0 0 0 1.5px ${odMix(acc, 35)}, inset 0 ${10 * u}px ${18 * u}px rgba(0,0,0,0.5), inset 0 ${-10 * u}px ${18 * u}px rgba(0,0,0,0.5)`,
              }}
            >
              {wheels.map((w) => (
                <div key={w.i} style={{ position: "absolute", top: 0, bottom: 0, left: (33 + 150 * w.i) * u, width: 150 * u, filter: w.blur > 0.05 ? `url(#odp-mb-${uid}-${w.i})` : "none" }}>
                  {w.cells.map((c) => (
                    <div
                      key={c.k}
                      style={{
                        position: "absolute", left: -20 * u, right: -20 * u, top: "50%", height: 220 * u, marginTop: -110 * u,
                        textAlign: "center", lineHeight: `${220 * u}px`,
                        fontFamily: '"SF Pro Display", "Helvetica Neue", "PingFang SC", sans-serif',
                        fontWeight: 800, fontSize: 236 * u, letterSpacing: "-0.02em", color: acc, fontVariantNumeric: "tabular-nums",
                        transformOrigin: "50% 50%",
                        transform: `translateY(${c.y.toFixed(2)}px) scaleY(${c.c.toFixed(4)})`,
                        opacity: +c.op.toFixed(3),
                        textShadow: c.front ? `0 0 ${glow.toFixed(1)}px ${odMix(acc, glowA * 100)}` : "none",
                      }}
                    >
                      {c.k % 10}
                    </div>
                  ))}
                </div>
              ))}
              {/* 相邻鼓轮之间的分隔缝 */}
              {wheels.slice(1).map((w) => (
                <div key={w.i} style={{ position: "absolute", top: 12 * u, bottom: 12 * u, left: (33 + 150 * w.i) * u - 1, width: 2, background: "rgba(0,0,0,0.5)", boxShadow: "1px 0 0 rgba(255,255,255,0.05)" }} />
              ))}
              {/* 鼓面上下的机械压条与中线刻度 */}
              <div style={{ position: "absolute", left: 10 * u, right: 10 * u, top: 18 * u, height: 1, background: "rgba(255,255,255,0.10)" }} />
              <div style={{ position: "absolute", left: 10 * u, right: 10 * u, bottom: 18 * u, height: 1, background: "rgba(255,255,255,0.10)" }} />
              <div style={{ position: "absolute", top: "50%", left: 0, width: 9 * u, height: 2, marginTop: -1, background: acc, opacity: 0.9 }} />
              <div style={{ position: "absolute", top: "50%", right: 0, width: 9 * u, height: 2, marginTop: -1, background: acc, opacity: 0.9 }} />
              <div style={{ position: "absolute", top: "-40%", left: 0, width: 70 * u, height: "180%", background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,236,214,0.16) 50%, rgba(255,255,255,0) 100%)", transform: `translateX(${sx.toFixed(1)}px) rotate(18deg)` }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: 16 * u, boxShadow: `inset 0 0 0 2px ${accHi}`, opacity: +flashOp.toFixed(3) }} />
            </div>
            <div style={{ position: "absolute", inset: 0, borderRadius: 22 * u, border: `2px solid ${acc}`, opacity: +ringOp.toFixed(3), transform: `scale(${ringS.toFixed(3)})`, pointerEvents: "none" }} />
          </div>
          {unit && (
            <div
              style={{
                fontSize: unitF, fontWeight: 700, lineHeight: 1, paddingBottom: unitBelow ? 0 : 14 * (unitF / 84), color: OD_INK, maxWidth: unitMax,
                transformOrigin: "20% 90%", opacity: +Math.min(1, uu * 2.5).toFixed(3),
                transform: `translateX(${((1 - odOutCubic(uu)) * -16).toFixed(2)}px) scale(${(0.6 + 0.4 * us).toFixed(3)})`,
              }}
            >
              {unit}
            </div>
          )}
        </div>

        <div style={{ position: "relative", height: 2, marginTop: G.ruleGap, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "100%", background: acc, transformOrigin: "0 50%", transform: `scaleX(${(ru * (1 - exitE)).toFixed(4)})` }} />
          <div style={{ position: "absolute", top: -1, width: 60, height: 4, background: "linear-gradient(90deg, rgba(255,214,170,0), rgba(255,236,214,0.95), rgba(255,214,170,0))", opacity: sparkOn ? +Math.sin((sp / 0.45) * Math.PI).toFixed(3) : 0, left: sparkOn ? `${(-17 + (sp / 0.45) * 127).toFixed(2)}%` : 0 }} />
        </div>

        {lab && (
          <div data-small-text="label" style={{ marginTop: G.labGap, fontFamily: '"SF Mono", Menlo, "PingFang SC", monospace', fontSize: lab.F, fontWeight: 600, letterSpacing: `${lab.sp}em`, color: accHi, lineHeight: lab.lines.length > 1 ? 1.3 : 1, maxWidth: inner }}>
            {lab.lines.map((ln, li) => (
              <div key={li} style={{ whiteSpace: "nowrap" }}>
                {ln.map((ch) => {
                  const j = labIdx++;
                  const e = odOutCubic(odProg(t, LAND + 0.1 + j * labStep, 0.45));
                  return charSpan(ch, j, e, (1 - e) * 12, { filter: e < 1 ? `blur(${((1 - e) * 6).toFixed(2)}px)` : "none" });
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export const odometerDef: EffectDef<OdometerParams> = {
  id: "odometer",
  name: "Odometer",
  description: "翻牌计数器 · 每位数字滚轮到位",
  tags: ["滚动计数", "翻转轮换"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    kicker: "整数计数",
    value: 500,
    unit: "万",
    label: "里程表翻牌,机械感十足",
    accent: "blue",
    ...GLASS_DEFAULTS,
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
    { key: "kicker", label: "小标签(可空)", type: "text" },
    { key: "value", label: "数值(整数,可手填)", type: "range", min: 0, max: 99999, step: 1, precise: true },
    { key: "unit", label: "单位", type: "text" },
    { key: "label", label: "说明(可空)", type: "text" },
    { key: "accent", label: "单位颜色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: Odometer,
};
