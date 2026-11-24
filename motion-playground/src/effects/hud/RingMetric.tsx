import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  GLASS_DEFAULTS,
} from "./accent";

export interface RingMetricParams {
  theme: "dark" | "light";
  position: "left" | "right" | "center";
  kicker: string;
  value: number;
  max: number;
  decimals: number;
  unit: string;
  label: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}


/* ── 精修版:「刻度环占比板」,动法逐拍照搬隔离 Opus 的一次性作品(流浪对话 8%) ──
   深色圆角底板 + 100 格刻度环,前 value/max 格点亮成强调色;数字指数缓动计数,定格后光晕按 2.4s 呼吸,
   灰刻度上一道微光慢扫;分隔线划出 → 说明上浮 → 「· 标签」弹入;最后 0.5s 向外轻移、微缩、淡出。 */
const RP_W = 540; // 卡宽(参考作品)
const RP_H = 620; // 卡高(参考作品,眉题/说明各一行时)
const RP_C = 190;
const RP_IN = 150;
const RP_OUT = 172;
const RP_N = 100;
const RP_EXIT = 0.5;
const RP_NUM_FONT = '"SF Pro Display","Helvetica Neue","PingFang SC",sans-serif';

const rpClamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const rpProg = (t: number, s: number, d: number) => rpClamp((t - s) / d, 0, 1);
const rpOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const rpOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const rpInCubic = (x: number) => x * x * x;
const rpOutBack = (x: number) => {
  const c = 1.5;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
function rpArc(frac: number) {
  if (frac <= 0.0001) return "";
  const f = Math.min(frac, 0.9999);
  const r = (RP_IN + RP_OUT) / 2;
  const a0 = -Math.PI / 2;
  const a1 = a0 + f * Math.PI * 2;
  return `M${RP_C + Math.cos(a0) * r} ${RP_C + Math.sin(a0) * r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${RP_C + Math.cos(a1) * r} ${RP_C + Math.sin(a1) * r}`;
}
function rpRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rpRgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

/* 长内容排版:先换行(最多两行、从中间自然断开),两行还放不下再缩字号 */
const rpGlyph = (ch: string) => (/[⺀-￿]/.test(ch) ? 1 : /[A-Z]/.test(ch) ? 0.68 : ch === " " ? 0.3 : 0.56);
const rpTextW = (s: string, fs: number, ls: number) => Array.from(s).reduce((w, ch) => w + (rpGlyph(ch) + ls) * fs, 0);
const RP_HEAD_PUNCT = /^[,.;:!?，。、；：！？）)」』·]/;
function rpSplit2(s: string): [string, string] {
  const cs = Array.from(s);
  const total = cs.reduce((w, ch) => w + rpGlyph(ch), 0);
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
    acc += rpGlyph(ch);
  });
  if (bestSpace > 0) return [cs.slice(0, bestSpace).join(""), cs.slice(bestSpace + 1).join("")];
  cut = Math.max(1, Math.min(cs.length - 1, cut));
  // 不拆英文单词/数字、行首不放标点:往前挪到能断的地方
  while (cut > 1 && (/[A-Za-z0-9,.]/.test(cs[cut - 1]) && /[A-Za-z0-9,.]/.test(cs[cut]) || RP_HEAD_PUNCT.test(cs[cut]))) cut--;
  return [cs.slice(0, cut).join("").trimEnd(), cs.slice(cut).join("").trimStart()];
}
function rpGreedy(s: string, fs: number, ls: number, maxW: number): string[] {
  // 按「词」贪心折行:英文单词/数字整块不拆,中文逐字;行首不放标点
  const toks = s.match(/[A-Za-z0-9][A-Za-z0-9,.'&%-]*|\s+|./gu) ?? [];
  const lines: string[] = [];
  let cur = "";
  toks.forEach((tk) => {
    if (cur && rpTextW(cur + tk, fs, ls) > maxW && !RP_HEAD_PUNCT.test(tk)) {
      lines.push(cur.trimEnd());
      cur = /^\s+$/.test(tk) ? "" : tk;
    } else cur += tk;
  });
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}
function rpFit(s: string, maxW: number, base: number, oneLineMin: number, min: number, ls: number) {
  for (let fs = base; fs >= oneLineMin; fs--) if (rpTextW(s, fs, ls) <= maxW) return { fs, lines: [s] };
  if (Array.from(s).length >= 2) {
    const two = rpSplit2(s);
    for (let fs = base; fs >= min; fs--) if (Math.max(rpTextW(two[0], fs, ls), rpTextW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  }
  return { fs: min, lines: rpGreedy(s, min, ls, maxW) };
}
/** 每行在原文里的起点(按顺序找),用来给换行后的字继续按原文位置上色 */
function rpOffsets(src: string, lines: string[]) {
  let cur = 0;
  return lines.map((l) => {
    const i = src.indexOf(l, cur);
    const at = i < 0 ? cur : i;
    cur = at + l.length;
    return at;
  });
}

function RingMetricView({ params, t: tRaw }: { params: RingMetricParams; t: number }) {
  const { position, kicker, value, max, decimals, unit, label, accent } = params;
  const end = (params as { __end?: number }).__end;
  const dur = typeof end === "number" ? Math.max(0, end - ((params as { __start?: number }).__start ?? 0)) : Infinity;
  const t = Math.min(Math.max(0, tRaw), dur);
  const spd = usePlateSpeed(); // 动画速度(无卡点):动作用 ta = t*spd,退场仍对齐真实结束时刻
  const ta = t * spd;

  // 颜色:警示用参考作品的正红(主题 --hud-alert 偏粉);其它预设/自定义色照用,透明度在 JS 里算
  const accHex = accent === "alert" ? "#FF4A3D" : /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#5fa0fa";
  const acc = rpRgb(accHex);
  const accLite: [number, number, number] = accent === "alert" ? [255, 107, 94] : [0, 1, 2].map((i) => Math.round(acc[i] + (255 - acc[i]) * 0.15)) as [number, number, number];
  const ACC = rpRgba(acc, 1);
  const LITE = rpRgba(accLite, 1);

  const ratio = rpClamp(value / (max || 1), 0, 1);
  const fmt = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  // ── 版式 ──
  const kick = kicker ?? "";
  const kHeadLen = (() => {
    const i = kick.indexOf("·");
    return i > 0 ? kick.slice(0, i).trimEnd().length : 0;
  })();
  const kFit = rpFit(kick, RP_W - 88, 20, 18, 18, 0.18);
  const kOff = rpOffsets(kick, kFit.lines);
  const extraK = kick ? (kFit.lines.length - 1) * Math.round(kFit.fs * 1.4) : 0;

  const lab = label ?? "";
  const dotAt = lab.lastIndexOf("·");
  const tagRaw = dotAt > 0 ? lab.slice(dotAt + 1).trim() : "";
  const tag = tagRaw && Array.from(tagRaw).length <= 8 ? tagRaw : "";
  const main = tag ? lab.slice(0, dotAt).trim() : lab;
  const dimAt = main.indexOf("/") > 0 ? main.indexOf("/") : -1;
  const tagW = tag ? rpTextW(tag, 20, 0.08) + 24 + 14 : 0;
  const cFit = rpFit(main, RP_W - 88 - tagW, 28, 26, 22, 0);
  const cOff = rpOffsets(main, cFit.lines);
  const cLH = Math.round(cFit.fs * 1.3);
  const extraC = main ? Math.max(0, cFit.lines.length * cLH - 60) : 0;
  const H = RP_H + extraK + extraC;

  // 数字:按最终数值定字号,环内(内圈直径 264)放得下;计数过程中字号不跳
  const numEm = (s: string) => Array.from(s).reduce((w, ch) => w + (/[.,]/.test(ch) ? 0.3 : 0.6), 0);
  const fsNum = rpClamp(256 / (numEm(fmt(value)) - 0.03 * Array.from(fmt(value)).length + (unit ? rpTextW(unit, 0.5, 0) + 0.04 : 0)), 44, 104);
  // 单位保持原样大小写(km 不变 KM)
  const sub = max > 0 ? `OF ${max.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit ?? ""}` : "";

  // ── 安全区:人脸线 / 不出画;放不下先整体缩,再整体挪进安全带 ──
  // 人脸线只按默认大小(scale=1)、默认位置(offsetX=0)算:拉大就真的变大、拖开就锁住大小只平移;
  // 只有不出画(离画面边 48)按真实 scale / offsetX 算
  const s = Number((params as { scale?: number }).scale) || 1;
  const ox = params.offsetX ?? 0;
  const stageW = 1920;
  const pos = position === "left" || position === "right" ? position : "center";
  // 左锚点从左边缘缩放、右锚点从右边缘缩放(右缘固定在 stageW−120+x,往左长),居中从中心
  const centerX = (w: number, sc: number, x: number) =>
    pos === "left" ? 120 + x + (w * sc) / 2 : pos === "right" ? stageW - 120 + x - (w * sc) / 2 : stageW / 2 + x;
  let k = 1;
  // 横版居中也不许压脸:按默认落点归到左/右安全带(正中归左,照参考作品放左侧)
  const [lo, hi] = centerX(RP_W, 1, 0) <= 960 ? [48, 700] : [1220, 1872];
  k = Math.min(k, (hi - lo) / RP_W, (stageW - 96) / (RP_W * s));
  k = Math.min(k, ((1080) - 48) / (H * s)); // 竖直方向不出画(上下各留 24)
  const Wl = RP_W * k;
  const Hl = H * k;
  // 先按默认大小、默认位置挪进安全带,再按真实大小和位置防出画
  const cx0 = centerX(Wl, 1, 0);
  const dx0 = cx0 - Wl / 2 < lo ? lo - (cx0 - Wl / 2) : cx0 + Wl / 2 > hi ? hi - (cx0 + Wl / 2) : 0;
  const cx = centerX(Wl, s, ox) + dx0;
  const L = cx - (Wl * s) / 2;
  const R = cx + (Wl * s) / 2;
  const dx = dx0 + (L < 48 ? 48 - L : R > stageW - 48 ? stageW - 48 - R : 0);
  const outward = centerX(Wl, s, ox) + dx < stageW / 2 ? -1 : 1; // 进场从外侧滑入、退场往外侧收

  // ── 逐拍(照搬 renderAt) ──
  const out = Number.isFinite(dur) ? rpInCubic(rpProg(t, dur - 0.04 - RP_EXIT / spd, RP_EXIT / spd)) : 0;
  const pin = rpOutCubic(rpProg(ta, 0, 0.45));
  const cardOp = pin * (1 - out);
  const cardTx = outward * ((1 - pin) * 28 + out * 24);
  const cardSc = 0.97 + 0.03 * pin - out * 0.03;
  const edge = rpOutExpo(rpProg(ta, 0.1, 0.8));

  const pe = rpOutCubic(rpProg(ta, 0, 0.5));
  const pm = rpProg(ta, 0.2, 1.1);
  const v = rpOutExpo(pm);
  const nIn = rpOutBack(rpProg(ta, 0.2, 0.55));
  const numOp = rpProg(ta, 0.2, 0.3);
  const subOp = 0.9 * rpOutCubic(rpProg(ta, 0.5, 0.6));

  const settled = rpProg(ta, 1.3, 0.6);
  const breath = 0.5 + 0.5 * Math.sin(((ta - 1.3) * Math.PI * 2) / 2.4 - Math.PI / 2);
  const frac = ratio * v;
  const redN = Math.ceil(ratio * RP_N - 1e-6);
  const scanPos = (((ta - 1.6) / 4.0) % 1 + 1) % 1;

  const ticks = Array.from({ length: RP_N }, (_, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / RP_N) * Math.PI * 2;
    const r0 = i % 25 === 0 ? RP_IN - 6 : RP_IN;
    const p = (i + 0.5) / RP_N;
    const appear = rpOutCubic(rpProg(ta, 0.2 + p * 0.75, 0.25));
    let stroke = "#FFFFFF";
    let op: number;
    if (i < redN) {
      const lit = rpClamp(frac * RP_N - i, 0, 1);
      if (lit > 0) stroke = ACC;
      op = lit > 0 ? 0.4 + 0.6 * lit : appear * 0.2;
    } else {
      const base = i % 25 === 0 ? 0.42 : 0.2;
      let d = 0;
      if (ta > 1.6) {
        let dd = Math.abs(p - scanPos);
        dd = Math.min(dd, 1 - dd);
        d = Math.max(0, 1 - dd / 0.06) * settled;
      }
      op = appear * (base + 0.22 * d);
    }
    return (
      <line
        key={i}
        x1={RP_C + Math.cos(a) * r0} y1={RP_C + Math.sin(a) * r0}
        x2={RP_C + Math.cos(a) * RP_OUT} y2={RP_C + Math.sin(a) * RP_OUT}
        stroke={stroke} strokeWidth={i < redN ? 5 : 3} strokeLinecap="round" opacity={op.toFixed(3)}
      />
    );
  });

  // 光晕:参考作品 0.3s 处有个小红点瑕疵(滤镜区域按细弧的包围盒算,被切成一条扁红块;圆头还往 0 点之前漏)。
  // 这里滤镜区域改用整张环、平头,并且弧还短时按长度淡入
  const haloOp = rpProg(ta, 0.2, 0.3) * (0.28 + 0.22 * breath * settled + 0.12 * (1 - settled)) * rpClamp(frac * RP_N / 1.5, 0, 1);
  const a1 = -Math.PI / 2 + frac * Math.PI * 2;
  const nOp = rpProg(ta, 0.25, 0.2);
  const uid = `rmp${Math.round(value * 1000)}${accHex.slice(1)}`;

  const ruleK = rpOutExpo(rpProg(ta, 1.1, 0.7));
  const pa = rpOutCubic(rpProg(ta, 1.25, 0.5));
  const pb = rpOutBack(rpProg(ta, 1.5, 0.45));
  const tagOp = rpProg(ta, 1.5, 0.2);

  return (
    <div
      data-fx-role="group"
      className={`hud rmx hud-anchor hud-anchor--${position} is-in`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由下面照搬的位移+微缩+淡出负责
      // 右锚点从右边缘放大(右缘固定往左长);换卡居中时交给 CSS 的中心缩放
      style={{ ["--hud-acc" as string]: ACC, ...offsetVars(params), opacity: 1, ...(position === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? { transformOrigin: "100% 50%" } : null) }}
    >
      <div style={{ position: "relative", width: Wl, height: Hl, transform: dx ? `translateX(${(dx / s).toFixed(2)}px)` : undefined }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: RP_W, height: H,
            transformOrigin: "0 0", transform: k < 1 ? `scale(${k.toFixed(4)})` : undefined,
            fontFamily: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif', WebkitFontSmoothing: "antialiased",
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, transformOrigin: "50% 50%",
              opacity: cardOp.toFixed(4), filter: undefined,
              transform: `translateX(${cardTx.toFixed(2)}px) scale(${cardSc.toFixed(4)})`,
            }}
          >
            {/* 底板 */}
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 30, display: undefined,
                background: "linear-gradient(160deg, rgba(22,20,24,0.86), rgba(10,10,13,0.80))",
                boxShadow: "0 30px 80px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.07)",
              }}
            />
            {/* 左缘强调竖线:从上往下长 */}
            <div
              style={{
                position: "absolute", left: 0, top: 40, width: 3, height: H - 80, borderRadius: 2, background: ACC,
                transformOrigin: "50% 0", transform: `scaleY(${edge.toFixed(4)})`,
              }}
            />
            {/* 眉题:字距收紧落位;「·」前半段用强调色 */}
            {kick && (
              <div
                data-small-text="kicker"
                style={{
                  position: "absolute", left: 44, top: 40, fontSize: kFit.fs, fontWeight: 600, lineHeight: 1.4,
                  color: "rgba(255,255,255,0.62)", letterSpacing: `${(0.32 - 0.14 * pe).toFixed(3)}em`, whiteSpace: "nowrap", opacity: pe,
                }}
              >
                {kFit.lines.map((ln, li) => {
                  const at = kOff[li];
                  const headN = rpClamp(kHeadLen - at, 0, ln.length);
                  return (
                    <div key={li}>
                      {headN > 0 && <b style={{ color: LITE, fontWeight: 700 }}>{ln.slice(0, headN)}</b>}
                      {ln.slice(headN)}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ position: "absolute", left: 0, right: 0, top: extraK, height: 506 }}>
              {/* 刻度环 */}
              <svg viewBox="0 0 380 380" width={380} height={380} style={{ position: "absolute", left: "50%", top: 96, marginLeft: -190, overflow: "visible" }}>
                <defs>
                  <filter id={`${uid}g`} filterUnits="userSpaceOnUse" x={-40} y={-40} width={460} height={460}>
                    <feGaussianBlur stdDeviation="6" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {frac > 0.0001 && (
                  <path d={rpArc(frac)} fill="none" stroke={ACC} strokeWidth={34} strokeLinecap="butt" filter={`url(#${uid}g)`} opacity={haloOp.toFixed(3)} />
                )}
                <circle cx={RP_C} cy={RP_C} r={132} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} opacity={rpOutCubic(rpProg(ta, 0.25, 0.6)).toFixed(3)} />
                {ticks}
                {/* 边界指针 */}
                <line
                  x1={RP_C + Math.cos(a1) * (RP_IN - 14)} y1={RP_C + Math.sin(a1) * (RP_IN - 14)}
                  x2={RP_C + Math.cos(a1) * (RP_OUT + 10)} y2={RP_C + Math.sin(a1) * (RP_OUT + 10)}
                  stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={(0.85 * nOp).toFixed(3)}
                />
                <circle
                  cx={RP_C + Math.cos(a1) * (RP_OUT + 14)} cy={RP_C + Math.sin(a1) * (RP_OUT + 14)}
                  r={(3.5 + 1.5 * breath * settled).toFixed(2)} fill="#fff" opacity={nOp.toFixed(3)}
                />
              </svg>
              {/* 数字:从 0 指数缓动计数,弹起落位;定格后辉光随呼吸 */}
              <div
                data-fx-role="reading"
                style={{
                  position: "absolute", left: 0, right: 0, top: 222 + (104 - fsNum) * 0.5, textAlign: "center", color: "#fff", whiteSpace: "nowrap",
                  fontFamily: RP_NUM_FONT, fontWeight: 700, fontSize: fsNum, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums",
                  opacity: numOp, transform: `translateY(${((1 - nIn) * 18).toFixed(2)}px) scale(${(0.9 + 0.1 * nIn).toFixed(4)})`,
                }}
              >
                <span style={{ textShadow: `0 0 ${(24 * breath * settled).toFixed(1)}px ${rpRgba(acc, 0.35 * settled)}` }}>{fmt(value * v)}</span>
                {unit && <small style={{ fontSize: fsNum / 2, fontWeight: 600, marginLeft: 4, color: LITE, letterSpacing: 0 }}>{unit}</small>}
              </div>
              {sub && (
                <div style={{ position: "absolute", left: 0, right: 0, top: 344, textAlign: "center", fontSize: 18, fontWeight: 500, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", opacity: subOp.toFixed(3) }}>
                  {sub}
                </div>
              )}
            </div>
            {/* 分隔线 */}
            <div style={{ position: "absolute", left: 44, right: 44, top: 506 + extraK, height: 1, background: "rgba(255,255,255,0.10)", transformOrigin: "0 50%", transform: `scaleX(${ruleK.toFixed(4)})` }} />
            {/* 说明:上浮;「·」后的短标签弹入,描边随呼吸 */}
            {(main || tag) && (
              <div
                style={{
                  position: "absolute", left: 44, right: 44, top: 520 + extraK, height: 60 + extraC,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
                  fontSize: cFit.fs, fontWeight: 600, color: "rgba(255,255,255,0.92)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                }}
              >
                {main && (
                  <span data-small-text="label" style={{ display: "block", textAlign: "center", lineHeight: `${cLH}px`, opacity: pa, transform: `translateY(${((1 - pa) * 14).toFixed(2)}px)` }}>
                    {cFit.lines.map((ln, li) => {
                      const cut = dimAt < 0 ? ln.length : rpClamp(dimAt - cOff[li], 0, ln.length);
                      return (
                        <span key={li} style={{ display: "block" }}>
                          {ln.slice(0, cut)}
                          {cut < ln.length && <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>{ln.slice(cut)}</span>}
                        </span>
                      );
                    })}
                  </span>
                )}
                {tag && (
                  <span
                    style={{
                      fontSize: 20, fontWeight: 700, color: LITE, padding: "6px 12px", borderRadius: 8, background: rpRgba(acc, 0.14), letterSpacing: "0.08em",
                      boxShadow: `inset 0 0 0 1px ${rpRgba(acc, 0.3 + 0.25 * breath * settled)}`,
                      opacity: tagOp, transform: `scale(${(0.7 + 0.3 * pb).toFixed(4)})`,
                    }}
                  >
                    {tag}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RingMetric({ params, playToken }: EffectProps<RingMetricParams>) {
  const t = useCardElapsed(params as { __t?: number; __start?: number }, playToken);
  return <RingMetricView params={params} t={t} />;
}

export const ringMetricDef: EffectDef<RingMetricParams> = {
  id: "ring-metric",
  name: "RingMetric",
  description: "指标环 · 圆环进度 + 数字滚动",
  tags: ["滚动计数", "生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    kicker: "比例指标",
    value: 92.4,
    max: 100,
    decimals: 1,
    unit: "%",
    label: "圆环注水到这个比例",
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
        { label: "右侧", value: "right" },
        { label: "左侧", value: "left" },
        { label: "居中", value: "center" },
      ],
    },
    { key: "kicker", label: "小标签", type: "text" },
    { key: "value", label: "数值", type: "range", min: 0, max: 100, step: 0.1 },
    { key: "max", label: "满值(算比例)", type: "range", min: 1, max: 1000, step: 1 },
    { key: "decimals", label: "小数位", type: "range", min: 0, max: 2, step: 1 },
    { key: "unit", label: "单位", type: "text" },
    { key: "label", label: "说明文字", type: "text" },
    { key: "accent", label: "环色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: RingMetric,
};
