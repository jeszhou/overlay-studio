import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import { ACCENT_SWATCH, OFFSET_CONTROLS, OFFSET_DEFAULTS, offsetVars } from "./accent";
import type { CSSProperties } from "react";

export interface Terminal3DParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  file: string;
  lines: string; // 用 | 分隔各行
  cps: number; // 每秒打字字符数
  lineTimes?: string; // Optional per-line start seconds, relative to card start; blank = legacy.
  accent?: string;
  offsetX?: number;
  offsetY?: number;
}


// ================= 终端打字 · 精修版 =================
/**
 * 逐拍照搬参考作品「终端逐行执行」的 renderAt:窗口带回弹 3D 翻入、朝人物侧转 9° →
 * 逐行逐字打出(行首符号回弹弹出、字从半透明到实、光标跟在行末,打字常亮、停下闪烁)→
 * ❯ 行打完右侧转圈,下一行开始后换成用时 → ✗ 行整窗抖一下、边框和行底变红、状态灯 error →
 * 下一行开始后边框从红渐变回来 → ✓ 行铺绿条,最后一个 ✓ 后一道绿光扫过、边框亮一下 → 计时器停住变绿 →
 * 停留时窗口缓慢浮动 → 最后 0.5 秒逐行淡出、窗口往外侧翻走。
 * 状态全部由行首符号驱动($ ❯ ✓ ✗ #),时间来自 lineTimes(空 = 按 cps 连续打字)。
 * 通用化:原作底栏「scenes 01–05」来自「--scenes 5」那期内容,改成「每个非注释行一格」(steps);
 * 原作写死的旁注「timeout」「12.4 MB」去掉;scene-003 的浅红高亮推广成「✗ 行里带数字的编号」。
 */
type TpRGB = [number, number, number];
type TpKind = "$" | "❯" | "✓" | "✗" | "#" | "";
type TpCls = "cmd" | "flag" | "str" | "num" | "cmt" | "file" | "arrow" | "id" | "tx";
interface TpCh { c: string; cls: TpCls }

const TP_GREEN: TpRGB = [61, 240, 138];
const TP_RED: TpRGB = [255, 90, 95];
const TP_CYAN: TpRGB = [127, 216, 255];
const TP_AMBER: TpRGB = [255, 200, 97];
const TP_MONO = '"SF Mono", "JetBrains Mono", Menlo, Monaco, "PingFang SC", "Hiragino Sans GB", monospace';
const TP_CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const TP_SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TP_W = 548; // 参考作品窗口宽
const TP_BAR = 50;
const TP_PAD_T = 20;
const TP_PAD_B = 12;
const TP_FOOT = 58;
const TP_OUT = 0.5;

