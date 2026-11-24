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
  GLASS_DEFAULTS,
} from "./accent";

export interface RankBarsParams {
  theme: "dark" | "light";
  position: "left" | "right";
  title: string;
  rows: string; // "名称,数值|名称,数值"
  suffix: string;
  accent: string; // 第一名强调色
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}


/* ── 精修版「数据排名条」:动作逐拍照搬隔离 Opus 一次性作品 board.html 的 renderAt(t) ──
   深色圆角底板从左划开、左缘强调色竖线自上而下长出 → 标题圆点弹出、标题逐字浮起、细线展开 →
   各条依次从左滑入,条用阻尼弹簧长出(轻微过冲)、数字同步滚动 → 全部落定后第一名弹出「第一」角标、
   数字轻顿一下、暖光亮起;停留时第一名每 2.4 秒一道光泽扫过,暖光和标题圆点慢呼吸。
   有终点时最后 0.5 秒各条自下而上收回、底板向左收起。
   第一名 = rows 里数值最大的那条(并列取靠前的);名次号按数值排;条长按「最大值 = 96% 轨道」等比;
   4 条起整体收紧。全部画面是 t 的纯函数;只用行内样式,不依赖 hud.css */
const RB_FONT = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';
const RB_EXIT = 0.5; // 最后 0.5 秒收走
const RB_T_ROW0 = 0.55; // 第一条开始
const RB_BAR_DUR = 0.9;
const RB_SAFE = 0.96; // 字宽是估算的,留一点余量
const RB_FACE_W = 1920 - 120 - 1220; // 横版左右锚点:卡宽不越过人脸线(左锚右缘 ≤ x700 / 右锚左缘 ≥ x1220)
const RB_MARGIN = 48; // 出画底线:离画面边 48
const RB_BASE_W = 500; // 参考作品的底板宽
const RB_PL = 40;
const RB_PR = 36;
const RB_PT = 34;
const RB_LH = 1.4; // 行高统一 1.4,版面高度可算
const RB_BL = 1.07; // 行高 1.4 时基线约在 1.07em:同一行不同字号按基线对齐
const RB_TAG = "第一"; // 角标通用小字(不含话题)
const RB_TAG_W = 2 * 17 + 2 + 20 + 12; // 角标字宽 + 内边距 + 左间距

const rbCl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rbProg = (t: number, s: number, d: number) => rbCl((t - s) / d);
const rbEOut = (x: number) => 1 - Math.pow(1 - x, 3);
const rbEIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const rbEIn = (x: number) => x * x * x;
/** 阻尼弹簧:0→1,轻微过冲后稳定 */
const rbSpring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(x * 9.5));
const rf2 = (x: number) => +x.toFixed(2);
const rf4 = (x: number) => +x.toFixed(4);

