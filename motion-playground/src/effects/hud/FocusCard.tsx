import type { EffectDef, EffectProps } from "../types";
import { FxVideo } from "./MediaImg";
import { STAGE } from "../../stage";
import { useId } from "react";
import { fcBez, focusCamBox, focusCamGeomAt, focusCardTimes } from "./camGeom";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  THEME_OPTIONS,
} from "./accent";

export interface FocusCardParams {
  theme: "dark" | "light";
  /** 全屏底色:米色 / 雾白 / 暗色 */
  bg: "cream" | "mist" | "dark" | "theme";
  /** 跟随强调色的背景深浅:0 深底,100 浅底;不影响固定底色 */
  bgLightness?: number;
  /** 口播缩到哪一侧(另一侧留白/放要点/自己叠动效卡) */
  side?: "left" | "right";
  /** 要点,| 分隔 */
  items: string;
  stepMs: number;
  /** 口播视频(H264):填了就把"满屏缩进左框"运镜直接烤进导出 */
  camSrc?: string;
  /** 一过性:整条时间轴后移、但口播源文件没跟着移时,填入偏移秒数把口型对回来
      (取帧变成 t − camDelay)。默认 0 = 原行为;刻意不进 defaults/controls,
      面板上不出现,只在 JSON 里填。口播源重新导出对齐后即可删掉此参数。 */
  camDelay?: number;
  accent: string;
  showRing: boolean;
  /** 口播框位置微调(px,相对该侧默认落位) */
  camDX?: number;
  camDY?: number;
  /** 口播框大小(px) */
  camW?: number;
  camH?: number;
  offsetX?: number;
  offsetY?: number;
  /** 眉题(精修版):要点上方的一行小字,留空不显示 */
  eyebrow?: string;
  /** 口播框大小(%,精修版):100 = camW×camH */
  camSize?: number;
}

/** 导出模式下视频不自动播,由导出脚本逐帧 seek */
const IS_EXPORT =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("export") === "1";

/**
 * 人物聚焦卡:全屏纯色底,口播缩进左侧圆角方框,右侧要点胶囊逐条弹入。
 * 成片时口播轨放在动效层之上,按落位框缩放对齐。
 */
/* ============ 精修版(隔离 Opus 原作移植) ============ */

const fcClamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// 进度先比端点:b 是 Infinity(没有结束时间)时不会算出 NaN
const fcSeg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const fcLerp = (a: number, b: number, k: number) => a + (b - a) * k;
const fcEaseIn = fcBez(0.55, 0, 0.12, 1);
const fcEaseOut = fcBez(0.2, 0.8, 0.2, 1);
const fcOutBack = (k: number) => { const s = 1.6; k = k - 1; return k * k * ((s + 1) * k + s) + 1; };

/** 估一行字宽(px):中文/全角按字号 + 字距,英文数字约 0.56 字号 */
function fcTextW(str: string, f: number, ls: number) {
  let w = 0;
  for (const ch of str) w += (/[\u0000-ÿ]/.test(ch) ? (ch === " " ? 0.3 : 0.56) * f : f) + ls;
  return w;
}

/**
 * 排版:字号从 70 往下试。先保证每条 ≤ 2 行(太长先换行,两行还放不下才缩,最小 44),
 * 再看总高:行距可压到 0.45 字号;字号压到 52 还排不下就进「滚动」模式 ——
 * 列表跟着正在讲的那条往上推,推出上沿的几条淡掉(长卡 5 条以上时不至于把字缩没)。
 */
