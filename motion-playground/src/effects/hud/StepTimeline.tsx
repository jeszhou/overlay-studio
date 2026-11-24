import type { CSSProperties } from "react";
import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import { ACCENT_OPTIONS, ACCENT_SWATCH, ACCENT_VAR, OFFSET_CONTROLS, OFFSET_DEFAULTS, offsetVars } from "./accent";

export interface StepTimelineParams {
  theme: "dark" | "light";
  position: "left" | "right";
  title: string; // 用 *...* 高亮关键词
  accent: string;
  steps: string; // 用 | 分隔各章节
  revealed: number; // 已讲到的章节数(其余留空)
  tagZh?: string; // 精修版:标题上方的眉标,后面自动跟「· 共 N 部分」;留空不显示
  nowZh?: string; // 精修版:当前章右侧的小药丸,留空不显示
  offsetX?: number;
  offsetY?: number;
}

/* ══════════ 精修版:逐拍照搬参考作品「章节大纲」 ══════════
 * 深色卡从顶部展开 → 眉标滑入 → 标题逐字升起、重点词由糊变清落地 + 暖光一闪 + 下划线扫出
 * → 分隔线 → 时间轴向下长出、章节依次弹入 → 焦点落到当前章(高亮条扫入、节点填色、声呐波纹、标签弹出)
 * → 未讲到的章节压暗;停留时整卡轻浮动、重点词呼吸微光;最后 0.5s 标题与章节上飘淡出、底板收回顶部 */
const STP_FONT = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';
const STP_MONO = '"SF Mono", Menlo, monospace';
const STP_EXIT = 0.5;
const STP_BASE_W = 500; // 参考作品卡宽;内容短时保持这个样子
const STP_FACE_W = 1920 - 120 - 1220; // 横版左右锚点:卡宽不越过人脸线(580)
const STP_MARGIN = 48; // 出画底线:离画面边 48
const STP_ROW_X = 24; // 章节行左右内缩
const STP_NAME_X = 112; // 章节名左缘(行内)

const stCl = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const stProg = (t: number, a: number, d: number) => stCl((t - a) / d);
const stOut = (p: number) => 1 - Math.pow(1 - p, 3);
const stIn = (p: number) => p * p * p;
const stBack = (p: number) => {
  const c = 1.6;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};
const stLerp = (a: number, b: number, p: number) => a + (b - a) * p;
const f2 = (x: number) => +x.toFixed(2);
const f3 = (x: number) => +x.toFixed(3);
const f4 = (x: number) => +x.toFixed(4);