/* ── 排版:先换行(最多两行,自然断开)再缩字号,有字号下限 ── */
const rbIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const rbIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
/** 估算字宽(em):全角 1,大写/数字 0.66,小写 0.56,空格 0.3,其余 0.4 */
const rbEm = (c: string) => (rbIsWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
const rbLineW = (cs: string[], fs: number, ls: number) => cs.reduce((w, c) => w + rbEm(c) * fs + ls, 0);
const rbTrim = (cs: string[]) => {
  let a = 0;
  let b = cs.length;
  while (a < b && cs[a] === " ") a++;
  while (b > a && cs[b - 1] === " ") b--;
  return cs.slice(a, b);
};
/** 断成两行:不拆英文单词、行首不放标点,挑两行最均衡的位置(空格、标点后优先) */
function rbSplit2(cs: string[]): [string[], string[]] | null {
  const w = cs.map(rbEm);
  const total = w.reduce((a, b) => a + b, 0);
  let best: { at: number; cost: number } | null = null;
  let loose: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const a = cs[i - 1];
    const b = cs[i];
    const cost = Math.max(acc, total - acc) * (a === " " || b === " " || /[，。、！？：；·,.!?:;]/.test(a) ? 0.9 : 1);
    if (!loose || cost < loose.cost) loose = { at: i, cost };
    if (rbIsWord(a) && rbIsWord(b)) continue;
    const nb = cs.slice(i).find((c) => c !== " ") ?? ""; // 行首(去掉空格后)不放标点
    if (/[，。、！？：；·,.!?:;）)」』》]/.test(nb)) continue;
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  const pick = best ?? loose;
  return pick ? [rbTrim(cs.slice(0, pick.at)), rbTrim(cs.slice(pick.at))] : null;
}
/** 兜底:下限字号两行还放不下,按宽度贪心折多行(英文单词整个挪到下一行,一行都放不下才硬拆) */
function rbGreedy(cs: string[], fs: number, ls: number, maxW: number) {
  const units: string[][] = [];
  cs.forEach((c, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && rbIsWord(cs[i - 1]) && rbIsWord(c)) last.push(c);
    else units.push([c]);
  });
  const lines: string[][] = [];
  let cur: string[] = [];
  units.forEach((u) => {
    if (cur.length && rbLineW([...cur, ...u], fs, ls) > maxW && (u.length > 1 ? rbLineW(u, fs, ls) <= maxW : true)) {
      lines.push(rbTrim(cur));
      cur = u[0] === " " ? [] : [...u];
    } else cur.push(...u);
  });
  if (cur.length) lines.push(rbTrim(cur));
  return lines.filter((l) => l.length);
}
/** 字号与断行:单行 oneMax→oneMin → 两行 twoMax→min → min 字号多行兜底 */
function rbFit(text: string, maxW: number, oneMax: number, oneMin: number, twoMax: number, min: number, ls: number) {
  const cs = rbTrim(Array.from(text));
  if (!cs.length) return { fs: oneMax, lines: [] as string[][] };
  for (let fs = oneMax; fs >= oneMin; fs--) if (rbLineW(cs, fs, ls) <= maxW) return { fs, lines: [cs] };
  const two = cs.length >= 2 ? rbSplit2(cs) : null;
  if (two) for (let fs = twoMax; fs >= min; fs--) if (Math.max(rbLineW(two[0], fs, ls), rbLineW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  return { fs: min, lines: rbGreedy(cs, min, ls, maxW) };
}

type RbRgb = [number, number, number];
const rbRgba = (c: RbRgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const rbMix = (a: RbRgb, b: RbRgb, k: number): RbRgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as RbRgb;
/** 第一名强调色 → 条的深浅两端 / 数字 / 暖光 / 角标字色。转变橙照参考作品的琥珀→橙红 */
function rbPalette(accent: string) {
  if (accent === "orange") return { deep: [255, 106, 61] as RbRgb, light: [255, 181, 71] as RbRgb, num: [255, 194, 102] as RbRgb, glow: [255, 140, 60] as RbRgb, ink: [26, 18, 6] as RbRgb };
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? ACCENT_SWATCH.blue;
  const n = parseInt(hex.slice(1), 16);
  const base: RbRgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return { deep: rbMix(base, [0, 0, 0], 0.08), light: rbMix(base, [255, 255, 255], 0.3), num: rbMix(base, [255, 255, 255], 0.42), glow: base, ink: rbMix(base, [0, 0, 0], 0.85) };
}

type RbRow = { name: string; value: number; dec: number; text: string };
/** 数值显示:保留原写法的小数位,千分位加逗号 */
const rbFmt = (v: number, dec: number) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function rbLayout(rows: RbRow[], title: string, suffix: string, lead: number, W: number, z: number) {
  const textW = W - RB_PL - RB_PR;
  // 标题小字:圆点 8 + 间距 12;右边细线至少留 40
  const kFit = title ? rbFit(title, (textW - 20 - 52) * RB_SAFE, 24, 22, 22, 18, 2) : null;
  const kH = kFit ? Math.max(8, kFit.lines.length * kFit.fs * RB_LH) : 0;
  const kBlock = kFit ? kH + 26 : 0;
  const rankW = 30 * z;
  const gap = 14 * z;
  const items = rows.map((r, i) => {
    const isLead = i === lead;
    const vf = isLead ? 52 * z : Math.max(30, 34 * z);
    const nf0 = isLead ? Math.max(30, 38 * z) : 30;
    const rfs = Math.max(18, 22 * z);
    const valW = rbLineW(Array.from(r.text), vf, -0.5) + (suffix ? 2 + rbLineW(Array.from(suffix), vf * 0.55, 0) : 0);
    const nameAvail = textW - rankW - 2 * gap - valW - (isLead ? RB_TAG_W : 0);
    const nFit = rbFit(r.name, nameAvail * RB_SAFE, nf0, isLead ? Math.max(30, Math.round(nf0 * 0.85)) : 30, isLead ? Math.max(30, Math.round(nf0 * 0.85)) : 30, 30, 0);
    const nf = nFit.fs;
    const nLines = Math.max(1, nFit.lines.length);
    const nameTop = Math.max(0, (vf - nf) * RB_BL);
    const valTop = Math.max(0, (nf - vf) * RB_BL);
    const headH = Math.max(valTop + vf * RB_LH, nameTop + nLines * nf * RB_LH);
    const trackH = (isLead ? 16 : 10) * z;
    const rowH = headH + 12 * z + trackH;
    return { isLead, vf, nFit, rfs, headH, trackH, rowH };
  });
  const rowGap = 22 * z;
  const H = Math.round(RB_PT * 2 + kBlock + items.reduce((a, it) => a + it.rowH, 0) + rowGap * Math.max(0, items.length - 1));
  return { textW, kFit, kH, kBlock, rankW, gap, items, rowGap, H };
}

function RankBars({ params, playToken }: EffectProps<RankBarsParams>) {
  const { position, title, rows, suffix, accent } = params;
  const t0 = useCardElapsed(params as RankBarsParams & { __start?: number; __t?: number }, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const extra = params as { scale?: number; __scale?: number; __start?: number; __end?: number; centerOnStage?: boolean };
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const DUR = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) : Infinity;
  // 卡内时间 t = 真实时间 × spd;结束时刻对应 DUR×spd,退场窗口 RB_EXIT 恰好在真实结束时刻前走完
  const OUT = DUR * spd - RB_EXIT;
  const t = Math.max(0, Math.min(DUR * spd, t0 * spd));
  const pal = rbPalette(accent);
  const unit = String(suffix ?? "");

  // 数据:「名称,数值」用 | 分隔(按最后一个逗号拆,名称里可以带逗号)
  const list: RbRow[] = String(rows ?? "")
    .split("|")
    .map((r) => {
      const at = Math.max(r.lastIndexOf(","), r.lastIndexOf("，"));
      const name = (at < 0 ? r : r.slice(0, at)).trim();
      const raw = at < 0 ? "" : r.slice(at + 1).trim();
      const num = Number(raw);
      const value = Number.isFinite(num) ? num : 0;
      const dec = Number.isFinite(num) && raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
      return { name, value, dec, text: rbFmt(value, dec) };
    })
    .filter((r) => r.name || r.value);
  if (!list.length) list.push({ name: "", value: 0, dec: 0, text: "0" });
  const n = list.length;
  const maxV = Math.max(...list.map((r) => r.value));
  const lead = list.findIndex((r) => r.value === maxV);
  const ranks = list.map((r) => 1 + list.filter((q) => q.value > r.value).length);
  const barMax = maxV > 0 ? maxV : 1;
  const z = n >= 5 ? 0.82 : n === 4 ? 0.92 : 1; // 条数多时整体收紧

  // ── 版面尺寸:躲脸约束只按默认大小、默认位置(scale=1、offset=0)算;不出画按真实 scale / offset 算 ──
  const s = Math.max(0.2, (Number(extra.scale) || 1) * (Number(extra.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const SW = 1920;
  const SH = 1080;
  const onStage = extra.centerOnStage === true; // 「换卡居中」交给 hud.css 的中心缩放
  const side = onStage ? "center" : position === "right" ? "right" : "left";
  const frameW =
    side === "left" ? (SW - RB_MARGIN - 120 - ox) / s : side === "right" ? (SW - 120 + ox - RB_MARGIN) / s : (SW - 2 * RB_MARGIN - 2 * Math.abs(ox)) / s;
  const faceW = onStage ? Infinity : RB_FACE_W;
  const maxW = Math.min(faceW, frameW, RB_FACE_W); // 版宽最多 580
  // 宽度跟着内容走:短内容保持参考作品的 500,名字长就往宽里让,到上限再换行/缩字
  const z0Lay = rbLayout(list, String(title ?? "").trim(), unit, lead, RB_BASE_W, z);
  const need = Math.max(
    0,
    ...list.map((r, i) => {
      const it = z0Lay.items[i];
      const valW = rbLineW(Array.from(r.text), it.vf, -0.5) + (unit ? 2 + rbLineW(Array.from(unit), it.vf * 0.55, 0) : 0);
      return RB_PL + RB_PR + z0Lay.rankW + 2 * z0Lay.gap + valW + (it.isLead ? RB_TAG_W : 0) + rbLineW(Array.from(r.name), it.isLead ? Math.max(30, 38 * z) : 30, 0) / RB_SAFE;
    }),
    title ? RB_PL + RB_PR + 72 + rbLineW(Array.from(String(title).trim()), 24, 2) / RB_SAFE : 0,
  );
  // 版宽不低于 420(再窄短名字也会被拆行);出画放不下时交给下面的 fit 整体缩小
  const W = Math.round(Math.max(420, Math.min(maxW, Math.max(RB_BASE_W, need))));
  const L = rbLayout(list, String(title ?? "").trim(), unit, lead, W, z);
  const H = L.H;
  // 高度上限:不出画按真实 scale
  const frameH = (SH - 2 * RB_MARGIN - 2 * Math.abs(oy)) / s;
  const fit = Math.min(1, frameH / H, frameW / W);
  const anchorFix: CSSProperties = onStage
    ? {}
    : side === "right"
      ? { transformOrigin: "100% 50%" } // 右锚从右边缘缩放:拉大只往左长
      : {};

  // ── 时间轴(照搬) ──
  const GAP = Math.min(0.32, 1.3 / n);
  const settle = RB_T_ROW0 + (n - 1) * GAP + RB_BAR_DUR + 0.15; // 所有条落定后再强调第一名
  const o = rbEIn(rbProg(t, OUT, 0.5));
  const pIn = rbEOut(rbProg(t, 0, 0.5));
  const clipR = Math.max((1 - pIn) * 100, o * 100);
  const plateOp = pIn * (1 - rbProg(t, OUT + 0.3, 0.2));
  const edgeK = rbEOut(rbProg(t, 0.15, 0.6));
  const dIn = rbSpring(rbProg(t, 0.12, 0.6));
  const dotOp = t < 1 ? 1 : 0.65 + 0.35 * (0.5 + 0.5 * Math.cos(t * 3.2));
  const ruleK = rbEIO(rbProg(t, 0.35, 0.8));
  const trackPx = W - RB_PL - RB_PR - 44 * z;
  const dim = (a: number) => `rgba(255,255,255,${a})`;

  const kFit = L.kFit;
  let ci = 0;

  return (
    <div
      className={`hud rbx hud-anchor hud-anchor--${position}`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的收走动作负责
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1, ...anchorFix }}
    >
      {/* 外框按缩放后的版面占位,锚点不随动画漂 */}
      <div style={{ position: "relative", width: W * fit, height: H * fit, flex: "none" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: fit < 1 ? `scale(${rf4(fit)})` : undefined }}>
          <div
            data-fx-role="group"
            style={{
              position: "absolute", inset: 0, boxSizing: "border-box", padding: `${RB_PT}px ${RB_PR}px ${RB_PT}px ${RB_PL}px`, borderRadius: 22,
              color: "#F4F1EC", fontFamily: RB_FONT, WebkitFontSmoothing: "antialiased",
              background: "linear-gradient(160deg, rgba(26,24,30,0.90), rgba(14,13,18,0.86))",
              boxShadow: "0 24px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
              opacity: rf4(plateOp),
              clipPath: clipR > 0.01 ? `inset(0 ${rf2(clipR)}% 0 0 round 22px)` : "none",
              transform: `translateX(${rf2((1 - pIn) * -24 - o * 30)}px)`,
            }}
          >
            {/* 左缘强调色竖线:识别标记 */}
            <div
              style={{
                position: "absolute", left: 0, top: 26, bottom: 26, width: 4, borderRadius: "0 3px 3px 0",
                background: `linear-gradient(180deg, ${rbRgba(pal.light, 1)}, ${rbRgba(pal.deep, 1)})`,
                transformOrigin: "50% 0", transform: `scaleY(${rf4(edgeK)})`,
              }}
            />
            <div style={{ position: "relative", filter: undefined }}>
              {kFit && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, height: L.kH, marginBottom: 26 }}>
                  <div
                    style={{
                      width: 8, height: 8, flex: "none", borderRadius: "50%", marginTop: (kFit.fs * RB_LH - 8) / 2,
                      background: rbRgba(pal.light, 1), boxShadow: `0 0 12px ${rbRgba(pal.light, 0.8)}`,
                      transform: `scale(${rf4(dIn)})`, opacity: rf4(dotOp),
                    }}
                  />
                  <div data-fx-role="label" style={{ flex: "none", fontSize: kFit.fs, lineHeight: RB_LH, fontWeight: 500, color: dim(0.72), letterSpacing: 2, whiteSpace: "nowrap" }}>
                    {kFit.lines.map((line, li) => (
                      <div key={li}>
                        {line.map((c, j) => {
                          const p = rbEOut(rbProg(t, 0.2 + ci++ * 0.025, 0.4));
                          return (
                            <span key={j} style={{ display: "inline-block", whiteSpace: "pre", opacity: rf4(p), transform: `translateY(${rf2((1 - p) * 10)}px)` }}>
                              {c}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      flex: 1, minWidth: 0, height: 1, marginTop: L.kH - (kFit.fs * RB_LH) / 2, background: dim(0.16),
                      transformOrigin: "0 50%", transform: `scaleX(${rf4(ruleK)})`,
                    }}
                  />
                </div>
              )}
              {list.map((r, i) => {
                const it = L.items[i];
                const st = RB_T_ROW0 + i * GAP;
                const ro = rbEIn(rbProg(t, OUT + (n - 1 - i) * 0.05, 0.3)); // 收走时从下往上
                const hp = rbEOut(rbProg(t, st, 0.45));
                const trOp = rbEOut(rbProg(t, st, 0.3)) * (1 - ro);
                const target = (Math.max(0, r.value) / barMax) * 0.96;
                const w = rbSpring(rbProg(t, st + 0.1, RB_BAR_DUR)) * target * (1 - ro);
                // 数字滚动(跟随条长但不过冲)
                const cp = rbEOut(rbProg(t, st + 0.1, RB_BAR_DUR * 0.85));
                // 第一名:角标弹出 / 数字轻顿 / 光泽扫过 / 暖光呼吸 / 名次号轻闪
                const tp = it.isLead ? rbSpring(rbProg(t, settle, 0.55)) : 0;
                const pulse = it.isLead ? Math.sin(Math.PI * rbProg(t, settle, 0.4)) : 0;
                const cyc = t < settle ? -1 : ((t - settle) % 2.4) / 1.1;
                const sx = it.isLead && cyc >= 0 && cyc <= 1 ? rbEIO(cyc) : -1;
                const hIn = rbEOut(rbProg(t, settle, 0.6));
                const haloOp = hIn * (0.75 + 0.25 * Math.cos((t - settle) * 2.2)) * (1 - ro);
                const rad = (it.isLead ? 9 : 6) * z;
                return (
                  <div key={i} style={{ position: "relative", height: it.rowH, marginTop: i > 0 ? L.rowGap : 0 }}>
                    {it.isLead && true && (
                      <div
                        style={{
                          position: "absolute", left: -16 * z, right: -14 * z, top: -12 * z, bottom: -14 * z, borderRadius: 14 * z, pointerEvents: "none",
                          background: `radial-gradient(120% 140% at 0% 50%, ${rbRgba(pal.glow, 0.2)}, ${rbRgba(pal.glow, 0)} 70%)`, opacity: rf4(haloOp),
                        }}
                      />
                    )}
                    <div
                      data-fx-role="reading"
                      style={{
                        position: "relative", display: "flex", alignItems: "baseline", gap: L.gap, height: it.headH,
                        opacity: rf4(hp * (1 - ro)), transform: `translateX(${rf2((1 - hp) * -28 + ro * -20)}px)`,
                      }}
                    >
                      <div
                        style={{
                          width: L.rankW, flex: "none", fontSize: it.rfs, lineHeight: RB_LH, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: it.isLead ? rbRgba(pal.light, 1) : dim(0.38), opacity: it.isLead ? rf4(0.75 + 0.25 * hIn) : undefined,
                        }}
                      >
                        {String(ranks[i]).padStart(2, "0")}
                      </div>
                      <div
                        data-fx-role="label"
                        style={{ flex: 1, minWidth: 0, fontSize: it.nFit.fs, lineHeight: RB_LH, fontWeight: 600, color: it.isLead ? "#FFFFFF" : "#F4F1EC", whiteSpace: "nowrap" }}
                      >
                        {(it.nFit.lines.length ? it.nFit.lines : [[]]).map((line, li, arr) => (
                          <div key={li} style={{ whiteSpace: "pre" }}>
                            {line.join("")}
                            {it.isLead && li === arr.length - 1 && (
                              <span
                                style={{
                                  display: "inline-block", marginLeft: 12, padding: "3px 10px 4px", borderRadius: 6, fontSize: 17, lineHeight: "normal",
                                  fontWeight: 700, letterSpacing: 1, color: rbRgba(pal.ink, 1), background: rbRgba(pal.light, 1), verticalAlign: 6,
                                  transformOrigin: "0 50%", transform: `scale(${rf4(tp)})`, opacity: rf4(rbCl(tp * 2) * (1 - ro)),
                                }}
                              >
                                {RB_TAG}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          flex: "none", fontSize: it.vf, lineHeight: RB_LH, fontWeight: 700, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums",
                          color: it.isLead ? rbRgba(pal.num, 1) : "#F4F1EC", whiteSpace: "nowrap",
                          transformOrigin: "100% 80%", transform: pulse > 0 ? `scale(${rf4(1 + 0.08 * pulse)})` : undefined,
                        }}
                      >
                        <b style={{ fontWeight: 700 }}>{rbFmt(r.value * cp, r.dec)}</b>
                        {unit && <small style={{ fontSize: "0.55em", fontWeight: 600, marginLeft: 2, opacity: 0.7 }}>{unit}</small>}
                      </div>
                    </div>
                    <div
                      style={{
                        position: "absolute", left: 44 * z, right: 0, top: it.headH + 12 * z, height: it.trackH, borderRadius: rad,
                        background: "rgba(255,255,255,0.08)", overflow: "hidden", opacity: rf4(trOp),
                      }}
                    >
                      <div
                        data-fx-role="bar"
                        style={{
                          position: "absolute", left: 0, top: 0, bottom: 0, width: `${rf2(w * 100)}%`, borderRadius: rad,
                          background: it.isLead ? `linear-gradient(90deg, ${rbRgba(pal.deep, 1)}, ${rbRgba(pal.light, 1)})` : "rgba(255,255,255,0.42)",
                        }}
                      />
                      {it.isLead && (
                        <div
                          style={{
                            position: "absolute", top: 0, bottom: 0, width: 90,
                            left: sx < 0 ? -200 : rf2(-90 + sx * (trackPx * w + 90)), opacity: sx < 0 ? 0 : rf4(0.55 * (1 - ro)),
                            background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.75), rgba(255,255,255,0))",
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export const rankBarsDef: EffectDef<RankBarsParams> = {
  id: "rank-bars",
  name: "RankBars",
  description: "数据排名条 · 条形生长 + 数值滚动",
  tags: ["生长描画", "滚动计数"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    title: "多项数据 · 对比排名",
    rows: "第一名,42|第二名,21|第三名,10",
    suffix: "%",
    accent: "blue",
    ...GLASS_DEFAULTS,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "title", label: "小标题", type: "text" },
    { key: "rows", label: "数据(名称,数值 用 | 分隔)", type: "text" },
    { key: "suffix", label: "后缀单位", type: "text" },
    { key: "accent", label: "第一名强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: RankBars,
};