function fcLayout(items: string[], hasEyebrow: boolean, wr: number, avH: number) {
  const n = items.length;
  let pick: { f: number; lines: number[]; gap: number; scroll: boolean } | null = null;
  for (let f = 70; f >= 44; f -= 2) {
    const m = (80 * f) / 70;
    const textW = wr - m - (40 * f) / 70 - 12;
    const lines = items.map((it) => {
      const w = fcTextW(it, f, (2 * f) / 70);
      return w <= textW ? 1 : w <= textW * 1.9 ? 2 : 3;
    });
    if (lines.some((l) => l > 2) && f > 44) continue;
    const eb = hasEyebrow ? (124 * f) / 70 : 0;
    const hs = lines.map((l) => (l === 1 ? m : Math.max(m, Math.min(l, 2) * f * 1.12 + 16)));
    const sumH = hs.reduce((a, b) => a + b, 0);
    const gap = n > 1 ? Math.min(f, (avH - eb - sumH) / (n - 1)) : f;
    if (n <= 1 || gap >= 0.45 * f) { pick = { f, lines, gap, scroll: false }; break; }
    if (f <= 52 || f === 44) { pick = { f, lines, gap: 0.6 * f, scroll: true }; break; }
  }
  if (!pick) pick = { f: 44, lines: items.map(() => 2), gap: 0.6 * 44, scroll: true };
  const { f, lines, gap, scroll } = pick;
  const m = (80 * f) / 70;
  const eb = hasEyebrow ? (124 * f) / 70 : 0;
  const hs = lines.map((l) => (l === 1 ? m : Math.max(m, Math.min(l, 2) * f * 1.12 + 16)));
  const tops: number[] = [];
  let y = 0;
  for (const h of hs) { tops.push(y); y += h + gap; }
  const listH = Math.max(0, y - gap);
  return { f, m, lines, hs, tops, eb, listH, scroll, blockH: scroll ? avH : eb + listH };
}