type StRgb = [number, number, number];
function stAccent(accent: string): StRgb {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const stRgba = (c: StRgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* ── 排版:先换行(最多两行,自然断开)再缩字号,有字号下限 ── */
const stIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const stIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
const stEm = (c: string) => (stIsWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
const stLineW = (cs: string[], fs: number, ls: number) => cs.reduce((w, c) => w + stEm(c) * fs + ls, 0);
const stTrim = (cs: string[]) => {
  let a = 0;
  let b = cs.length;
  while (a < b && cs[a] === " ") a++;
  while (b > a && cs[b - 1] === " ") b--;
  return cs.slice(a, b);
};
const ST_PUNCT_HEAD = /[，。、！？：；·,.!?:;）)」』》]/;
/** 断成两行:不拆英文单词、行首不放标点、尽量不拆重点词,挑两行最均衡的位置 */
function stSplit2(cs: string[], hot?: boolean[]): [string[], string[]] | null {
  const w = cs.map(stEm);
  const total = w.reduce((a, b) => a + b, 0);
  let best: { at: number; cost: number } | null = null;
  let loose: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const a = cs[i - 1];
    const b = cs[i];
    const cost =
      Math.max(acc, total - acc) *
      (a === " " || b === " " || /[，。、！？：；·,.!?:;+《》]/.test(a) ? 0.9 : 1) *
      (/[的地得]/.test(a) ? 0.72 : /[也是就都才还和与]/.test(b) ? 0.8 : 1) *
      (hot && hot[i - 1] && hot[i] ? 1.6 : 1); // 重点词中间断开要罚
    if (!loose || cost < loose.cost) loose = { at: i, cost };
    if (stIsWord(a) && stIsWord(b)) continue;
    const nb = cs.slice(i).find((c) => c !== " ") ?? "";
    if (ST_PUNCT_HEAD.test(nb)) continue;
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  const pick = best ?? loose;
  return pick ? [stTrim(cs.slice(0, pick.at)), stTrim(cs.slice(pick.at))] : null;
}
/** 兜底:下限字号两行还放不下,按宽度贪心折多行(英文单词整个挪到下一行) */
function stGreedy(cs: string[], fs: number, ls: number, maxW: number) {
  const units: string[][] = [];
  cs.forEach((c, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && stIsWord(cs[i - 1]) && stIsWord(c)) last.push(c);
    else units.push([c]);
  });
  const lines: string[][] = [];
  let cur: string[] = [];
  units.forEach((u) => {
    if (cur.length && stLineW([...cur, ...u], fs, ls) > maxW && !ST_PUNCT_HEAD.test(u[0])) {
      lines.push(stTrim(cur));
      cur = u[0] === " " ? [] : [...u];
    } else cur.push(...u);
  });
  if (cur.length) lines.push(stTrim(cur));
  return lines.filter((l) => l.length);
}
/** 字号与断行:单行 oneMax→oneMin → 两行 twoMax→min → min 字号多行兜底 */
function stFit(cs0: string[], maxW: number, oneMax: number, oneMin: number, twoMax: number, min: number, ls: number, hot?: boolean[]) {
  const cs = stTrim(cs0);
  if (!cs.length) return { fs: oneMax, lines: [] as string[][] };
  for (let fs = oneMax; fs >= oneMin; fs--) if (stLineW(cs, fs, ls) <= maxW) return { fs, lines: [cs] };
  const two = cs.length >= 2 ? stSplit2(cs, hot && cs.length === cs0.length ? hot : undefined) : null;
  if (two) for (let fs = twoMax; fs >= min; fs--) if (Math.max(stLineW(two[0], fs, ls), stLineW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  return { fs: min, lines: stGreedy(cs, min, ls, maxW) };
}

function StepTimeline({ params, playToken }: EffectProps<StepTimelineParams>) {
  const { position, title, accent, steps, revealed } = params;
  const t0 = useCardElapsed(params as { __t?: number; __start?: number }, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const extra = params as { scale?: number; __scale?: number; __start?: number; __end?: number;  centerOnStage?: boolean };
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const DUR = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) * spd : Infinity; // 加速后的卡内时间轴上的结束点(对应真实结束时刻)
  const EXIT = DUR - STP_EXIT;
  const t = Math.max(0, Math.min(DUR, t0 * spd));
  const acc = stAccent(accent);
  const accHex = `#${acc.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  // 药丸字色:强调色够亮用深字(参考作品黄底深字),偏暗用白字
  const lum = (0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]) / 255;
  const pillInk = lum > 0.62 ? "#1a1408" : "#ffffff";

  // ── 内容 ──
  const tagT = String(params.tagZh ?? "").trim();
  const nowT = String(params.nowZh ?? "").trim();
  const labels = String(steps ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  const n = labels.length;
  const active = Math.min(Math.max(0, Math.round(Number(revealed) || 0)), n) - 1; // 当前章(-1 = 还没开讲)
  const plain: string[] = [];
  const hotOf: boolean[] = [];
  String(title ?? "").split(/(\*[^*]+\*)/).forEach((seg) => {
    const hot = seg.length > 2 && seg.startsWith("*") && seg.endsWith("*");
    Array.from(hot ? seg.slice(1, -1) : seg).forEach((c) => {
      plain.push(c);
      hotOf.push(hot);
    });
  });

  // ── 版面尺寸:躲脸约束只按默认大小、默认位置(scale=1、offset=0)算;不出画按真实 scale / offset 算 ──
  const s = Math.max(0.2, (Number(extra.scale) || 1) * (Number(extra.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const SW = 1920;
  const SH = 1080;
  const onStage = extra.centerOnStage === true; // 「换卡居中」交给 hud.css 的中心缩放
  const side = onStage ? "center" : position === "left" ? "left" : "right";
  // 右锚从右边缘缩放:右缘固定在 SW−120+ox,左缘 = 右缘 − W·s;左锚从左边缘缩放
  const frameW =
    side === "left" ? (SW - 120 - ox - STP_MARGIN) / s : side === "right" ? (SW - 120 + ox - STP_MARGIN) / s : (SW - 2 * STP_MARGIN - 2 * Math.abs(ox)) / s;
  const faceW = STP_FACE_W;
  const countT = n ? `· 共 ${n} 部分` : "";
  const tagW = tagT ? stLineW(Array.from(tagT), 21, 4) + 10 + stLineW(Array.from(countT), 21, 4) + 80 : 0;
  const pillW = (txt: string) => (txt ? stLineW(Array.from(txt), 19, 2) + 28 : 0);
  const nowW = pillW(nowT);
  const natW = Math.max(
    tagW,
    stLineW(plain, 46, 1) + 74 + 4,
    ...labels.map((l, i) => stLineW(Array.from(l), 34, 2) + STP_NAME_X + 18 + (i === active && nowW ? nowW + 30 : 0) + 2 * STP_ROW_X),
  );
  const W = Math.round(Math.max(360, Math.min(Math.max(STP_BASE_W, natW), faceW, frameW)));
  const RW = W - 2 * STP_ROW_X;

  const TF = stFit(plain, W - 74, 46, 46, 46, 44, 1, hotOf);
  const multi = TF.lines.length > 1;
  const titleLH = Math.round(TF.fs * (multi ? 1.42 : 1.2)); // 多行时加行距,给重点词下划线留位
  // 章节名:各行统一字号;当前章给右侧标签留位
  const NF = labels.map((l, i) => stFit(Array.from(l), RW - STP_NAME_X - 18 - (i === active && nowW ? nowW + 12 : 0), 34, 34, 32, 30, 2));
  const nameFs = NF.length ? Math.min(...NF.map((f) => f.fs)) : 34;
  const nameLH = Math.round(nameFs * 1.3);
  const rowHs = NF.map((f) => Math.max(72, f.lines.length * nameLH + 26));
  // 纵向:眉标 34 → 标题 72 → 下划线 → 分隔线 → 章节行(间距 2,参考 192/266/340)
  const titleTop = tagT ? 72 : 34;
  const titleBottom = titleTop + TF.lines.length * titleLH;
  const ruleTop = titleBottom + 39;
  const rowTops: number[] = [];
  let y = ruleTop + 26;
  rowHs.forEach((h) => {
    rowTops.push(y);
    y += h + 2;
  });
  const H = n ? y - 2 + 24 : ruleTop + 24;
  const trackTop = n ? rowTops[0] + rowHs[0] / 2 : 0;
  const trackH = n > 1 ? rowTops[n - 1] + rowHs[n - 1] / 2 - trackTop : 0;

  const frameH = (SH - 2 * STP_MARGIN - 2 * Math.abs(oy)) / s;
  const maxH = frameH;
  const fit = Math.min(1, maxH / H, frameW / W);
const anchorFix: CSSProperties = !onStage && side === "right" ? { transformOrigin: "100% 50%" } : {};
  const dirX = side === "left" ? -1 : 1; // 章节行从靠边那侧滑入、往那侧退

  // ── 动画(照搬 renderAt) ──
  const ex = stProg(t, EXIT, STP_EXIT);
  const exE = stIn(ex);
  // 底板:从顶部展开;退场收回顶部
  const pIn = stOut(stProg(t, 0, 0.55));
  const pOut = stIn(stProg(t, EXIT + 0.18, STP_EXIT - 0.18));
  const sy = stLerp(0.06, 1, pIn) * (1 - pOut * 0.94);
  const plateOp = Math.min(stProg(t, 0, 0.18), 1 - stProg(t, DUR - 0.12, 0.12));
  const fl = Math.sin(t * 1.4) * 2.5 * stProg(t, 0.6, 0.8); // 停留时整卡轻浮动
  // 顶部扫光:进场扫一次
  const g = stProg(t, 0.15, 0.95);
  const glintX = stLerp(20, W - 170, stOut(g));
  const glintOp = Math.sin(Math.PI * g) * (1 - ex);
  // 眉标
  const eb = stOut(stProg(t, 0.2, 0.4));
  const ebOp = eb * (1 - stOut(stProg(t, EXIT + 0.1, 0.25)));
  // 标题逐字:普通字从下升起(字多压缩间隔);重点词晚一拍由糊变清 + 回弹落地
  const nT = plain.length;
  const nHot = hotOf.filter(Boolean).length;
  const cStep = Math.min(0.045, 0.5 / Math.max(1, nT - 1));
  const hStep = Math.min(0.08, 0.4 / Math.max(1, nHot - 1));
  const xStep = Math.min(0.02, 0.15 / Math.max(1, nT - 1));
  const land = Math.exp(-Math.pow((t - 1.15) / 0.18, 2));
  const breathe = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin((t - 1.4) * 2.6));
  const glow = Math.max(land, breathe * stProg(t, 1.3, 0.5)) * (1 - ex);
  const ul = stOut(stProg(t, 1.0, 0.4));
  const ulOut = stProg(t, EXIT, 0.25);
  // 分隔线、时间轴
  const rl = stOut(stProg(t, 0.5, 0.6)) * (1 - exE);
  const tr = stOut(stProg(t, 1.2, 0.9)) * (1 - stOut(stProg(t, EXIT, 0.3)));
  // 章节依次弹入(参考 1.3 / 1.58 / 1.86,条多压缩间隔);全部到齐后焦点落到当前章
  const rStep = n > 1 ? Math.min(0.28, 1.2 / (n - 1)) : 0;
  const focusAt = Math.max(2.3, 1.3 + (n - 1) * rStep + 0.45);
  const activeP = active >= 0 ? stOut(stProg(t, focusAt, 0.5)) : 0;
  const oStep = n > 1 ? Math.min(0.06, 0.18 / (n - 1)) : 0;

  const abs = { position: "absolute" as const };
  const ink = (a: number) => `rgba(255,255,255,${a})`;
  const nodeFill = (p: number) =>
    `rgb(${Math.round(stLerp(25, acc[0], p))},${Math.round(stLerp(23, acc[1], p))},${Math.round(stLerp(29, acc[2], p))})`;
  let ci = 0;
  let hi = 0;

  return (
    <div
      className={`hud stx hud-anchor hud-anchor--${position}`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的收走动作负责
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1, ...anchorFix }}
    >
      {/* 外框按缩放后的版面占位,锚点不随动画漂 */}
      <div style={{ position: "relative", width: W * fit, height: H * fit, flex: "none" }}>
        <div style={{ ...abs, left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: fit < 1 ? `scale(${f4(fit)})` : undefined }}>
          <div
            data-fx-role="group"
            style={{
              ...abs, inset: 0, fontFamily: STP_FONT, WebkitFontSmoothing: "antialiased", color: "#fff",
              visibility: t < DUR ? "visible" : "hidden", transform: `translateY(${f2(fl)}px)`,
            }}
          >
            <div
                style={{
                  ...abs, inset: 0, borderRadius: 22, transformOrigin: "50% 0", transform: `scaleY(${f4(sy)})`, opacity: f3(plateOp),
                  background: "linear-gradient(160deg, rgba(30,27,34,0.90) 0%, rgba(16,15,20,0.86) 100%)",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)",
                }}
              />
            <div
                style={{
                  ...abs, left: f2(glintX), top: 0, width: 150, height: 2, borderRadius: 2, opacity: f3(glintOp),
                  background: `linear-gradient(90deg, ${stRgba(acc, 0)}, ${accHex} 40%, ${stRgba(acc, 0)})`,
                }}
              />
            <div style={{ ...abs, inset: 0, filter: undefined }}>
              {tagT && (
                <div
                  data-fx-role="label"
                  style={{
                    ...abs, left: 40, top: 34, maxWidth: W - 80, overflow: "hidden", fontSize: 21, lineHeight: "26px", letterSpacing: 4,
                    color: accHex, fontWeight: 600, whiteSpace: "nowrap", opacity: f3(ebOp), transform: `translateX(${f2(stLerp(-14, 0, eb))}px)`,
                  }}
                >
                  {tagT} <b style={{ color: ink(0.5), fontWeight: 500 }}>{countT}</b>
                </div>
              )}
              <div
                data-fx-role="warning"
                style={{ ...abs, left: 34, top: titleTop, fontSize: TF.fs, fontWeight: 700, letterSpacing: 1, lineHeight: `${titleLH}px`, whiteSpace: "pre" }}
              >
                {(() => {
                  let j = 0; // 按原字序把断行后的字对回「是不是重点词」
                  return TF.lines.map((line, r) => {
                    const groups: { hot: boolean; cs: { c: string; i: number; h: number }[] }[] = [];
                    line.forEach((c) => {
                      while (j < plain.length && plain[j] !== c) j++;
                      const hot = hotOf[j] ?? false;
                      const i = ci++;
                      const h = hot ? hi++ : -1;
                      j++;
                      const last = groups[groups.length - 1];
                      if (last && last.hot === hot) last.cs.push({ c, i, h });
                      else groups.push({ hot, cs: [{ c, i, h }] });
                    });
                    return (
                      <div key={r} style={{ height: titleLH }}>
                        {groups.map((gr, k) => {
                          const chars = gr.cs.map(({ c, i, h }) => {
                            const start = gr.hot ? 0.62 + h * hStep : 0.22 + i * cStep;
                            const len = gr.hot ? 0.5 : 0.38;
                            const p = stProg(t, start, len);
                            const e = gr.hot ? stBack(p) : stOut(p);
                            const outP = stOut(stProg(t, EXIT + i * xStep, 0.3));
                            const tf = gr.hot ? `translateY(${f2(stLerp(10, 0, e))}px) scale(${f4(stLerp(1.35, 1, e))})` : `translateY(${f2(stLerp(26, 0, e))}px)`;
                            const blur = gr.hot ? stLerp(12, 0, stOut(p)) : 0;
                            const op = (gr.hot ? stCl(p * 1.6) : p) * (1 - outP);
                            return (
                              <span
                                key={i}
                                style={{
                                  display: "inline-block", opacity: f3(op), transform: `${tf} translateY(${f2(-14 * outP)}px)`,
                                  filter: blur > 0.05 ? `blur(${f2(blur)}px)` : undefined,
                                  color: gr.hot ? accHex : undefined,
                                  textShadow: gr.hot ? `0 0 ${f2(8 + 18 * glow)}px ${stRgba(acc, f3(0.55 * glow))}` : undefined,
                                }}
                              >
                                {c}
                              </span>
                            );
                          });
                          if (!gr.hot) return <span key={k}>{chars}</span>;
                          return (
                            <span key={k} style={{ position: "relative", display: "inline-block" }}>
                              {/* 重点词下划线:扫出,退场时从左往右收走 */}
                              <i
                                style={{
                                  ...abs, left: 2, right: 2, bottom: multi ? -1 : -11, height: 6, borderRadius: 3, background: accHex, opacity: 0.9,
                                  transformOrigin: "0 50%", transform: `translateX(${f2(ulOut * 100)}%) scaleX(${f4(ul * (1 - ulOut))})`,
                                }}
                              />
                              {chars}
                            </span>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
              <div
                style={{
                  ...abs, left: 40, top: ruleTop, width: W - 80, height: 1, background: ink(0.14), transformOrigin: "0 50%", transform: `scaleX(${f4(rl)})`,
                }}
              />
              {n > 1 && (
                <div
                  style={{
                    ...abs, left: STP_ROW_X + 37 - 1, top: trackTop, width: 2, height: trackH, background: ink(0.18),
                    transformOrigin: "50% 0", transform: `scaleY(${f4(tr)})`,
                  }}
                />
              )}
              {NF.map((f, i) => {
                const st = 1.3 + i * rStep;
                const e = stOut(stProg(t, st, 0.45));
                const outP = stOut(stProg(t, EXIT + oStep * (n - 1 - i), 0.32));
                const nodePop = stBack(stProg(t, st - 0.05, 0.35));
                const rh = rowHs[i];
                const isAct = i === active;
                const isDone = i < active;
                // 当前章 / 已讲过:节点填色;未讲到:压暗
                const fillP = isAct || isDone ? activeP : 0;
                const dimP = active >= 0 && i > active ? activeP : 0;
                const nameA = isDone ? stLerp(1, 0.78, activeP) : stLerp(1, 0.42, dimP);
                const numC = isAct || isDone
                  ? stRgba(acc, f3(stLerp(0.45, isAct ? 1 : 0.75, activeP)))
                  : ink(f3(stLerp(0.45, 0.28, dimP)));
                const ph = t > focusAt + 0.3 ? ((t - focusAt - 0.3) / 1.3) % 1 : -1;
                const tg = stBack(stProg(t, focusAt + 0.3, 0.35));
                return (
                  <div
                    key={i}
                    data-fx-role="item"
                    style={{
                      ...abs, left: STP_ROW_X, top: rowTops[i], width: RW, height: rh, borderRadius: 14,
                      opacity: f3(e * (1 - outP)), transform: `translateX(${f2(dirX * (stLerp(30, 0, e) + 24 * outP))}px)`,
                    }}
                  >
                    {isAct && (
                      <div
                        style={{
                          ...abs, inset: 0, borderRadius: 14, transformOrigin: "0 50%", transform: `scaleX(${f4(activeP)})`, opacity: f3(activeP),
                          background: `linear-gradient(90deg, ${stRgba(acc, 0.22)}, ${stRgba(acc, 0.04)})`,
                        }}
                      />
                    )}
                    {isAct && ph >= 0 && (
                      <div
                        style={{
                          ...abs, left: 21, top: rh / 2 - 16, width: 32, height: 32, borderRadius: "50%", border: `2px solid ${accHex}`,
                          opacity: f3((1 - ph) * 0.9 * (1 - ex)), transform: `scale(${f4(stLerp(0.75, 1.45, stOut(ph)))})`,
                        }}
                      />
                    )}
                    <div
                      style={{
                        ...abs, left: 26, top: rh / 2 - 11, width: 22, height: 22, borderRadius: "50%", boxSizing: "border-box",
                        border: `2px solid ${fillP > 0.01 ? stRgba(acc, f3(stLerp(0.45, 1, fillP))) : ink(0.45)}`,
                        background: nodeFill(fillP), transform: `scale(${f4(nodePop)})`,
                      }}
                    />
                    <div
                      style={{
                        ...abs, left: 70, top: 0, height: rh, display: "flex", alignItems: "center", fontSize: 22, fontWeight: 600, letterSpacing: 1,
                        fontFamily: STP_MONO, color: numC,
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div
                      style={{
                        ...abs, left: STP_NAME_X, top: 0, height: rh, display: "flex", flexDirection: "column", justifyContent: "center",
                        fontSize: nameFs, lineHeight: `${nameLH}px`, fontWeight: 600, letterSpacing: 2, whiteSpace: "pre",
                        color: `rgba(255,255,255,${f3(nameA)})`,
                      }}
                    >
                      {f.lines.map((l, r) => (
                        <div key={r}>{l.join("")}</div>
                      ))}
                    </div>
                    {isAct && nowT && (
                      <div
                        style={{
                          ...abs, right: 18, top: rh / 2 - 16, height: 32, padding: "0 14px", borderRadius: 16, background: accHex, color: pillInk,
                          fontSize: 19, fontWeight: 700, lineHeight: "32px", letterSpacing: 2, whiteSpace: "nowrap", boxSizing: "border-box",
                          opacity: f3(stProg(t, focusAt + 0.3, 0.15)), transform: `scale(${f4(tg)})`, transformOrigin: "100% 50%",
                        }}
                      >
                        {nowT}
                      </div>
                    )}
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


export const stepTimelineDef: EffectDef<StepTimelineParams> = {
  id: "step-timeline",
  name: "StepTimeline",
  description: "步骤时间线卡 · 章节逐句冒出",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "light",
    position: "right",
    title: "《本期*章节*大纲》",
    accent: "blue",
    steps: "开场钩子|干货主体|结尾升华",
    revealed: 2,
    tagZh: "教程大纲",
    nowZh: "正在讲",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
      ],
    },
    { key: "title", label: "标题(*关键词*高亮)", type: "text" },
    {
      key: "accent",
      label: "标题强调色",
      type: "select",
      options: ACCENT_OPTIONS,
    },
    { key: "steps", label: "章节(用 | 分隔)", type: "text" },
    { key: "revealed", label: "已讲到第几章", type: "range", min: 0, max: 6, step: 1 },
    { key: "tagZh", label: "眉标小字(精修版,可空)", type: "text" },
    { key: "nowZh", label: "当前章标签(精修版,可空)", type: "text" },
    ...OFFSET_CONTROLS,
  ],
  Component: StepTimeline,
};
