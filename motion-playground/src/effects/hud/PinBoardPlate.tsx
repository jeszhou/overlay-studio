import { useId } from "react";
import type { EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import { ACCENT_SWATCH, ACCENT_VAR, offsetVars } from "./accent";
import type { PinBoardParams } from "./PinBoard";

/*
 * 要点钉板 · 精修版。
 * 逐拍照搬隔离 Opus 原作 board.html 的 renderAt:短强调线伸出 → 「要点 n / N」计数滑入 → 空心描边大标题从左擦出
 * → 强调色条展开、副题字滑入;每条要点像钉牌一样按重力加速落下(带歪)、落地压扁、绕钉摆两下停住,
 * 钉子从上方按下并漾开一圈涟漪,计数跳一下;最新一块牌带一个 3.2 秒一呼吸的小点,旧牌只降亮度不位移。
 * 原作是常驻层没有退场;有结束时间时最后 0.45 秒整块上飘淡出。
 * 标题 / 副题 / 要点条数 / 落钉时间全走卡参数,颜色走 accent,不写死任何一期的内容。
 */

type RGB = [number, number, number];
type Fit = { fs: number; lines: string[][] };

const MONO = '"SF Mono", Menlo, Consolas, monospace';
const FONT = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';
const FACE_X = 700; // 横版人脸左缘约 720:左锚点右缘不越过(右锚点对称 1220)
const V_MARGIN = 48; // 不出画:离画面边至少 48px
const SAFE = 0.96; // 字宽是估算的,留一点余量
const TOP0 = 96; // .hud-anchor--top-left / top-right 离上沿
const EDGE = 120; // 左右锚点离边
const FALL = 0.34; // 原作:下落时长
const DROP = 36; // 原作:下落高度
const OUTLEN = 0.45;
const RESTS = [-0.7, 0.5, -0.4, 0.6, -0.5, 0.4, -0.6, 0.3]; // 每块牌停住时留一点不同的歪角(原作前三个)

/* ── 原作的工具函数(原样搬;prog 先比端点,退场时刻为 Infinity 时不出 NaN) ── */
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const outQuart = (x: number) => 1 - Math.pow(1 - x, 4);
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const inQuad = (x: number) => x * x;
const inCubic = (x: number) => x * x * x;
const outBack = (x: number, s = 1.4) => {
  const c = x - 1;
  return 1 + (s + 1) * c * c * c + s * c * c;
};

function accRgb(accent?: string): RGB {
  // 转变橙照原作 #FF6B1A;其余预设取色盘,自定义色直接用
  const a = accent ?? "orange";
  const hex = a === "orange" ? "#FF6B1A" : /^#[0-9a-fA-F]{6}$/.test(a) ? a : ACCENT_SWATCH[a] ?? "#FF6B1A";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, x: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * x)) as RGB;
const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* ── 排版:先换行(自然断开,最多两行)再缩字号,有下限 ── */
const isWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const isWord = (c: string) => /[A-Za-z0-9]/.test(c);
/** 估算字宽(em):全角 1,大写/数字 0.66,小写 0.56,空格 0.3,其余 0.4 */
const em = (c: string) => (isWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
const lineW = (cs: string[], fs: number, ls: number) => cs.reduce((w, c) => w + (em(c) + ls) * fs, 0);
const trim = (cs: string[]) => {
  let a = 0;
  let b = cs.length;
  while (a < b && cs[a] === " ") a++;
  while (b > a && cs[b - 1] === " ") b--;
  return cs.slice(a, b);
};
/** 断成两行:不拆英文单词、行首不放标点,挑两行最均衡的位置 */
function split2(cs: string[]): [string[], string[]] | null {
  const w = cs.map(em);
  const total = w.reduce((a, b) => a + b, 0);
  let best: { at: number; cost: number } | null = null;
  let loose: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const cost = Math.max(acc, total - acc) * (cs[i - 1] === " " || cs[i] === " " ? 0.97 : 1);
    if (!loose || cost < loose.cost) loose = { at: i, cost };
    if (isWord(cs[i - 1]) && isWord(cs[i])) continue;
    if (/[，。、！？：；,.!?:;）)」』》]/.test(cs[i])) continue;
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  const pick = best ?? loose;
  return pick ? [trim(cs.slice(0, pick.at)), trim(cs.slice(pick.at))] : null;
}
/** 兜底:下限字号两行还放不下,按宽度贪心折成多行(英文单词整个挪行) */
function greedy(cs: string[], fs: number, ls: number, maxW: number) {
  const units: string[][] = [];
  cs.forEach((c, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && isWord(cs[i - 1]) && isWord(c)) last.push(c);
    else units.push([c]);
  });
  const lines: string[][] = [];
  let cur: string[] = [];
  units.forEach((u) => {
    if (cur.length && lineW([...cur, ...u], fs, ls) > maxW) {
      lines.push(trim(cur));
      cur = u[0] === " " ? [] : [...u];
    } else cur.push(...u);
  });
  if (cur.length) lines.push(trim(cur));
  return lines.filter((l) => l.length);
}
/** 单行原字号 → 单行缩到 oneMin → 两行(原字号往下缩到 min) → min 字号多行兜底 */
function fit(text: string, maxW: number, base: number, oneMin: number, min: number, ls: number): Fit {
  const cs = trim(Array.from(text));
  for (let fs = base; fs >= oneMin; fs--) if (lineW(cs, fs, ls) <= maxW) return { fs, lines: [cs] };
  const two = cs.length >= 2 ? split2(cs) : null;
  if (two) for (let fs = base; fs >= min; fs--) if (Math.max(lineW(two[0], fs, ls), lineW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  return { fs: min, lines: greedy(cs, min, ls, maxW) };
}
const fitW = (f: Fit, ls: number) => Math.max(0, ...f.lines.map((l) => lineW(l, f.fs, ls)));

/** 卡(缩放前)最大宽:躲脸只按 scale=1、offset=0 算;不出画按真实 scale、offset(右锚点从右缘缩放) */
function maxWidth(right: boolean, s: number, ox: number) {
  const SW = 1920;
  const within = (sc: number, o: number, limit: number) => (right ? SW - EDGE + o - limit : SW - limit - EDGE - o) / Math.max(0.2, sc);
  const face = SW - FACE_X;
  return Math.min(within(1, 0, face), within(s, ox, V_MARGIN));
}

/* 原作尺寸 */
const L = {
  titleTop: 22, titleFs: 44, titleLS: 4, titleLine: 54, titleH: 64, titleBase: 50,
  subGap: 10, subFs: 38, subLS: 2, subPadL: 18, subPadR: 14,
  cardsGap: 34, numFs: 20, plateFs: 32, plateLS: 1.5, platePadL: 22, platePadR: 30, numML: 14, numMR: 16,
};

function PinBoardPlate({ params, playToken }: EffectProps<PinBoardParams>) {
  const { position, title, subtitle, items, stepMs, accent } = params;
  const t0 = useCardElapsed(params, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const extra = params as PinBoardParams & { scale?: number; __scale?: number; __end?: number;  };
  const DUR = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) : Infinity;
  const t = Math.max(0, Math.min(DUR, t0));
  const fin = Number.isFinite(DUR);
  const P = (a: number, o: number, d: number) => prog(t, a + o / spd, d / spd); // 卡点 a 之后 o 秒开始、d 秒做完(按 1 倍速写)
  const D = (a: number, o = 0) => (t - a) * spd - o; // 卡点之后按 1 倍速计的流逝秒数
  const right = position === "top-right";

  const acc = accRgb(accent);
  const accLight = mix(acc, [255, 255, 255], 0.08); // 原作计数数字 / 钉子 / 涟漪用的略亮一档
  const lum = (0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]) / 255;
  const subInk = lum > 0.5 ? "#141110" : "#fff"; // 原作橙底黑字;深强调色换白字
  // 底色:暗底=原作黑牌白字;亮底=米白牌深字,标题/计数换深墨色,投影变浅,编号/钉子用压深一档的强调色保对比
  const light = params.theme === "light";
  const ink = light ? "#141110" : "#fff";
  const plateBg = light ? "#f7f4ee" : "#151413";
  const plateEdge = light ? "inset 0 1px 0 rgba(255,255,255,.7), inset 0 0 0 1px rgba(20,17,16,.08)" : "inset 0 1px 0 rgba(255,255,255,.09), inset 0 0 0 1px rgba(255,255,255,.04)";
  const shK = light ? 0.55 : 1;
  const numCol = light ? mix(acc, [0, 0, 0], 0.18) : accLight;

  // ── 内容(全来自参数) ──
  const chips = (items ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const N = chips.length;
  const at = ((params.times?.trim() ? params.times : params.itemTimes) ?? "")
    .split("|").map((x) => x.trim()).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));
  const step = Math.max(0.25, (Number(stepMs) || 4000) / 1000);
  // 落钉时刻:times 有几条用几条,不够的接着按 stepMs 往后排;全空时从原作的 1.5s 起按 stepMs 匀速
  const dropT = chips.map((_, i) => (i < at.length ? at[i] : at.length ? at[at.length - 1] + (i - at.length + 1) * step : 1.5 + i * step));
  const digits = Math.max(2, String(N).length);
  const numW = digits * (L.numFs * 0.62 + 1);

  // ── 宽度:安全区 → 各段字号与断行 ──
  const s = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const W = Math.max(280, Math.min(600, maxWidth(right, s, ox) * SAFE));
  const titleFit = title?.trim() ? fit(title, W - 8, L.titleFs, L.titleFs, 44, L.titleLS / L.titleFs) : null;
  const subFit = subtitle?.trim() ? fit(subtitle, W - L.subPadL - L.subPadR, L.subFs, 32, 30, L.subLS / L.subFs) : null;
  const plateChrome = L.platePadL + L.numML + numW + L.numMR + L.platePadR;

  // ── 竖直方向:放不下先收间距,再收牌高/字号,最后整体缩小 ──
  const SH = 1080;
  const maxH = (SH - V_MARGIN - TOP0 - oy) / Math.max(0.2, s);
  const layout = (tight: number) => {
    const pFs = tight >= 2 ? 30 : L.plateFs;
    const pLH = tight >= 2 ? 38 : 42;
    const pPad = tight >= 2 ? 8 : 12; // 单行牌高 66(原作) / 54
    const gap = tight >= 1 ? 8 : 18; // 牌间距 84−66(原作) / 收紧
    const cardsGap = tight >= 1 ? 26 : L.cardsGap;
    const titleH = titleFit ? L.titleH + (titleFit.lines.length - 1) * L.titleLine : 0;
    const subTop = titleFit ? L.titleTop + titleH + L.subGap : L.titleTop + 6;
    const subLH = subFit ? Math.round(subFit.fs * 1.26) : 0;
    const subH = subFit ? subFit.lines.length * subLH + 12 : 0;
    let y = subFit ? subTop + subH + cardsGap : titleFit ? L.titleTop + titleH + cardsGap - 4 : 44;
    const plates = chips.map((c) => {
      const f = fit(c, W - plateChrome, pFs, Math.min(pFs, 30), 30, L.plateLS / pFs);
      const h = f.lines.length * pLH + 2 * pPad;
      const p = { f, h, top: y, w: plateChrome + fitW(f, L.plateLS / f.fs) };
      y += h + gap;
      return p;
    });
    const H = N ? y - gap : subFit ? subTop + subH : L.titleTop + titleH;
    return { titleH, subTop, subLH, subH, plates, H, pLH, pPad };
  };
  let lay = layout(0);
  if (lay.H > maxH) lay = layout(1);
  if (lay.H > maxH) lay = layout(2);
  const fitZ = lay.H > maxH ? maxH / lay.H : 1;
  const titleW = titleFit ? fitW(titleFit, L.titleLS / L.titleFs) : 0;
  const subW = subFit ? fitW(subFit, L.subLS / subFit.fs) + L.subPadL + L.subPadR : 0;
  const boxW = Math.round(Math.min(W, Math.max(200, titleW + 8, subW, ...lay.plates.map((p) => p.w))));
  const side = right ? { right: 0 } : { left: 0 };

  // ── 退场(原作是常驻层,没有退场;有结束时间时最后一小段整块上飘淡出) ──
  const oc = fin ? inCubic(prog(t, DUR - OUTLEN / spd, DUR)) : 0;

  // ── 进场:短强调线 → 计数 → 空心标题擦出 → 强调条 → 副题字 ──
  const k = outExpo(P(0, 0.0, 0.45));
  const c = outCubic(P(0, 0.2, 0.4));
  const tw = outQuart(P(0, 0.15, 0.7));
  const tY = (1 - outCubic(P(0, 0.15, 0.55))) * 8;
  const b = outExpo(P(0, 0.45, 0.5));
  const st = outCubic(P(0, 0.65, 0.45));

  // ── 计数器:已钉数量,落钉那一下跳一跳 ──
  let n = 0;
  dropT.forEach((d) => {
    if (t >= d + FALL / spd) n++;
  });
  const lastLand = n > 0 ? Math.max(...dropT.filter((d) => t >= d + FALL / spd)) + FALL / spd : -10;
  const pop = prog(t, lastLand, lastLand + 0.35 / spd);
  const ps = n > 0 && pop < 1 ? 1 + 0.35 * Math.sin(pop * Math.PI) * (1 - pop) : 1;
  const textShadow = light ? "0 1px 2px rgba(255,255,255,.75), 0 0 10px rgba(255,255,255,.5)" : "0 1px 3px rgba(0,0,0,.65), 0 0 10px rgba(0,0,0,.35)";

  const svgW = Math.ceil(titleW + 16);
  const clipId = `pbx-clip-${useId().replace(/:/g, "")}`;
  return (
    <div
      className={`hud pbx hud-anchor hud-anchor--${position} is-in`}
      // opacity:1 盖掉编辑台通用的末尾淡出,退场由上面的 oc 负责;右上角从右缘(上沿)缩放,拉大往左下长
      style={{
        ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1,
        transformOrigin: right && (params as { centerOnStage?: boolean }).centerOnStage !== true ? "right top" : undefined,
      }}
    >
      <div style={{ width: boxW * fitZ, height: lay.H * fitZ, position: "relative" }}>
        <div
          data-fx-role="group"
          style={{
            position: "absolute", top: 0, ...side, width: boxW, height: lay.H, fontFamily: FONT,
            transformOrigin: right ? "100% 0" : "0 0",
            transform: `${fitZ < 1 ? `scale(${fitZ.toFixed(4)}) ` : ""}translateY(${(-10 * oc).toFixed(2)}px)`,
            opacity: 1 - oc,
          }}
        >
          {/* 小眉头:短强调线 + 「要点 n / N」 */}
          <div style={{ position: "absolute", top: 0, ...side, display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 28, height: 3, background: rgb(acc), borderRadius: 2, transformOrigin: "left center",
                boxShadow: "0 1px 4px rgba(0,0,0,.35)", transform: `scaleX(${k.toFixed(4)})`,
              }}
            />
            {N > 0 && (
              <div
                data-small-text="counter"
                style={{
                  font: `600 18px/1 ${MONO}`, letterSpacing: 2, color: ink, textShadow, whiteSpace: "nowrap",
                  opacity: c, transform: `translateX(${((1 - c) * -10).toFixed(2)}px)`,
                }}
              >
                要点 <b style={{ color: rgb(numCol), fontWeight: 700, display: "inline-block", transform: `scale(${ps.toFixed(3)})` }}>{n}</b> / {N}
              </div>
            )}
          </div>

          {/* 实心白字大标题 + 柔投影(中文空心描边会糊),从左擦出 */}
          {titleFit && (
            <div data-fx-role="label" style={{ position: "absolute", top: L.titleTop, ...side, width: svgW, height: lay.titleH, transform: `translateY(${tY.toFixed(2)}px)` }}>
              <svg width={svgW} height={lay.titleH} style={{ overflow: "visible", display: "block" }}>
                <defs>
                  <clipPath id={clipId}>
                    <rect x={-40} y={-20} width={(tw * (svgW + 60)).toFixed(2)} height={lay.titleH + 40} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`} style={{ fontSize: titleFit.fs, fontWeight: 800, letterSpacing: `${L.titleLS}px`, fontFamily: FONT, filter: light ? "drop-shadow(0 1px 2px rgba(255,255,255,.7)) drop-shadow(0 4px 14px rgba(255,255,255,.45))" : "drop-shadow(0 2px 3px rgba(0,0,0,.35)) drop-shadow(0 6px 16px rgba(0,0,0,.3))" }}>
                  {titleFit.lines.map((ln, i) => {
                    const s1 = ln.join("");
                    const x = right ? svgW - 4 : 0;
                    const y = L.titleBase + i * L.titleLine;
                    const anchor = right ? "end" : "start";
                    return (
                      <text key={i} x={x} y={y} textAnchor={anchor} fill={ink}>{s1}</text>
                    );
                  })}
                </g>
              </svg>
            </div>
          )}

          {/* 强调副题:色条展开 + 字滑入 */}
          {subFit && (
            <div style={{ position: "absolute", top: lay.subTop, ...side, width: subW, height: lay.subH }}>
              <div
                style={{
                  position: "absolute", left: 0, top: 0, width: subW, height: lay.subH, background: rgb(acc), borderRadius: 4,
                  transformOrigin: "left center", boxShadow: `0 6px 18px ${rgba(mix(acc, [0, 0, 0], 0.55), 0.28)}`,
                  transform: `scaleX(${b.toFixed(4)})`,
                }}
              />
              <div
                data-fx-role="label"
                data-small-text="subtitle"
                style={{
                  position: "absolute", left: L.subPadL, top: 6, fontSize: subFit.fs, lineHeight: `${lay.subLH}px`, fontWeight: 800,
                  color: subInk, letterSpacing: L.subLS, whiteSpace: "pre", opacity: st,
                  transform: `translateX(${((1 - st) * -14).toFixed(2)}px)`,
                }}
              >
                {subFit.lines.map((ln, i) => <div key={i}>{ln.join("")}</div>)}
              </div>
            </div>
          )}

          {/* 钉牌 */}
          {lay.plates.map((pl, i) => {
            const d = dropT[i];
            const u = D(d); // 落钉后按 1 倍速计的秒数
            if (t < d) return null;
            const rest = RESTS[i % RESTS.length];
            const rotK = Math.min(1, 300 / Math.max(1, pl.w)); // 长牌歪角按比例收,远端不会扫过上面的副题太久
            if (u < 0) return null;
            let y: number;
            let rot: number;
            let sx = 1;
            let sy = 1;
            let op: number;
            let shA: number;
            let shY: number;
            let shB: number;
            if (u < FALL) {
              // 下落:像重力一样越落越快,轻微歪着
              const f = u / FALL;
              const g = inQuad(f);
              y = -DROP * (1 - g);
              rot = -5 + 4 * f;
              op = outCubic(clamp(u / 0.14));
              sx = 1.03 - 0.03 * f;
              sy = sx;
              shY = 22 - 12 * f;
              shB = 30 - 12 * f;
              shA = 0.18 + 0.12 * f;
            } else {
              // 落定:一下压扁 + 绕钉子摆两下停住
              const v = u - FALL;
              const damp = Math.exp(-7 * v);
              y = -4 * Math.sin(v * 18) * Math.exp(-14 * v);
              const squash = 0.06 * Math.exp(-22 * v);
              sy = 1 - squash;
              sx = 1 + squash * 0.5;
              rot = rest + (-1 - rest) * Math.cos(v * 13) * damp;
              op = 1;
              shY = 6;
              shB = 14;
              shA = 0.38;
            }
            rot *= rotK;
            // 钉子:落定瞬间从上方按下去
            const pv = u - FALL + 0.05;
            const pk = clamp(pv / 0.18);
            const pinOp = pv < 0 ? 0 : outCubic(clamp(pv / 0.06));
            const pinS = pv < 0 ? 1.8 : 1.8 - 0.8 * outBack(pk, 2.2);
            const pinY = pv < 0 ? -8 : -8 * (1 - outCubic(pk));
            // 落钉涟漪
            const rv = P(d, FALL, 0.6);
            const r = 6 + 40 * outCubic(rv);
            const ringOp = rv > 0 && rv < 1 ? 0.7 * (1 - rv) : 0;
            // 当前项 vs 已讲过:旧的稍微退后,不位移
            const nd = dropT[i + 1];
            const fade = nd !== undefined ? outCubic(P(nd, FALL, 0.5)) : 0;
            const txtOp = 1 - (0.32) * fade;
            const numOp = 1 - (0.45) * fade;
            // 当前小圆点:落定后出现,极慢呼吸(待机唯一的动)
            const curIn = outCubic(P(d, FALL + 0.2, 0.4));
            const breathe = 0.75 + 0.25 * Math.cos(D(d) * Math.PI * 2 / 3.2);
            const curOp = curIn * (1 - fade) * breathe;
            return (
              <div
                key={i}
                style={{
                  position: "absolute", top: 0, ...side, transformOrigin: "30px 6px", opacity: op,
                  transform: `translate(0,${(pl.top + y).toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`,
                }}
              >
                <div
                  style={{
                    position: "absolute", left: 30, top: 6, width: 2 * r, height: 2 * r, borderRadius: "50%", boxSizing: "border-box",
                    border: `2px solid ${rgb(accLight)}`, opacity: ringOp, transform: `translate(${-r}px,${-r}px)`,
                  }}
                />
                <div
                  style={{
                    position: "relative", height: pl.h, display: "flex", alignItems: "center", boxSizing: "border-box",
                    padding: `0 ${L.platePadR}px 0 ${L.platePadL}px`, borderRadius: 6, whiteSpace: "nowrap",
                    background: plateBg,
                    boxShadow: `0 ${shY.toFixed(1)}px ${shB.toFixed(1)}px rgba(0,0,0,${(shA * shK).toFixed(3)}), ${plateEdge}`,
                    filter: undefined,
                  }}
                >
                  <span
                    style={{
                      font: `700 ${L.numFs}px/1 ${MONO}`, color: rgb(numCol), margin: `0 ${L.numMR}px 0 ${L.numML}px`,
                      letterSpacing: 1, opacity: numOp, alignSelf: pl.f.lines.length > 1 ? "flex-start" : undefined,
                      marginTop: pl.f.lines.length > 1 ? lay.pPad + (lay.pLH - L.numFs) / 2 : undefined, // 多行时编号对齐第一行
                    }}
                  >
                    {String(i + 1).padStart(digits, "0")}
                  </span>
                  <span
                    data-fx-role="label"
                    style={{ fontSize: pl.f.fs, lineHeight: `${lay.pLH}px`, fontWeight: 600, color: ink, letterSpacing: L.plateLS, opacity: txtOp }}
                  >
                    {pl.f.lines.map((ln, li) => <div key={li} style={{ whiteSpace: "pre" }}>{ln.join("")}</div>)}
                  </span>
                  <span
                    style={{
                      position: "absolute", right: 12, top: "50%", width: 6, height: 6, marginTop: -3, borderRadius: "50%",
                      background: rgb(numCol), opacity: curOp,
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "absolute", left: 21, top: -3, width: 18, height: 18, borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 32%, ${rgb(mix(acc, [255, 255, 255], 0.62))} 0, ${rgb(accLight)} 38%, ${rgb(mix(acc, [0, 0, 0], 0.18))} 78%, ${rgb(mix(acc, [0, 0, 0], 0.45))} 100%)`,
                    boxShadow: "0 2px 3px rgba(0,0,0,.55)", opacity: pinOp,
                    transform: `translateY(${pinY.toFixed(2)}px) scale(${pinS.toFixed(3)})`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { PinBoardPlate };