function FocusCard({ params, playToken }: EffectProps<FocusCardParams>) {
  const p = params as FocusCardParams & { scale?: number; __scale?: number; __start?: number; __end?: number; __t?: number };
  const V = false;
  const { w: SW, h: SH } = STAGE;
  const uid = useId().replace(/:/g, "");
  const t = useCardElapsed(p, playToken);
  const spd = usePlateSpeed(); // 动画速度:要点卡点(stepMs)和口播缩放/回满屏的几何时刻不动,只加快动作本身
  const D = typeof p.__end === "number" ? Math.max(0, p.__end - (p.__start ?? 0)) : Infinity;
  const g = focusCamGeomAt(p, t, D);
  const B = focusCamBox(p);
  const { back0, end } = focusCardTimes(D);
  const acc = ACCENT_VAR[p.accent] ?? ACCENT_VAR.green;
  const side = p.side ?? "left";
  const items = (p.items ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const n = items.length;
  const eyebrow = (p.eyebrow ?? "").trim();
  // 以卡点 a 为起点的动作:o 秒后开始、d 秒做完(按 1 倍速写,自动除以速度)
  const P = (a: number, o: number, d: number) => fcSeg(t, a + o / spd, a + (o + d) / spd);
  // 卡点 a 之后、按 1 倍速计的流逝秒数
  const Dt = (a: number, o = 0) => (t - a) * spd - o;
  const step = Math.max(0.2, (Number(p.stepMs) || 600) / 1000);
  const STARTS = items.map((_, i) => 0.5 + i * step);

  // 底色:暗底照原作;米色/雾白/浅主题底换深字
  const bgL = Math.min(100, Math.max(0, Number(p.bgLightness) || 0));
  const light = p.bg === "cream" || p.bg === "mist" || (p.bg === "theme" && bgL > 55);
  const themeBase = `hsl(0 0% ${12 + bgL * 0.82}%)`;
  const BG: Record<string, string> = {
    cream: "linear-gradient(168deg, #f7eddd 0%, #f2e6d2 60%, #ecdec6 100%)",
    mist: "linear-gradient(168deg, #f7f7f9 0%, #efeff2 60%, #e8e8ec 100%)",
    dark: "linear-gradient(115deg, #121513 0%, #0b0d0c 55%, #0e1110 100%)",
    theme: `linear-gradient(168deg, color-mix(in srgb, ${acc} 22%, ${themeBase}) 0%, color-mix(in srgb, ${acc} 14%, ${themeBase}) 60%, color-mix(in srgb, ${acc} 8%, ${themeBase}) 100%)`,
  };
  const ink = light ? [28, 30, 29] : [242, 244, 241];
  const dimInk = light ? ([110, 114, 112]) : [200, 206, 202];
  const markBg = light ? "#fffdf8" : "#0f1311";
  const flashInk = light ? "#ffffff" : "#0b0d0c";

  const sc = Math.max(0.2, (Number(p.scale) || 1) * (Number(p.__scale) || 1));
  const ox = Number(p.offsetX) || 0;
  const oy = Number(p.offsetY) || 0;
  const L = side === "right" ? 150 : B.x + B.w + 100; const faceW = (side === "right" ? B.x - 70 : SW - 110) - L;
  const wr = Math.max(240, Math.min(faceW, (SW - 48 - L - ox) / sc));
  const regTop = 100; const regBot = SH - 100;
  const avH = Math.max(200, Math.min(regBot - regTop, (SH - 96) / sc));
  const lay = fcLayout(items, !!eyebrow, wr, avH);
  const { f, m } = lay;
  const cy = V ? (regTop + regBot) / 2 : B.y + B.h / 2;
  const blockTop = Math.max(regTop, Math.min(regBot - lay.blockH, cy - lay.blockH / 2));

  // 背景:随镜头一起「打开」,收尾时一起淡出(被满屏画面盖住)
  const open = fcEaseOut(P(0, 0.1, 0.9)) * (1 - fcSeg(t, end - 0.5 / spd, end));
  // 框线:落位后沿框描一圈,随后一颗光点慢绕;回满屏前先撤
  const frameOut = 1 - P(back0, -0.15, 0.3);
  const draw = fcEaseOut(P(1.05, -0.2, 0.9));
  const cometOn = P(1.05, 0.55, 0.6) * frameOut;
  const fr = (pad: number) => ({ x: g.x - pad, y: g.y - pad, width: Math.max(0, g.w + pad * 2), height: Math.max(0, g.h + pad * 2), rx: g.r ? g.r + pad : 0 });
  // 收尾:要点统一收走(由下往上)
  const exitK = fcEaseIn(P(back0, -0.1, 0.45));
  const e = fcEaseOut(P(0, 0.3, 0.6));
  const st = n > 1 ? Math.min(0.07, 0.35 / (n - 1)) : 0;

  // 滚动模式:列表跟着新出现的那条往上推,保证正在讲的那条在可视区里
  const visH = lay.blockH - lay.eb;
  let scroll = 0;
  if (lay.scroll) {
    let prev = 0;
    items.forEach((_, i) => {
      const need = Math.max(prev, lay.tops[i] + lay.hs[i] - visH);
      scroll += (need - prev) * fcEaseOut(P(STARTS[i], -0.1, 0.6));
      prev = need;
    });
  }
  // 竖向导轨:跟着要点一节节长出来;只画在序号块之间,不穿进块里
  const railSegs: { top: number; h: number }[] = [];
  for (let j = 1; j < n; j++) {
    const a0 = lay.tops[j - 1] + m + 6 - scroll;
    const a1 = lay.tops[j] - 6 - scroll;
    const g = fcEaseOut(P(STARTS[j], -0.15, 0.5));
    const top = Math.max(0, a0);
    const h = (a1 - a0) * g - (top - a0);
    if (h > 0) railSegs.push({ top, h });
  }
  const fe = Math.max(18, Math.min((30 * f) / 70, (wr - 80) / Math.max(1, fcTextW(eyebrow, 1, 6 / 30))));
  const comet = `color-mix(in srgb, ${acc} 35%, white)`;

  // 点阵只铺在要点那一侧,往口播框方向淡出
  const fade = side === "right" ? { x1: 0, y1: 0, x2: 1, y2: 0 } : { x1: 1, y1: 0, x2: 0, y2: 0 };

  return (
    <div
      className="hud"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 1, color: `rgb(${ink.join(",")})`, fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)' }}
    >
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(1200px 900px at ${B.x + B.w / 2}px ${B.y + B.h / 2}px, color-mix(in srgb, ${acc} 10%, transparent), transparent 60%), ${BG[p.bg] ?? BG.dark}` }} />
      <svg width={SW} height={SH} style={{ position: "absolute", left: 0, top: 0, opacity: 0.5 * open }}>
        <defs>
          <pattern id={`fcdots${uid}`} width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.3" fill={light ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.06)"} />
          </pattern>
          <linearGradient id={`fcfade${uid}`} {...fade}>
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`fcmask${uid}`}><rect width={SW} height={SH} fill={`url(#fcfade${uid})`} /></mask>
        </defs>
        <rect width={SW} height={SH} fill={`url(#fcdots${uid})`} mask={`url(#fcmask${uid})`} />
      </svg>
      <div
        style={{
          position: "absolute", width: 1100, height: 1100, borderRadius: "50%",
          left: g.x + g.w / 2 - 550 + Math.sin(t * spd * 0.5) * 20, top: g.y + g.h / 2 - 550 + Math.cos(t * spd * 0.4) * 16,
          background: `radial-gradient(circle, color-mix(in srgb, ${acc} 16%, transparent) 0%, transparent 62%)`,
          opacity: open * (0.85 + 0.15 * Math.sin(t * spd * 1.3)),
        }}
      />

      {/* 要点区 */}
      <div
        style={{
          position: "absolute", left: L, top: blockTop, width: wr, height: lay.blockH,
          transformOrigin: "0 50%", transform: ox || oy || sc !== 1 ? `translate(${ox}px, ${oy}px) scale(${sc})` : undefined,
          filter: undefined,
        }}
      >
        {eyebrow && (
          <div
            style={{
              position: "absolute", left: 0, top: 0, display: "flex", alignItems: "center", gap: (18 * f) / 70, whiteSpace: "nowrap",
              fontSize: fe, letterSpacing: (fe * 6) / 30, fontWeight: 600, color: light ? acc : `color-mix(in srgb, ${acc} 78%, white)`,
              opacity: e * (1 - exitK), transform: `translateX(${(1 - e) * -30 - exitK * 40}px)`,
            }}
          >
            <div style={{ width: (56 * f) / 70, height: 3, background: acc, borderRadius: 2, transformOrigin: "left center", transform: `scaleX(${e})` }} />
            <div>{eyebrow}</div>
          </div>
        )}
        <div style={{ position: "absolute", left: 0, top: lay.eb, width: wr, height: lay.blockH - lay.eb }}>
          {railSegs.map((sg, j) => (
            <div
              key={j}
              style={{
                position: "absolute", left: m / 2 - 1, top: sg.top, width: 2, height: sg.h * (1 - exitK),
                background: `linear-gradient(${acc}, color-mix(in srgb, ${acc} 25%, transparent))`, opacity: 1 - exitK,
              }}
            />
          ))}
          {items.map((label, i) => {
            const s = STARTS[i];
            const a = P(s, 0, 0.55);
            const mPop = fcOutBack(fcClamp(a * 1.4));
            // 序号块:出现时闪一下实心强调色,再退成描边
            const flash = P(s, 0, 0.12) * (1 - P(s, 0.2, 0.5));
            // 文字从遮罩里推出
            const ta = fcEaseOut(P(s, 0.08, 0.62));
            // 当前这条亮、下划线扫过;下一条来了就让位
            const next = i < n - 1 ? STARTS[i + 1] : Infinity;
            const dim = P(next, 0, 0.4);
            const u = fcEaseOut(P(s, 0.35, 0.6));
            const col = ink.map((c, k) => Math.round(fcLerp(c, dimInk[k], dim)));
            // 收尾:由下往上依次离场
            const ex = fcEaseIn(P(back0, -0.1 + (n - 1 - i) * st, 0.4));
            const top = lay.tops[i] - scroll;
            const h = lay.hs[i];
            const vis = lay.scroll ? fcClamp((top + h * 0.6) / (h * 0.6)) : 1;
            const multi = lay.lines[i] > 1;
            return (
              <div
                key={i}
                style={{
                  position: "absolute", left: 0, top, width: wr, minHeight: m, display: "flex", alignItems: multi ? "flex-start" : "center", gap: (40 * f) / 70,
                  opacity: (1 - ex) * vis, transform: `translateX(${-ex * 60}px)`,
                }}
              >
                <div
                  style={{
                    position: "relative", width: m, height: m, flex: "none", borderRadius: (22 * f) / 70, background: markBg, boxSizing: "border-box",
                    border: `2px solid ${acc}`, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: (34 * f) / 70, fontWeight: 700, color: flash > 0.5 ? flashInk : acc, fontVariantNumeric: "tabular-nums",
                    transform: `scale(${a > 0 ? mPop : 0})`,
                  }}
                >
                  <div style={{ position: "absolute", inset: -2, borderRadius: (22 * f) / 70, background: acc, opacity: flash }} />
                  <span style={{ position: "relative" }}>{i + 1}</span>
                </div>
                <div style={{ position: "relative", overflow: "hidden", padding: "6px 12px 10px 0", maxWidth: wr - m - (40 * f) / 70, marginTop: multi ? -4 : 0 }}>
                  <div
                    style={{
                      fontSize: f, fontWeight: 600, lineHeight: multi ? 1.12 : 1, letterSpacing: (2 * f) / 70,
                      whiteSpace: multi ? "normal" : "nowrap", ...(multi ? ({ textWrap: "balance" } as object) : {}), lineBreak: "strict", wordBreak: "normal", overflowWrap: "normal",
                      color: `rgb(${col.join(",")})`, opacity: ta, transform: `translateY(${(1 - ta) * 90}%)`,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      position: "absolute", left: 0, bottom: 0, height: 4, width: "100%", borderRadius: 2,
                      background: `linear-gradient(90deg, ${acc}, transparent)`, transformOrigin: "left center",
                      transform: `scaleX(${u})`, opacity: 1 - dim * 0.85,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 口播烤入导出:同一条运镜曲线(预览里由画布的真口播走这条线) */}
      {IS_EXPORT && p.camSrc && (
        <FxVideo
          src={p.camSrc}
          tStart={Number(p.camDelay) || 0}
          style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: g.r, objectFit: "cover", objectPosition: "50% 45%", zIndex: 6, pointerEvents: "none" }}
        />
      )}

      {/* 口播框投影:z 7 压在画布的口播小窗之上(外投影不画进框内) */}
      <div style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: g.r, zIndex: 7, pointerEvents: "none", boxShadow: "0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04)" }} />
      {/* 框线:柔光 / 描边 / 绕框光点(「显示口播落位框」关掉就不画) */}
      {p.showRing !== false && <svg viewBox={`0 0 ${SW} ${SH}`} style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH, overflow: "visible", zIndex: 7, pointerEvents: "none" }}>
        <rect {...fr(7)} fill="none" style={{ stroke: acc }} strokeOpacity={0.22} strokeWidth={10} opacity={(draw * frameOut * (0.6 + 0.4 * Math.sin(t * spd * 1.6))).toFixed(3)} />
        <rect {...fr(7)} fill="none" style={{ stroke: acc }} strokeWidth={2.5} pathLength={1000} strokeDasharray="1000 1000" strokeDashoffset={(1000 * (1 - draw)).toFixed(2)} opacity={(frameOut * (0.75 + 0.25 * Math.sin(t * spd * 1.6))).toFixed(3)} />
        <rect {...fr(7)} fill="none" style={{ stroke: comet }} strokeWidth={4} strokeLinecap="round" pathLength={1000} strokeDasharray="70 930" strokeDashoffset={(-((Dt(1.05, 0.55) * 110) % 1000)).toFixed(2)} opacity={(cometOn * 0.9).toFixed(3)} />
      </svg>}
    </div>
  );
}


