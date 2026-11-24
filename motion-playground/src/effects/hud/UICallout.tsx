import type { EffectDef, EffectProps } from "../types";
import { useId, type CSSProperties } from "react";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  offsetVars,
} from "./accent";

export interface UICalloutParams {
  theme: "dark" | "light";
  label: string;
  ringW: number;
  ringH: number;
  side: "left" | "right"; // 标签在圈的哪一侧
  accent: string;
  /** 精修版:标签以 ①/1. 开头时,自动拆出编号徽章 + 「STEP 01 · 第一步」眉标;off = 原样显示 */
  stepTag?: "auto" | "off";
  /** 精修版:高亮词,用 | 分隔;留空 = 自动高亮标签里的英文/数字词 */
  hlWords?: string;
  offsetX?: number;
  offsetY?: number;
}

/**
 * 界面标注:一个圈住目标区域的圆角框 + 一根自绘引线 + 标签。
 * 用「水平/垂直微调」把圈挪到你界面元素的位置,ringW/ringH 调圈大小。
 */
/* ============ 精修版:UICallout ============
   逐拍照搬参考作品「界面标注」:锁定角从外向内收、带回弹(对准)→ 圈框从接点往上下两路描出、在对侧合拢
   → 接点弹出、引线从圈里长出 → 标签从引线一侧展开 → 编号徽章弹出、眉标滑入、文字逐字上浮。
   停留:白色高光沿框游走(1.4 秒一圈)、每 1.1 秒向外扩一圈淡呼吸环。
   有终点时最后 0.5 秒反向收走:文字先淡 → 标签合向引线 → 引线缩回 → 框退回、锁定角散开。
   圈的位置/大小完全跟原卡一样(由 ringW/ringH/side/偏移决定),只有标签受「不出画」约束。
   全部画面是 t 的纯函数;只用行内样式,不依赖 hud.css */
const UC_FONT = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';
const UC_MONO = `"SF Mono", Menlo, ${UC_FONT}`;
const UC_REF_DUR = 3.3; // 参考作品时长:退场各拍按「距终点多久」换算
const UC_LEAD = 58; // 引线长
const UC_LABEL_MAX = 520; // 标签最宽;再长先换行
const UC_LABEL_MIN = 240;
const UC_MARGIN = 48; // 出画底线
const UC_PAD_X = 24;
const UC_MAIN_FS = 30;
const UC_MAIN_LH = 40;

const ucCl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ucSeg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : ucCl((t - a) / (b - a))); // 先比端点:退场时刻为 Infinity(没有 __end)时不出 NaN
const oCub = (x: number) => 1 - Math.pow(1 - x, 3);
const iCub = (x: number) => x * x * x;
const oQuint = (x: number) => 1 - Math.pow(1 - x, 5);
const oBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
const u2 = (x: number) => +x.toFixed(2);
const u3 = (x: number) => +x.toFixed(3);
const u4 = (x: number) => +x.toFixed(4);