// ---- 工具函数(参考作品原样;进度函数先比端点,退场时刻为 Infinity 时不出 NaN)----
const tpClamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const tpProg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const tpOut = (x: number) => 1 - Math.pow(1 - x, 3);
const tpIn = (x: number) => x * x * x;
const tpBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const tpSpring = (x: number, k: number, d: number) => (x <= 0 ? 0 : 1 - Math.exp(-d * x) * Math.cos(k * x));
const tpRgba = (c: TpRGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${tpClamp(a).toFixed(3)})`;
const tpMix = (a: TpRGB, b: TpRGB, k: number): TpRGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as TpRGB;
const tpPulse = (t: number, at: number, len: number) => { const x = (t - at) / len; return x < 0 || x > 1 ? 0 : Math.sin(Math.PI * x) * (1 - x * 0.3); };

/** 行首符号 → 行类型(卡的行语法:$ 提示符、❯ 执行、✓ 成功、✗ 失败、# 注释,其余是普通输出) */
function tpParse(raw: string): { k: TpKind; s: string } {
  const m = /^\s*([$❯>✓✔✗✕✘])\s?(.*)$/u.exec(raw);
  if (m) {
    const c = m[1];
    const k: TpKind = c === "$" ? "$" : c === "❯" || c === ">" ? "❯" : c === "✓" || c === "✔" ? "✓" : "✗";
    return { k, s: m[2].trimEnd() };
  }
  if (/^\s*#/.test(raw)) return { k: "#", s: raw.trim() };
  return { k: "", s: raw.trim() };
}

/** 语法色分词:-参数 / "字符串" / # 注释 / 数字 / 文件名 / 箭头 / $ 行首词 / ✗ 行里的编号 */
function tpTokens(s: string, k: TpKind): TpCh[] {
  const out: TpCh[] = [];
  const push = (str: string, cls: TpCls) => { for (const c of Array.from(str)) out.push({ c, cls }); };
  if (k === "#") { push(s, "cmt"); return out; }
  let i = 0;
  let first = true;
  while (i < s.length) {
    const rest = s.slice(i);
    const prev = i === 0 ? " " : s[i - 1];
    const atWs = /\s/.test(prev);
    let m: RegExpExecArray | null;
    let cls: TpCls = "tx";
    if (rest[0] === "#" && atWs) { push(rest, "cmt"); break; }
    if ((m = /^\s+/.exec(rest))) { push(m[0], "tx"); i += m[0].length; continue; }
    if ((m = /^("[^"]*"?|'[^']*'?|“[^”]*”?)/.exec(rest))) cls = "str";
    else if (atWs && (m = /^--?[\p{L}][\p{L}\p{N}_-]*/u.exec(rest))) cls = "flag";
    else if (k === "$" && first && (m = /^[^\s"']+/.exec(rest))) cls = "cmd";
    else if ((m = /^(→|->|=>)/.exec(rest))) cls = "arrow";
    else if (!/\w/.test(prev) && (m = /^[\w-]+(?:\.[\w-]+)*\.[A-Za-z][A-Za-z0-9]{0,4}(?![\w])/.exec(rest))) cls = "file";
    else if (k === "✗" && !/\w/.test(prev) && (m = /^[A-Za-z][A-Za-z_]*-?\d+[\w-]*/.exec(rest))) cls = "id";
    else if (!/\w/.test(prev) && (m = /^\d+(?:\.\d+)?%?/.exec(rest))) cls = "num";
    else if ((m = /^[A-Za-z_][\w]*/.exec(rest))) cls = "tx";
    else m = /^[\s\S]/u.exec(rest)!;
    push(m[0], cls);
    first = false;
    i += m[0].length;
  }
  return out;
}

const TP_WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const tpEm = (c: string) => (TP_WIDE.test(c) ? 1 : 0.602);
const tpWidth = (cs: TpCh[], f: number) => cs.reduce((a, ch) => a + tpEm(ch.c) * f, 0);
const TP_NO_LEAD = /[,.;:)\]}，。、！？：；）」』》]/;

/** 一行拆成若干段 [a, b):不拆英文词、行首不放标点 */
function tpWrap(cs: TpCh[], f: number, maxW: number): [number, number][] {
  const rows: [number, number][] = [];
  let a = 0;
  let w = 0;
  for (let i = 0; i < cs.length; i++) {
    const cw = tpEm(cs[i].c) * f;
    if (w + cw > maxW && i > a) {
      let cut = i;
      for (let j = i; j > a + Math.floor((i - a) * 0.4); j--) {
        const p = cs[j - 1].c;
        const q = cs[j].c;
        if (TP_NO_LEAD.test(q)) continue;
        if (p === " " || /[,;(\[{=+/]/.test(p) || TP_WIDE.test(p) || TP_WIDE.test(q)) { cut = j; break; }
      }
      if (cut === i && TP_NO_LEAD.test(cs[i].c)) { w += cw; continue; } // 标点挂在行尾
      rows.push([a, cut]);
      a = cut;
      while (a < i && cs[a].c === " ") a++; // 断在空格处,下一行行首不留空格
      w = 0;
      for (let j = a; j < i; j++) w += tpEm(cs[j].c) * f;
    }
    w += cw;
  }
  rows.push([a, cs.length]);
  return rows;
}

function tpAccent(accent: string | undefined): TpRGB {
  if (!accent || accent === "green") return TP_GREEN; // 参考作品的绿
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent];
  if (!hex) return TP_GREEN;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function Terminal3D({ params, playToken }: EffectProps<Terminal3DParams>) {
  const ex = params as Terminal3DParams & { __start?: number; __end?: number; scale?: number; __scale?: number;  centerOnStage?: boolean };
  const tRaw = useCardElapsed(ex as Terminal3DParams & { __t?: number; __start?: number }, playToken);
  const pos = params.position === "center" ? "left" : params.position;
  const right = pos === "right";
  const dir = right ? -1 : 1; // 朝人物侧转:左侧卡往右转,右侧卡镜像
  const dur = typeof ex.__end === "number" ? Math.max(0.5, ex.__end - (ex.__start ?? 0)) : Infinity;
  const t = Math.max(0, Math.min(dur, tRaw));
  const spd = usePlateSpeed(); // 动画速度:lineTimes 开打时刻不动,每行开打之后的动作按它加快(打字速度 cps 是用户设的速率,不动)
  // 以 a 为起点的动作:o 秒后开始、d 秒做完(按 1 倍速写,自动除以速度)
  const P = (a: number, o: number, d: number) => tpProg(t, a + o / spd, a + (o + d) / spd);
  // 脉冲:从 a 起、len 秒(按 1 倍速)的一道亮
  const PL = (a: number, o: number, len: number) => tpPulse(t, a + o / spd, len / spd);
  const ACC = tpAccent(params.accent);
  const MUTE = "#8a9a90";
  const INK = "#eef3ef";

  // ---- 行:类型 + 语法色 + 开打时刻 ----
  const raw = (params.lines ?? "").split("|");
  const L = raw.map((r) => { const p = tpParse(r); return { ...p, cs: tpTokens(p.s, p.k) }; });
  const cps = Math.max(1, Number(params.cps) || 26);
  const ts = (params.lineTimes ?? "").trim() ? params.lineTimes!.split("|").map((x) => (x.trim() ? Number(x) : NaN)) : [];
  const timed = ts.length === raw.length && ts.every((v, i) => Number.isFinite(v) && v >= 0 && (i === 0 || v >= ts[i - 1]));
  const st: number[] = [];
  L.forEach((_, i) => {
    if (timed) st.push(ts[i]);
    else if (i === 0) st.push(0);
    else {
      // 连续打字:上一行打完后停一下再开下一行(❯ 停得久,让转圈露出来;✗ 次之)
      const pk = L[i - 1].k;
      st.push(st[i - 1] + L[i - 1].cs.length / cps + (pk === "❯" ? 0.9 : pk === "✗" ? 0.6 : 0.3));
    }
  });
  const end = L.map((r, i) => st[i] + r.cs.length / cps);
  const next = L.map((_, i) => (i + 1 < L.length ? st[i + 1] : Infinity));
  const errIdx = L.map((r, i) => (r.k === "✗" ? i : -1)).filter((i) => i >= 0);
  const okIdx = L.map((r, i) => (r.k === "✓" ? i : -1)).filter((i) => i >= 0);
  const lastErr = errIdx.length ? errIdx[errIdx.length - 1] : -1;
  const finIdx = okIdx.length && okIdx[okIdx.length - 1] > lastErr ? okIdx[okIdx.length - 1] : -1;
  const FIN_T = finIdx >= 0 ? st[finIdx] : Infinity;
  const firstOk = okIdx.length ? st[okIdx[0]] : Infinity;
  const lastK = L.length ? L[L.length - 1].k : "";
  const T_STOP = lastK === "✓" || lastK === "✗" ? Math.max(st[L.length - 1] + 0.65, end[L.length - 1] + 0.1) : Infinity;

  // ---- 版面:宽度受安全区限制(人脸线按 scale=1、offset=0 算,出画按真实 scale / offset 算)----
  const s = Math.max(0.2, (Number(ex.scale) || 1) * (Number(ex.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const SW = 1920;
  const SH = 1080;
  const within = (sc: number, x: number, limit: number) => (right ? (SW - 120 + x - limit) / sc : (SW - limit - 120 - x) / sc);
  const maxW = Math.min(within(1, 0, right ? 1220 : SW - 700), within(s, ox, 48));
  const side = (k: TpKind, f: number) => (k === "❯" ? Math.round(f * 2.3) : 0); // ❯ 行右侧留给转圈 / 用时
  const natW = (f: number) => 44 + Math.round((f * 34) / 28) + Math.max(0, ...L.map((r) => tpWidth(r.cs, f) + side(r.k, f))) + 4;
  const W = Math.round(Math.max(Math.min(maxW, 400), Math.min(maxW, Math.max(TP_W, natW(28)))));
  const fit = tpClamp(maxW / W, 0.5, 1);
  // 太长先换行(最多两行),两行还放不下才缩一档字号,再放不下就继续换行
  const wrapAll = (f: number) => L.map((r) => tpWrap(r.cs, f, W - 44 - Math.round((f * 34) / 28) - side(r.k, f)));
  let f = 28;
  let wraps = wrapAll(28);
  if (wraps.some((w) => w.length > 2)) { f = 26; wraps = wrapAll(26); }
  const ICON = Math.round((f * 34) / 28);
  const rowH1 = Math.round((f * 54) / 28);
  const lineH = Math.round(f * 1.3);
  const rowH = wraps.map((w) => rowH1 + (w.length - 1) * lineH);
  const rowTop: number[] = [];
  rowH.reduce((a, h, i) => ((rowTop[i] = a), a + h), 0);
  const contentH = rowH.reduce((a, h) => a + h, 0);
const availH = (SH - 80 - 2 * Math.abs(oy)) / s;
  const chrome = TP_BAR + TP_PAD_T + TP_PAD_B + TP_FOOT;
  const bodyH = Math.max(Math.min(contentH, availH / fit - chrome), rowH1);
  const H = chrome + bodyH;
  // 行太多:像真终端一样往上滚,保证正在打的那行露在底部
  const excess = rowTop.map((tp, i) => Math.max(0, tp + rowH[i] - bodyH));
  const scroll = excess.reduce((a, e, i) => a + (e - (i ? excess[i - 1] : 0)) * tpOut(P(st[i], 0, 0.25)), 0);

  // ---- 窗口:3D 入场 / 呼吸 / 报错抖动 / 收走(参考作品原样)----
  const inK = tpSpring((t * spd) / 0.9, 7.5, 6.2);
  const outK = tpIn(tpProg(t, dur - TP_OUT / spd, dur));
  const shake = errIdx.reduce((a, i) => (t > st[i] ? a + Math.sin((t - st[i]) * spd * 62) * 9 * Math.exp(-(t - st[i]) * spd * 9) : a), 0);
  const breathe = Math.sin(t * spd * 0.9) * 1.4;
  const ry = (34 * (1 - inK) + 9 + breathe + outK * 46) * dir;
  const rx = -6 * (1 - inK) + Math.sin(t * spd * 0.7 + 1) * 0.8;
  const wx = (-120 * (1 - inK) - outK * 140) * dir + shake;
  const wy = 30 * (1 - inK) + Math.sin(t * spd * 1.1) * 3;
  const wsc = 0.9 + 0.1 * inK - outK * 0.06;
  const winOp = tpClamp((t * spd) / 0.25) * (1 - outK);

  // 边框:强调色 → 报错红 → 下一行开始后 0.8s 渐回 → 成功高光
  const errHeat = errIdx.reduce((a, i) => Math.max(a, t < st[i] ? 0 : t < next[i] ? 1 : 1 - P(next[i], 0, 0.8)), 0);
  const rimCol = tpMix(ACC, TP_RED, errHeat);
  const glow =
    0.28 +
    errIdx.reduce((a, i) => a + 0.5 * PL(st[i], 0, 0.6), 0) +
    okIdx.reduce((a, i) => a + (i === finIdx ? 0 : 0.6 * PL(st[i], 0, 0.7)), 0) +
    0.9 * PL(FIN_T, 0.3, 0.9);
  const sw = P(FIN_T, 0.25, 0.9);

  // ---- 状态灯:按已开打的行类型走 ----
  let state = "idle";
  let dot: TpRGB = [138, 154, 144];
  let errOpen = false;
  L.forEach((r, i) => {
    if (t < st[i]) return;
    if (r.k === "$") { state = "run"; dot = ACC; }
    else if (r.k === "❯") { state = errOpen ? "debugging" : "running"; dot = errOpen ? TP_AMBER : TP_CYAN; }
    else if (r.k === "✗") { state = "error"; dot = TP_RED; errOpen = true; }
    else if (r.k === "✓") { state = "done"; dot = TP_GREEN; errOpen = false; }
  });
  const lp = 0.5 + 0.5 * Math.sin(t * spd * Math.PI * 2 * (state === "error" ? 2.2 : 1));
  const run = Math.min(t, T_STOP);
  const mm = Math.floor(run / 60);
  const sec = Math.floor(run % 60);
  const ds = Math.floor((run - Math.floor(run)) * 10);
  const clock = `${mm < 10 ? "0" : ""}${mm}:${sec < 10 ? "0" : ""}${sec}.${ds}`;
  const stopped = t > T_STOP;
  const clockCol = stopped ? (lastK === "✗" ? "#ff5a5f" : "#3df08a") : "#b8c6bd";

  // ---- 光标 ----
  let cur = 0;
  L.forEach((_, i) => { if (t >= st[i]) cur = i; });
  const curN = L.length ? Math.min(Math.max(0, (t - st[cur]) * cps), L[cur].cs.length) : 0;
  const caretAt = Math.ceil(curN);
  const typing = L.length ? t < end[cur] + 0.05 : false;
  const blink = typing ? 1 : Math.floor(t * spd * 2.2) % 2 === 0 ? 1 : 0.12;
  const caret = (
    <span
      style={{
        display: "inline-block", width: Math.round(f * 0.54), height: Math.round(f * 1.07), marginLeft: 4, verticalAlign: "middle",
        background: tpRgba(ACC, 1), borderRadius: 2, boxShadow: `0 0 10px ${tpRgba(ACC, 0.55)}`, opacity: blink * (1 - outK),
      }}
    />
  );

  // ---- 底栏:每个非注释行一格(原作 5 格场景是那期内容,这里按步数走)----
  const steps = L.map((r, i) => (r.k === "#" || (!r.s && r.k === "") ? -1 : i)).filter((i) => i >= 0);
  const clockW = 17 * 0.602 * clock.length + 10;
  const cellAvail = W - 44 - 60 - clockW;
  const cellW = steps.length ? Math.max(6, Math.min(40, cellAvail / steps.length - 7)) : 0;
  const recovered = (i: number) => okIdx.some((o) => o > i);

  const colOf: Record<TpCls, CSSProperties> = {
    cmd: { color: "#ffffff", fontWeight: 700 },
    flag: { color: "#7fd8ff" },
    str: { color: "#ffc861" },
    num: { color: "#ffc861" },
    cmt: { color: "#6f7f75", fontStyle: "italic" },
    file: { color: "#3df08a", fontWeight: 600 },
    arrow: { color: MUTE },
    id: { color: "#ffb0b2", fontWeight: 600 },
    tx: { color: INK },
  };
  const ICON_OF: Record<TpKind, [string, string]> = { $: ["#ffffff", "$"], "❯": ["#7fd8ff", "❯"], "✗": ["#ff5a5f", "✗"], "✓": ["#3df08a", "✓"], "#": ["", ""], "": ["", ""] };

  // 标题:「名字 · 说明」/「名字 — 说明」前半截加粗上强调色(照原作 auto-motion · 流程示意)
  const file = params.file ?? "";
  const sep = /\s+[·—–-]\s+/.exec(file);
  const fileHead = sep ? file.slice(0, sep.index) : "";
  const fileTail = sep ? file.slice(sep.index) : file;

  const rightOrigin = right && ex.centerOnStage !== true;
const anchorFix: CSSProperties = rightOrigin ? { transformOrigin: "100% 50%" } : {};

  return (
    <div
      className={`hud hud-anchor hud-anchor--${pos}`}
      data-terminal-timed={timed ? "true" : undefined}
      // opacity:1 盖掉编辑台末尾统一淡出,退场由照搬的逐行淡出 + 翻走负责
      style={{ ...offsetVars(params), ...anchorFix, ...(Number.isFinite(dur) ? { opacity: 1 } : null) }}
    >
      <div style={{ position: "relative", width: W * fit, height: H * fit }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: W, height: H, transform: fit < 1 ? `scale(${fit.toFixed(4)})` : undefined, transformOrigin: "0 0",
            perspective: "1700px", perspectiveOrigin: `${right ? W - 230 : 230}px 50%`,
          }}
        >
          <div
            data-fx-role="frame"
            style={{
              position: "absolute", left: 0, top: 0, width: W, height: H, boxSizing: "border-box", borderRadius: 18, overflow: "hidden",
              transformOrigin: right ? "100% 50%" : "0% 50%", fontFamily: TP_MONO, WebkitFontSmoothing: "antialiased",
              background: "linear-gradient(180deg, rgba(14,20,17,0.90), rgba(8,12,10,0.92))",
              boxShadow: "0 30px 70px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07) inset",
              filter: undefined,
              transform: `translate3d(${wx.toFixed(2)}px,${wy.toFixed(2)}px,0) rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) scale(${wsc.toFixed(4)})`,
              opacity: winOp,
            }}
          >
            <div
                style={{
                  position: "absolute", top: 0, bottom: 0, width: 160, pointerEvents: "none", left: -180 + sw * (W + 212),
                  background: `linear-gradient(90deg, transparent, ${tpRgba(TP_GREEN, 0.16)}, transparent)`, opacity: sw > 0 && sw < 1 ? 1 : 0,
                }}
              />
            {/* 标题栏 */}
            <div
              style={{
                height: TP_BAR, display: "flex", alignItems: "center", padding: "0 20px", gap: 9, boxSizing: "border-box",
                borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)",
              }}
            >
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <span key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c, flex: "none" }} />
              ))}
              <span
                data-fx-role="label"
                style={{
                  marginLeft: 14, fontFamily: TP_CJK, fontSize: 19, color: "#c9d4cd", letterSpacing: 0.5,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "0 1 auto",
                }}
              >
                {fileHead && <b style={{ color: tpRgba(ACC, 1), fontWeight: 600, fontFamily: TP_MONO }}>{fileHead}</b>}
                {fileTail}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 15, color: tpRgba(dot, 0.95), display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: tpRgba(dot, 1), boxShadow: `0 0 ${(4 + 8 * lp).toFixed(1)}px ${tpRgba(dot, 0.9)}` }} />
                <span>{state}</span>
              </span>
            </div>
            {/* 正文:逐行逐字 */}
            <div style={{ position: "relative", padding: `${TP_PAD_T}px 22px ${TP_PAD_B}px` }}>
              {/* 滚动只在行区里裁,不滚进上下内边距;左右放宽 12 给行底色条 */}
              <div style={{ position: "relative", height: bodyH, margin: "0 -12px", padding: "0 12px", overflow: "hidden" }}>
              <div style={{ position: "relative", transform: scroll ? `translateY(${(-scroll).toFixed(2)}px)` : undefined }}>
                {L.map((r, i) => {
                  const s0 = st[i];
                  const shown = t >= s0;
                  const lineOut = tpIn(tpProg(t, dur - (TP_OUT - i * 0.03) / spd, dur - (0.12 - i * 0.03 * 0.3) / spd));
                  const a = tpOut(P(s0, 0, 0.2));
                  const n = (t - s0) * cps;
                  let bgK = 0;
                  let bgCol = TP_GREEN;
                  const in3 = tpOut(P(s0, 0, 0.3));
                  if (r.k === "✗") { bgCol = TP_RED; bgK = 0.18 * in3 + 0.12 * PL(s0, 0, 0.5); }
                  if (r.k === "✓") bgK = 0.1 * in3 + 0.14 * PL(s0, 0, 0.6);
                  // 右侧:❯ 行打完转圈,下一行开始后显示用时(下一行是 ✗ 时用时标红)
                  let sideTx = "";
                  let sideCol = MUTE;
                  let spin = false;
                  if (r.k === "❯" && t >= end[i]) {
                    if (t < next[i]) { sideTx = TP_SPIN[Math.floor(t * spd * 12) % TP_SPIN.length]; sideCol = "#7fd8ff"; spin = true; }
                    else { sideTx = `${(next[i] - s0).toFixed(1)}s`; sideCol = L[i + 1]?.k === "✗" ? "rgba(255,90,95,0.75)" : MUTE; }
                  }
                  const [icCol, icTx] = ICON_OF[r.k];
                  const textTop = (rowH1 - lineH) / 2;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "relative", height: rowH[i], opacity: shown ? a * (1 - lineOut) : 0,
                        transform: `translateX(${((1 - a) * -14 - lineOut * 20).toFixed(2)}px)`,
                      }}
                    >
                      {(r.k === "✗" || r.k === "✓") && (
                        <div
                          style={{
                            position: "absolute", left: -12, right: -12, top: 5, bottom: 5, borderRadius: 9, transformOrigin: "0 50%",
                            background: tpRgba(bgCol, bgK), transform: `scaleX(${tpOut(P(s0, 0, 0.35)).toFixed(3)})`,
                            boxShadow: `inset 3px 0 0 ${tpRgba(bgCol, (r.k === "✗" ? 0.9 : 0.8) * in3)}`,
                          }}
                        />
                      )}
                      {icTx && (
                        <span
                          style={{
                            position: "absolute", left: 0, top: textTop, height: lineH, lineHeight: `${lineH}px`, fontSize: f, fontWeight: 700, color: icCol,
                            display: "inline-block", transform: `scale(${shown ? tpBack(P(s0, 0, 0.28)).toFixed(3) : 0})`,
                          }}
                        >
                          {icTx}
                        </span>
                      )}
                      <div data-fx-role="label" style={{ position: "absolute", left: ICON, top: textTop, fontSize: f, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                        {wraps[i].map(([a0, b0], li) => (
                          <div key={li} style={{ height: lineH, lineHeight: `${lineH}px`, whiteSpace: "pre" }}>
                            {i === cur && caretAt === 0 && a0 === 0 && li === 0 && caret}
                            {r.cs.slice(a0, b0).map((ch, j) => {
                              const gi = a0 + j;
                              const k = tpClamp(n - gi);
                              return (
                                <span key={j}>
                                  <span
                                    style={{
                                      ...colOf[ch.cls], ...(TP_WIDE.test(ch.c) ? { fontFamily: TP_CJK, fontWeight: colOf[ch.cls].fontWeight ?? 500 } : null),
                                      opacity: k > 0 ? 0.35 + 0.65 * k : 0,
                                    }}
                                  >
                                    {ch.c}
                                  </span>
                                  {i === cur && caretAt === gi + 1 && caret}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      {sideTx && (
                        <span style={{ position: "absolute", right: 0, top: textTop, height: lineH, lineHeight: `${lineH}px`, fontSize: spin ? f : 17, color: sideCol, opacity: 1 - lineOut }}>
                          {sideTx}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
            {/* 底栏:步数进度格 + 计时器 */}
            <div
              style={{
                height: TP_FOOT, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "14px 22px 18px",
                borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 15, color: MUTE,
              }}
            >
              {steps.length > 0 && <span>steps</span>}
              <div style={{ display: "flex", gap: 7 }}>
                {steps.map((li, c) => {
                  const r = L[li];
                  const s0 = st[li];
                  let fill = 0;
                  let col: TpRGB = TP_GREEN;
                  if (r.k === "❯") {
                    // 执行中:琥珀色填一截;下一行开始 = 这步跑完,铺满
                    if (t < next[li]) { fill = 0.2 + 0.25 * tpOut(P(s0, 0, 0.6)); col = TP_AMBER; }
                    else fill = 1;
                    if (t < s0) fill = 0;
                  } else if (r.k === "✗") {
                    const rec = next[li] + 0.4;
                    fill = t < s0 ? 0 : 1;
                    col = TP_RED;
                    if (t >= s0 && t < rec && Math.floor((t - s0) * spd * 4) % 2 === 1) fill = 0.55;
                    if (recovered(li) && t >= rec) col = tpMix(TP_RED, TP_GREEN, P(rec, 0, 0.5));
                  } else {
                    fill = tpOut(P(s0, 0, 0.4));
                    col = r.k === "$" ? ACC : TP_GREEN;
                  }
                  const pop = (r.k === "✗" ? 0.18 * PL(s0, 0, 0.4) : 0) + 0.1 * PL(firstOk, c * 0.05, 0.35);
                  return (
                    <div
                      key={li}
                      style={{
                        width: cellW, height: 26, borderRadius: 6, boxSizing: "border-box", position: "relative", overflow: "hidden", flex: "none",
                        border: `1px solid ${fill > 0 ? tpRgba(col, 0.6) : "rgba(255,255,255,0.12)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, transform: `scale(${(1 + pop).toFixed(3)})`,
                      }}
                    >
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(fill * 100).toFixed(1)}%`, background: tpRgba(col, 0.85) }} />
                      {cellW >= 26 && (
                        <em style={{ position: "relative", fontStyle: "normal", color: fill > 0.6 ? "#07130c" : MUTE }}>{String(c + 1).padStart(2, "0")}</em>
                      )}
                    </div>
                  );
                })}
              </div>
              <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: clockCol, fontSize: 17, flex: "none" }}>{clock}</span>
            </div>
            <div
                style={{
                  position: "absolute", inset: 0, borderRadius: 18, pointerEvents: "none", boxSizing: "border-box",
                  border: `1.5px solid ${tpRgba(rimCol, 0.35 + 0.4 * glow)}`,
                  boxShadow: `0 0 ${(10 + 30 * glow).toFixed(1)}px ${tpRgba(rimCol, 0.25 * glow)}, inset 0 0 ${(20 * glow).toFixed(1)}px ${tpRgba(rimCol, 0.12 * glow)}`,
                }}
              />
          </div>
        </div>
      </div>
    </div>
  );
}

export const terminal3DDef: EffectDef<Terminal3DParams> = {
  id: "terminal-3d",
  name: "Terminal3D",
  description: "3D 终端打字机 · 多色逐字打命令",
  tags: ["3D 浮屏", "生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    file: "demo — 终端演示",
    lines:
      "$ 敲一条命令 --带参数|# 注释:说明这一步在干嘛|❯ 执行过程逐字打出 ...|✓ 结果一行,绿勾收尾",
    cps: 26,
    ...OFFSET_DEFAULTS,
  },
  controls: [
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
    { key: "file", label: "标题栏文件名", type: "text" },
    { key: "lines", label: "命令行(用 | 分隔;$提示符 -参数 \"字符串\" #注释 ✓成功 ✗失败)", type: "text" },
    { key: "cps", label: "打字速度(字/秒)", type: "range", min: 8, max: 60, step: 2 },
    { key: "lineTimes", label: "逐行开打秒(|分隔,数量须与行数相同;空=连续打字)", type: "text" },
    ...OFFSET_CONTROLS,
  ],
  Component: Terminal3D,
};