export const focusCardDef: EffectDef<FocusCardParams> = {
  id: "focus-card",
  name: "FocusCard",
  description: "人物聚焦运镜 · 口播缩进左框 + 要点逐条弹入",
  tags: ["取景重构", "逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "light",
    bg: "cream",
    side: "left",
    items: "本段要点一|本段要点二",
    stepMs: 600,
    camSrc: "",
    accent: "blue",
    showRing: true,
    camDX: 0,
    camDY: 0,
    camW: 700,
    camH: 700,
    eyebrow: "这一段 · 重点",
    camSize: 100,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "bg",
      label: "底色",
      type: "select",
      options: [
        { label: "跟随主题色(随统一强调色切换)", value: "theme" },
        { label: "米色", value: "cream" },
        { label: "雾白", value: "mist" },
        { label: "暗色", value: "dark" },
      ],
    },
    { key: "bgLightness", label: "主题背景深浅(0 深 / 100 浅;浅底请配深字)（背景选主题色时生效）", type: "range", min: 0, max: 100, step: 1 },
    {
      key: "side",
      label: "口播缩到哪侧",
      type: "select",
      options: [
        { label: "左侧(要点在右)", value: "left" },
        { label: "右侧(左侧留白,自己叠动效)", value: "right" },
      ],
    },
    { key: "items", label: "要点(| 分隔,空 = 留白)", type: "text" },
    { key: "camSrc", label: "口播视频(烤进导出)", type: "text" },
    { key: "stepMs", label: "每条间隔(卡点用)", type: "range", min: 200, max: 8000, step: 100, unit: "ms" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "showRing", label: "显示口播落位框", type: "toggle" },
    { key: "camDX", label: "口播框水平移动", type: "range", min: -1100, max: 1100, step: 10, unit: "px" },
    { key: "camDY", label: "口播框垂直移动", type: "range", min: -400, max: 600, step: 10, unit: "px" },
    { key: "camW", label: "口播框宽", type: "range", min: 300, max: 1200, step: 10, unit: "px" },
    { key: "camH", label: "口播框高", type: "range", min: 300, max: 1000, step: 10, unit: "px" },
    { key: "camSize", label: "口播框大小(精修版生效)", type: "range", min: 60, max: 160, step: 1, unit: "%" },
    { key: "eyebrow", label: "眉题(精修版,留空不显示)", type: "text" },
    ...OFFSET_CONTROLS,
  ],
  Component: FocusCard,
};