type UcRgb = [number, number, number];
function ucAccent(accent: string): UcRgb {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const ucRgba = (c: UcRgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ucHex = (c: UcRgb) => `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;

/* ── 文字量宽 / 断行(先换行,最多两行自然断开;字号不低于正文 30px,两行放不下再多折) ── */
const ucIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const ucIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
const ucEm = (c: string) => (ucIsWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
const ucW = (cs: string[], fs: number, ls: number) => cs.reduce((w, c) => w + ucEm(c) * fs + ls, 0);
const UC_PUNCT_HEAD = /[，。、！？：；·,.!?:;）)」』》]/;
const ucTrim = (cs: string[]) => {
  let a = 0;
  let b = cs.length;
  while (a < b && cs[a] === " ") a++;
  while (b > a && cs[b - 1] === " ") b--;
  return cs.slice(a, b);
};
function ucSplit2(cs: string[]): [string[], string[]] | null {
  const w = cs.map(ucEm);
  const total = w.reduce((a, b) => a + b, 0);
  let best: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const a = cs[i - 1];
    const b = cs[i];
    if (ucIsWord(a) && ucIsWord(b)) continue;
    const nb = cs.slice(i).find((c) => c !== " ") ?? "";
    if (UC_PUNCT_HEAD.test(nb)) continue;
    const cost =
      Math.max(acc, total - acc) *
      (a === " " || b === " " || /[，。、！？：；·,.!?:;]/.test(a) ? 0.9 : 1) *
      (/[的地得]/.test(a) ? 0.72 : /[也是就都才还和与]/.test(b) ? 0.8 : 1);
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  return best ? [ucTrim(cs.slice(0, best.at)), ucTrim(cs.slice(best.at))] : null;
}
function ucGreedy(cs: string[], fs: number, ls: number, maxW: number) {
  const units: string[][] = [];
  cs.forEach((c, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && ucIsWord(cs[i - 1]) && ucIsWord(c)) last.push(c);
    else units.push([c]);
  });
  const lines: string[][] = [];
  let cur: string[] = [];
  units.forEach((u) => {
    if (cur.length && ucW([...cur, ...u], fs, ls) > maxW && !UC_PUNCT_HEAD.test(u[0])) {
      lines.push(ucTrim(cur));
      cur = u[0] === " " ? [] : [...u];
    } else cur.push(...u);
  });
  if (cur.length) lines.push(ucTrim(cur));
  return lines.filter((l) => l.length);
}
function ucLines(text: string, maxW: number, fs: number, ls: number): string[][] {
  const cs = ucTrim(Array.from(text));
  if (!cs.length) return [];
  if (ucW(cs, fs, ls) <= maxW) return [cs];
  const two = ucSplit2(cs);
  if (two && Math.max(ucW(two[0], fs, ls), ucW(two[1], fs, ls)) <= maxW) return two;
  return ucGreedy(cs, fs, ls, maxW);
}

/** 标签开头的编号:①–⑳ 或 1. / 1、/ 1) 这类 */
function ucStep(label: string): { n: number; rest: string } | null {
  const s = label.trim();
  const cp = s.codePointAt(0) ?? 0;
  if (cp >= 0x2460 && cp <= 0x2473) return { n: cp - 0x2460 + 1, rest: s.slice(1).trim() };
  const m = /^(\d{1,2})\s*[.、:：)）]\s*/.exec(s);
  return m ? { n: Number(m[1]), rest: s.slice(m[0].length).trim() } : null;
}
const UC_ZH = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const ucZhNum = (n: number) => (n < 10 ? UC_ZH[n] : n === 10 ? "十" : n < 20 ? `十${UC_ZH[n - 10]}` : `${UC_ZH[Math.floor(n / 10)]}十${n % 10 ? UC_ZH[n % 10] : ""}`);

/** 拆成逐字动画的单元:英文/数字词整体一个,其余一字一个;标出高亮 */
function ucUnits(line: string[], hl: string[]) {
  const units: { s: string; hl: boolean }[] = [];
  line.forEach((c, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && ucIsWord(line[i - 1]) && ucIsWord(c)) last.s += c;
    else units.push({ s: c, hl: false });
  });
  const text = line.join("");
  const mark = new Array(text.length).fill(false);
  if (hl.length) {
    hl.forEach((w) => {
      for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) for (let k = 0; k < w.length; k++) mark[at + k] = true;
    });
  }
  let pos = 0;
  units.forEach((u) => {
    u.hl = hl.length ? mark[pos] === true : /[A-Za-z0-9]/.test(u.s);
    pos += u.s.length;
  });
  return units;
}

/** 圈框路径:从接点(左中或右中)起,up/dn 两路在对侧中点合拢;comet 是绕一圈的闭合路径 */
function ucRingPaths(L: number, T: number, w: number, h: number, r: number, fromLeft: boolean) {
  const R = L + w;
  const B = T + h;
  const M = T + h / 2;
  const X = (x: number) => u2(fromLeft ? x : L + R - x); // 右接点 = 左右镜像
  const sw = (f: 0 | 1) => (fromLeft ? f : 1 - f);
  const up = `M${X(L)},${u2(M)} L${X(L)},${u2(T + r)} A${r},${r} 0 0 ${sw(1)} ${X(L + r)},${u2(T)} L${X(R - r)},${u2(T)} A${r},${r} 0 0 ${sw(1)} ${X(R)},${u2(T + r)} L${X(R)},${u2(M)}`;
  const dn = `M${X(L)},${u2(M)} L${X(L)},${u2(B - r)} A${r},${r} 0 0 ${sw(0)} ${X(L + r)},${u2(B)} L${X(R - r)},${u2(B)} A${r},${r} 0 0 ${sw(0)} ${X(R)},${u2(B - r)} L${X(R)},${u2(M)}`;
  const comet = `M${X(L)},${u2(M)} L${X(L)},${u2(T + r)} A${r},${r} 0 0 ${sw(1)} ${X(L + r)},${u2(T)} L${X(R - r)},${u2(T)} A${r},${r} 0 0 ${sw(1)} ${X(R)},${u2(T + r)} L${X(R)},${u2(B - r)} A${r},${r} 0 0 ${sw(1)} ${X(R - r)},${u2(B)} L${X(L + r)},${u2(B)} A${r},${r} 0 0 ${sw(1)} ${X(L)},${u2(B - r)} Z`;
  return { up, dn, comet };
}

function UICallout({ params, playToken }: EffectProps<UICalloutParams>) {
  const { label, ringW, ringH, side, accent } = params;
  const t0 = useCardElapsed(params as { __t?: number; __start?: number }, playToken);
  const extra = params as { scale?: number; __scale?: number; __start?: number; __end?: number;  centerOnStage?: boolean };
  // 有 __end 才退场:最后 0.5 秒收走(各拍按参考作品「距终点多久」排);没有就一直停着
  const DUR = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) : Infinity;
  const d = Number.isFinite(DUR) ? Math.max(1.2, DUR) - UC_REF_DUR : Infinity; // 退场整体平移量
  const t = Math.max(0, Math.min(DUR, t0));
  // 动画速度:无卡点参数。进场/停留按卡内时间 te 加快;退场按「距终点多久」排,时钟 tx 让它仍在终点前走完
  const spd = usePlateSpeed();
  const te = t * spd;
  const tx = Number.isFinite(DUR) ? (t - DUR) * spd + DUR - d : -Infinity;
  const acc = ucAccent(accent);
  const accHex = ucHex(acc);
  const lum = (0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]) / 255;
  const badgeInk = lum > 0.62 ? "#10131c" : "#ffffff";
  const hlColor = ucRgba([0, 1, 2].map((k) => Math.round(acc[k] + (255 - acc[k]) * 0.35)) as UcRgb, 1);
  const filterId = `ucsh${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // ── 文案:开头有编号就拆成徽章 + 眉标(stepTag=off 时原样显示) ──
  const raw = String(label ?? "").trim();
  const step = params.stepTag === "off" ? null : ucStep(raw);
  const mainText = step && step.rest ? step.rest : raw;
  const kicker = step ? `STEP ${String(step.n).padStart(2, "0")} · 第${ucZhNum(step.n)}步` : "";
  const hl = String(params.hlWords ?? "").split("|").map((x) => x.trim()).filter(Boolean);

  // ── 圈的几何:和原卡同一个外框(圈宽 + 190),圈在外框里的位置也一样,所以同一组参数圈住同一块 ──
  const rw = ringW;
  const rh = ringH;
  const bw = rw + 190;
  const bh = Math.max(rh, 80);
  const midY = bh / 2;
  const ringL = side === "right" ? 0 : 190;
  const ringT = midY - rh / 2;
  const cx = ringL + rw / 2;
  const cy = midY;
  const rr = Math.max(4, Math.min(22, rw / 4, rh / 4));

  // ── 标签宽:只受「不出画」约束(真实 scale / 偏移);圈本身由用户定位,不躲脸 ──
  const s = Math.max(0.2, (Number(extra.scale) || 1) * (Number(extra.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const SW = 1920;
  const Cx = SW / 2 + ox; // 外框中心(缩放原点)的屏幕 x
  // 标签一侧能放多宽(不出画):左侧 = 接点左边到画面左缘,右侧同理
  const roomOf = (left: boolean) =>
    left ? ringL - UC_LEAD - bw / 2 + (Cx - UC_MARGIN) / s : (SW - UC_MARGIN - Cx) / s - (ringL + rw + UC_LEAD - bw / 2);
  const kickW = kicker ? 26 + 10 + ucW(Array.from(kicker), 18, 18 * 0.14) : 0;
  const LS = UC_MAIN_FS * 0.02;
  const natW = Math.max(kickW, ucW(Array.from(mainText), UC_MAIN_FS, LS)) + UC_PAD_X * 2 + 4;
  // 选的那侧连最小宽都放不下(圈贴着画面边)而对侧更宽,标签翻到对侧,免得出画;圈不动
  const want = side !== "right";
  const need = Math.min(UC_LABEL_MIN, natW);
  const fromLeft = roomOf(want) < need && roomOf(!want) > roomOf(want) ? !want : want; // 标签在圈左 → 接点是圈的左中点
  const ax = fromLeft ? ringL : ringL + rw; // 接点
  const roomW = roomOf(fromLeft);
  const paths = ucRingPaths(ringL, ringT, rw, rh, rr, fromLeft);
  const LW = Math.ceil(Math.max(need, Math.min(natW, UC_LABEL_MAX, roomW)));
  const lines = ucLines(mainText, LW - UC_PAD_X * 2 - 4, UC_MAIN_FS, LS);
  const kickH = kicker ? 26 + 8 : 0;
  const LH = 16 + kickH + Math.max(1, lines.length) * UC_MAIN_LH + 16;
  const labelX = fromLeft ? ax - UC_LEAD - LW : ax + UC_LEAD;
  const labelY = midY - LH / 2;

  // ── 圈注框:从接点向上下两路描出,收走时退回接点 ──
  const drawIn = oQuint(ucSeg(te, 0.05, 0.55));
  const drawOut = iCub(ucSeg(tx, 3.0, 3.28));
  const len = drawIn * (1 - drawOut);
  // 锁定角:从外围大一圈收进来带回弹,收走时往外散开淡出(位移按圈大小封顶,大圈不会甩太远)
  const bIn = ucSeg(te, 0, 0.42);
  const bOut = ucSeg(tx, 3.02, 3.26);
  const bs = 1.22 - 0.22 * oBack(bIn) + 0.12 * oCub(bOut);
  const bOp = oCub(ucSeg(te, 0, 0.18)) * (1 - oCub(bOut));
  const hw = rw / 2 + 14;
  const hh = rh / 2 + 14;
  const bx = hw + (bs - 1) * Math.min(hw, 184);
  const by = hh + (bs - 1) * Math.min(hh, 104);
  const arm = Math.max(10, Math.min(34, (rw + 28) / 3, (rh + 28) / 3));
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const px = cx + sx * bx;
    const py = cy + sy * by;
    return `M${u2(px)},${u2(py - sy * arm)} L${u2(px)},${u2(py)} L${u2(px - sx * arm)},${u2(py)}`;
  });
  // 淡染
  const tintOp = oCub(ucSeg(te, 0.3, 0.7)) * (1 - ucSeg(tx, 2.95, 3.2));
  // 接点 + 引线
  const dr = 7 * oBack(ucSeg(te, 0.18, 0.42)) * (1 - iCub(ucSeg(tx, 3.05, 3.25)));
  const lIn = oCub(ucSeg(te, 0.32, 0.62));
  const lOut = oCub(ucSeg(tx, 2.92, 3.1));
  const leadLen = UC_LEAD * lIn * (1 - lOut);
  const dirOut = fromLeft ? -1 : 1;
  // 标签:从引线一侧展开,收走时合回引线
  const pIn = oQuint(ucSeg(te, 0.5, 0.92));
  const pOut = iCub(ucSeg(tx, 2.82, 3.0));
  const open = pIn * (1 - pOut);
  const shut = u2((1 - open) * 100);
  const labelShift = -dirOut * (12 * (1 - pIn) + 10 * pOut);
  const kIn = oBack(ucSeg(te, 0.66, 0.98));
  const stepP = oCub(ucSeg(te, 0.74, 1.04));
  const tOut = ucSeg(tx, 2.8, 2.95);
  // 停留:高光沿框游走 + 呼吸环
  const live = ucSeg(te, 0.55, 0.8) * (1 - ucSeg(tx, 2.7, 2.9));
  const ph = (te - 0.55) / 1.4;
  const pt = te - 0.7;
  const pk = pt > 0 && tx < 2.85 ? (pt % 1.1) / 1.1 : -1;
  const pex = pk >= 0 ? 15.3 * oCub(pk) : 0; // 参考作品 340×180 圈:横向外扩约 15px、纵向约 14px
  const pey = pk >= 0 ? 14.4 * oCub(pk) : 0;

  // 逐字单元(多行时连续计数);字多时压缩间隔,整句约 0.45s 内浮完
  const unitLines = lines.map((l) => ucUnits(l, hl));
  const nUnits = unitLines.reduce((a, l) => a + l.length, 0);
  const cStep = nUnits > 1 ? Math.min(0.035, 0.45 / (nUnits - 1)) : 0;
  let ui = 0;

  const anchorFix: CSSProperties = {};
  const sub = 0.62;

  return (
    <div
      className="hud ucx hud-anchor hud-anchor--center"
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的收走动作负责
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1, ...anchorFix }}
    >
      <div style={{ position: "relative", width: bw, height: bh, flex: "none", visibility: t < DUR ? "visible" : "hidden" }}>
        <svg width={bw} height={bh} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
            </filter>
          </defs>
          {/* 呼吸扩散环 */}
          <rect
            x={u2(ringL - pex)} y={u2(ringT - pey)} width={u2(rw + 2 * pex)} height={u2(rh + 2 * pey)} rx={rr}
            fill="none" stroke={accHex} strokeWidth={2} opacity={pk >= 0 ? u3(0.55 * (1 - pk) * live) : 0}
          />
          {/* 底色淡染 */}
          <rect x={ringL} y={u2(ringT)} width={rw} height={rh} rx={rr} fill={ucRgba(acc, 0.07)} opacity={u3(tintOp)} />
          <g filter={`url(#${filterId})`}>
            {[paths.up, paths.dn].map((p, i) => (
              <path
                key={i} d={p} pathLength={1} fill="none" stroke={accHex} strokeWidth={3.5} strokeLinecap="round"
                strokeDasharray={`${u4(len)} 2`} opacity={len > 0.001 ? 1 : 0}
              />
            ))}
            {/* 四角锁定括号 */}
            <g fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={u3(bOp)}>
              {corners.map((p, i) => <path key={i} d={p} />)}
            </g>
            {/* 引线:从圈往外长,收走时缩回圈里 */}
            <line
              x1={ax} y1={midY} x2={u2(ax + dirOut * leadLen)} y2={midY}
              stroke={accHex} strokeWidth={3} strokeLinecap="round" opacity={leadLen > 0.5 ? 1 : 0}
            />
            <circle cx={ax} cy={midY} r={u2(Math.max(0, dr))} fill="#fff" stroke={accHex} strokeWidth={3.5} opacity={dr > 0.05 ? 1 : 0} />
          </g>
          {/* 沿框游走的高光 */}
          <path
            d={paths.comet} pathLength={1} fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"
            strokeDasharray="0.07 0.93" strokeDashoffset={u4(-ph)} opacity={u3(0.9 * live)}
          />
        </svg>
        {/* 标签 */}
        <div
          data-fx-role="group"
          data-small-text="label"
          style={{
            position: "absolute", left: u2(labelX), top: u2(labelY), width: LW, height: LH, boxSizing: "border-box",
            padding: `16px ${UC_PAD_X + (fromLeft ? 4 : 0)}px 0 ${UC_PAD_X + (fromLeft ? 0 : 4)}px`, borderRadius: 14,
            background: "rgba(12,16,28,0.88)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.08)",
            color: "#fff", fontFamily: UC_FONT, WebkitFontSmoothing: "antialiased", whiteSpace: "nowrap",
            clipPath: fromLeft ? `inset(0 0 0 ${shut}% round 14px)` : `inset(0 ${shut}% 0 0 round 14px)`,
            transform: `translateX(${u2(labelShift)}px)`,
            visibility: open > 0.001 ? "visible" : "hidden",
          }}
        >
          {/* 强调色条贴在引线那一侧 */}
          <div style={{ position: "absolute", [fromLeft ? "right" : "left"]: 0, top: 18, bottom: 18, width: 3, borderRadius: 2, background: accHex }} />
          <div style={{ filter: undefined }}>
            {kicker && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 26, marginBottom: 8 }}>
                <div
                  style={{
                    width: 26, height: 26, borderRadius: 13, background: accHex, color: badgeInk, flex: "none",
                    font: `700 16px/26px ${UC_FONT}`, textAlign: "center", transform: `scale(${u4(kIn)})`,
                  }}
                >
                  {step?.n}
                </div>
                <div
                  style={{
                    font: `600 18px/26px ${UC_MONO}`, letterSpacing: "0.14em", color: `rgba(255,255,255,${sub})`,
                    opacity: u3(stepP), transform: `translateX(${u2(8 * (1 - stepP))}px)`,
                  }}
                >
                  {kicker}
                </div>
              </div>
            )}
            {unitLines.map((line, li) => (
              <div key={li} style={{ font: `600 ${UC_MAIN_FS}px/${UC_MAIN_LH}px ${UC_FONT}`, letterSpacing: "0.02em" }}>
                {line.map((u, k) => {
                  const i = ui++;
                  const c = oCub(ucSeg(te, 0.72 + i * cStep, 1.08 + i * cStep));
                  return (
                    <span
                      key={k}
                      style={{
                        display: "inline-block", whiteSpace: "pre", color: u.hl ? hlColor : undefined,
                        opacity: u3(c * (1 - tOut)), transform: `translateY(${u2((1 - c) * 14)}px)`,
                      }}
                    >
                      {u.s}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


export const uiCalloutDef: EffectDef<UICalloutParams> = {
  id: "ui-callout",
  name: "UICallout",
  description: "界面标注 · 圈住区域 + 引线 + 标签",
  tags: ["生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    label: "圈出界面上的重点",
    ringW: 300,
    ringH: 170,
    side: "right",
    accent: "blue",
    stepTag: "auto",
    hlWords: "",
    offsetX: -300,
    offsetY: 0,
  },
  controls: [
    { key: "label", label: "标签文字", type: "text" },
    { key: "ringW", label: "圈宽", type: "range", min: 80, max: 800, step: 10, unit: "px" },
    { key: "ringH", label: "圈高", type: "range", min: 60, max: 600, step: 10, unit: "px" },
    {
      key: "side",
      label: "标签方向",
      type: "select",
      options: [
        { label: "圈右", value: "right" },
        { label: "圈左", value: "left" },
      ],
    },
    { key: "accent", label: "标注色", type: "select", options: ACCENT_OPTIONS },
    {
      key: "stepTag",
      label: "步骤眉标(精修版)（标签以 ①/1. 开头时生效）",
      type: "select",
      options: [
        { label: "自动(标签以①/1. 开头时显示)", value: "auto" },
        { label: "不显示", value: "off" },
      ],
    },
    { key: "hlWords", label: "高亮词,用|分隔,留空=自动高亮英文(精修版)", type: "text" },
    ...OFFSET_CONTROLS,
  ],
  Component: UICallout,
};
