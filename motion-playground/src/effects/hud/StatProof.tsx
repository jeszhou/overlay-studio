import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
  GLASS_DEFAULTS,
} from "./accent";

export interface StatProofParams {
  theme: "dark" | "light";
  position: "left" | "right" | "center" | "top-left" | "top-right";
  /** 顶部 EN 等宽 kicker */
  kicker: string;
  /** kicker 的中文小注 */
  kickerZh: string;
  /** 目标数字(滚动计数到这里) */
  value: number;
  /** 数字后缀,如 "+" "%" */
  suffix: string;
  /** 数字前缀,如 "+" "¥" */
  prefix: string;
  /** 底部 EN 注脚 */
  footEn: string;
  /** 底部中文注脚(数字的出处) */
  footZh: string;
  /** 计数时长(卡点用) */
  countMs: number;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}


/* ════════ 精修版:照隔离 Opus「数字实证 · 3 个月」逐拍移植 ════════
   深色底板从左往右擦开、左侧强调竖条从上往下长、右侧两只 HUD 角标滑进;
   标签圆点弹出、字逐个上浮;大数字滚轮式计数(慢起-匀速-减速落定,速度越快越糊),
   落定那一下「顿一下」+ 暖光一闪,单位从下方弹入;刻度跟着数字一格格点亮;注脚擦出。
   停留:整卡微微呼吸、圆点像录制灯慢闪、一道光扫过刻度。退场:底板收回、左滑淡出。
   所有画面都是 t 的纯函数。
   尺寸:参考作品是在 scale=1.3 的这条真实 job 上做的(数字 206px、板 520×352),
   所以板内一律用参考像素(ref px)排,外面再乘 1/1.3 —— 卡片 scale=1.3 时与参考逐像素一致。 */
const SPX_REF_SCALE = 1.3;
const SPX_W0 = 520; // 参考板宽
const SPX_PAD_L = 44; // 内容左边距
const SPX_PAD_R = 36;
const SPX_F0 = 206; // 参考数字字号
const SPX_FMIN = 96; // 数字字号下限(大字)
const SPX_U0 = 62; // 参考单位字号
const SPX_FOOT0 = 24; // 参考注脚字号
const SPX_SMALL_MIN = 18; // 小字下限
const SPX_MONO = '"SF Mono", Menlo, "PingFang SC", monospace';
const SPX_NUM_FONT = '"SF Pro Display", "Helvetica Neue", "PingFang SC", sans-serif';
const SPX_OUT = 0.3; // 退场时长(参考 4.0→4.3)

/* 工具函数:参考作品原样 */
const spxClamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const spxProg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : spxClamp((t - a) / (b - a))); // 先比端点:退场时刻为 Infinity(没有 __end)时不出 NaN
const spxLerp = (a: number, b: number, p: number) => a + (b - a) * p;
const spxOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const spxOutExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const spxInCubic = (p: number) => p * p * p;
const spxInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** 阻尼弹簧:0→1,带一点过冲 */
const spxSpring = (p: number, k = 7, z = 0.42) => {
  if (p <= 0) return 0;
  const s = p * k;
  return 1 - Math.exp(-z * s * 2.2) * Math.cos(s * 2.4);
};

/**
 * 刻度规则(数值 + 单位 → 几根刻度):一根刻度 = 比单位细一级的「一份」,观众数得出来这是多少。
 *  1. 认得的单位先换算成细一级:年→12 个月、个月/月→30 天、周→7 天、小时→60 分钟、分钟→60 秒;
 *     天/秒 本身就是一份。每满一个大单位立一根高刻度(参考作品:3 个月 = 90 根,每 30 天一根高的)。
 *  2. 百分比(≤100%):固定 100 格、每格 1%,点亮到数值那格为止(85% 亮 85 格),每 10% 一根高刻度。
 *  3. 换算后超过 120 根、换算不成整数、或单位不认得:按数值本身,一根 = 1;
 *     不到 12 根或带小数时细分成十分之一(3.5 倍 = 35 根,每整 1 一根高刻度)。
 *  4. 还是超过 120 根(如 128,000):不画刻度,只画一条比例条,随数字从 0 填满。
 * per = 数值每 1 对应几根(点亮根数 = 当前数值 × per);major = 每几根一根高刻度(0 = 只有第一根)
 */
type SpxTicks = { kind: "ticks"; n: number; per: number; major: number } | { kind: "bar" };
const SPX_UNITS: [RegExp, number][] = [
  [/^(年|years?|yrs?)$/, 12],
  [/^(个?月|months?|mos?)$/, 30],
  [/^(周|星期|个?礼拜|weeks?|wks?)$/, 7],
  [/^(天|日|days?)$/, 1],
  [/^(个?小时|h|hrs?|hours?)$/, 60],
  [/^(分钟?|mins?|minutes?)$/, 60],
  [/^(秒|s|secs?|seconds?)$/, 1],
];
function spxTickPlan(value: number, suffix: string): SpxTicks {
  if (!(value > 0)) return { kind: "bar" };
  const u = suffix.replace(/[\s+＋~～]/g, "").toLowerCase();
  const isInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;
  if (/^[%％]$/.test(u) && value <= 100) return { kind: "ticks", n: 100, per: 1, major: 10 };
  const f = SPX_UNITS.find(([re]) => re.test(u))?.[1];
  if (f && isInt(value * f) && value * f <= 120 && value * f >= 1) {
    const n = Math.round(value * f);
    return { kind: "ticks", n, per: f, major: f > 1 ? f : n >= 20 ? 10 : 0 };
  }
  if (isInt(value) && value >= 12 && value <= 120) return { kind: "ticks", n: Math.round(value), per: 1, major: 10 };
  if (Math.round(value * 10) <= 120 && Math.round(value * 10) >= 1) return { kind: "ticks", n: Math.round(value * 10), per: 10, major: 10 };
  return { kind: "bar" };
}

/* ── 排版估算(ref px) ── */
const spxGlyph = (ch: string, mono: boolean) =>
  /[⺀-￿]/.test(ch) ? 1 : mono ? 0.6 : /[A-Z0-9%]/.test(ch) ? 0.66 : ch === " " ? 0.3 : 0.56;
const spxTextW = (s: string, fs: number, ls: number, mono = false) =>
  Array.from(s).reduce((w, ch) => w + (spxGlyph(ch, mono) + ls) * fs, 0);
const spxIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
type SpxChar = { ch: string; hot: boolean };
/** 断成两行:最均衡处断;不拆英文单词、标点不放行首、尽量不拆强调段;在空格处断就丢掉空格 */
function spxSplit2(cs: SpxChar[], ls: number, mono: boolean): [SpxChar[], SpxChar[]] | null {
  const str = (a: SpxChar[]) => a.map((c) => c.ch).join("");
  let best: { at: number; cost: number } | null = null;
  for (let i = 1; i < cs.length; i++) {
    if (spxIsWord(cs[i - 1].ch) && spxIsWord(cs[i].ch)) continue;
    if (/[，。、！？：；,.!?:;）)」』》·]/.test(cs[i].ch)) continue;
    const a = cs.slice(0, i);
    const b = cs.slice(cs[i].ch === " " ? i + 1 : i);
    const m = Math.max(spxTextW(str(a).trimEnd(), 1, ls, mono), spxTextW(str(b), 1, ls, mono));
    const cost = m * (cs[i - 1].hot && cs[i].hot ? 1.25 : 1);
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  if (!best) return null;
  const a = cs.slice(0, best.at);
  while (a.length && a[a.length - 1].ch === " ") a.pop();
  return [a, cs.slice(cs[best.at].ch === " " ? best.at + 1 : best.at)];
}
/** 先单行原字号 → 两行(从原字号往下缩) → 下限字号两行(还宽就随它,已经是下限) */
function spxFit(cs: SpxChar[], maxW: number, base: number, min: number, ls: number, mono = false) {
  const w = (a: SpxChar[], fs: number) => spxTextW(a.map((c) => c.ch).join(""), fs, ls, mono);
  if (w(cs, base) <= maxW) return { fs: base, lines: [cs] };
  for (let fs = base; fs > min && fs >= base * 0.92; fs--) if (w(cs, fs) <= maxW) return { fs, lines: [cs] };
  const two = spxSplit2(cs, ls, mono);
  if (!two) {
    for (let fs = base; fs >= min; fs--) if (w(cs, fs) <= maxW) return { fs, lines: [cs] };
    return { fs: min, lines: [cs] };
  }
  for (let fs = base; fs >= min; fs--) if (Math.max(w(two[0], fs), w(two[1], fs)) <= maxW) return { fs, lines: two };
  return { fs: min, lines: two };
}
/** 注脚强调段:写了 *词* 就照写的;没写就取最后一个「的」后面那段(参考:手搓的「视频动效编辑台」) */
function spxFootChars(s: string): SpxChar[] {
  if (/\*[^*]+\*/.test(s)) {
    const out: SpxChar[] = [];
    let hot = false;
    for (const ch of Array.from(s)) {
      if (ch === "*") hot = !hot;
      else out.push({ ch, hot });
    }
    return out;
  }
  const cs = Array.from(s);
  const at = s.lastIndexOf("的");
  const tail = at >= 0 ? Array.from(s.slice(at + 1)).length : 0;
  const cut = at >= 1 && tail >= 2 && tail <= 12 ? cs.length - tail : cs.length;
  return cs.map((ch, i) => ({ ch, hot: i >= cut }));
}

/** 卡片 CSS 宽上限(锚点缩放前):横版不越过人脸线(左锚右缘 ≤ x700、右锚左缘 ≥ x1220),
        按锚点的缩放原点把 scale / offsetX 一起算进去。
    横版人脸线只按默认位置(offsetX=0)算:手动拖开后卡宽锁住只平移,拖动后只防出画(离画面边 48) */
function spxMaxW(position: string, s: number, ox: number) {
  const SW = 1920;
  const M = 48;
  const left = position === "left" || position === "top-left";
  if (!left && position !== "right" && position !== "top-right") {
    // 居中:整张不出画,左右各留 48
    return (SW - 2 * M - 2 * Math.abs(ox)) / s;
  }
  // 人脸线只按默认大小(scale=1)算:用户拉大就真的变大,只防出画(真实 scale / offset)
  return Math.min(spxWidthWithin(SW, left, 1, 0, 1220), spxWidthWithin(SW, left, s, ox, M));
}

/** 卡的远端边不越过离画面边 limit 的那条线时,允许的最大宽 */
function spxWidthWithin(SW: number, left: boolean, s: number, ox: number, limit: number) {
  const E = 120; // 锚点离边
  if (left) {
    // transform-origin 在左边:右缘 = 120 + ox + W·s
    return (SW - limit - E - ox) / s;
  }
  // 新动效右锚点 transform-origin 在右边:右缘固定 = SW−120+ox,左缘 = 右缘 − W·s
  return (SW - E + ox - limit) / s;
}

function StatProof({ params, playToken }: EffectProps<StatProofParams>) {
  const { position, kicker, kickerZh, prefix, footEn, footZh, accent } = params;
  const t = useCardElapsed(params as unknown as { __t?: number; __start?: number }, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const tl = t * spd;
  const ext = params as unknown as { __start?: number; __end?: number; scale?: number; __scale?: number };
  const END = typeof ext.__end === "number" ? ext.__end - (ext.__start ?? 0) : Infinity;
  const acc = ACCENT_VAR[accent] ?? ACCENT_VAR.orange;

  // ── 数字:兼容文本输入("128,000" / "3.5");小数位照原卡(整数 0 位,否则 1 位) ──
  const target = Number(String(params.value ?? "").replace(/[,，\s]/g, "")) || 0;
  const neg = target < 0;
  const absT = Math.abs(target);
  const decimals = Number.isInteger(absT) ? 0 : 1;
  const finalStr = absT.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const intLen = finalStr.split(".")[0].replace(/,/g, "").length;
  // 每个字形:数字列(place = 10 的几次方)或静态分隔符(逗号 / 小数点,place 跟左边那列)
  const glyphs: { d: boolean; ch: string; place: number }[] = [];
  {
    let seen = 0;
    let frac = 0;
    let afterDot = false;
    for (const ch of finalStr) {
      if (ch === ".") {
        afterDot = true;
        glyphs.push({ d: false, ch, place: 0 });
      } else if (ch === ",") glyphs.push({ d: false, ch, place: intLen - seen });
      else if (afterDot) glyphs.push({ d: true, ch, place: -++frac });
      else glyphs.push({ d: true, ch, place: intLen - 1 - seen++ });
    }
  }
  const lowPlace = -decimals;
  const unit = (params.suffix ?? "").trim();
  const pre = (neg ? "−" : "") + (prefix ?? "").trim();

  // ── 时间线(秒):计数 C0→C1,时长 = countMs(参考 0.35→2.05,1.7s);停留期各拍跟着落定时刻 C1 平移 ──
  const C0 = 0.35;
  const C1 = C0 + Math.max(0.4, (Number(params.countMs) || 1700) / 1000);
  const dT = C1 - 2.05;
  const tc = C1 + (t - C1) * spd; // 落定动作的时间(以落定时刻 C1 为锚;落定前的预备也一起压缩)
  const countValue = (x: number) => {
    const p = spxProg(x, C0, C1);
    return absT * (0.6 * spxInOutCubic(p) + 0.4 * spxOutCubic(p));
  };

  // ── 安全区排版(ref px) ──
  const s = Math.max(0.2, (Number(ext.scale) || 1) * (Number(ext.__scale) || 1));
  // 右上 / 右下角标外凸 10px,一起算进安全区
  const Wmax = spxMaxW(position, s, params.offsetX ?? 0) * SPX_REF_SCALE - 12;
  const labelText = [kicker, kickerZh].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
  const labelCs: SpxChar[] = Array.from(labelText).map((ch) => ({ ch, hot: false }));
  const footCs = spxFootChars((footZh ?? "").trim());
  const footEnCs: SpxChar[] = Array.from((footEn ?? "").trim()).map((ch) => ({ ch, hot: false }));
  const nDig = glyphs.filter((g) => g.d).length;
  const nSep = glyphs.length - nDig;
  const numRowW = (F: number, U: number) =>
    (pre ? spxTextW(pre, U, 0) + 8 : 0) + nDig * F * (118 / 206) + nSep * F * 0.3 + (unit ? (/^[%％+＋]/.test(unit) ? 4 : 14) + spxTextW(unit, U, 0) : 0) - 6;
  const uOf = (F: number) => Math.max(36, Math.round(F * (SPX_U0 / SPX_F0)));
  const need = Math.max(
    labelCs.length ? 20 + spxTextW(labelText, 19, 0.16, true) : 0,
    numRowW(SPX_F0, SPX_U0),
    spxTextW(footCs.map((c) => c.ch).join(""), SPX_FOOT0, 0.04),
    spxTextW((footEn ?? "").trim(), SPX_SMALL_MIN, 0.12, true),
  );
  const W = Math.ceil(Wmax < SPX_W0 ? Math.max(360, Wmax) : spxClamp(need + SPX_PAD_L + SPX_PAD_R, SPX_W0, Wmax));
  const CW = W - SPX_PAD_L - SPX_PAD_R; // 内容宽(参考 440)
  // 数字:放不下先缩数字(单位跟着按比例,不小于 36),到下限再把单位压到 30
  let F = SPX_F0;
  while (F > SPX_FMIN && numRowW(F, uOf(F)) > CW) F -= 2;
  let U = uOf(F);
  while (U > 30 && numRowW(F, U) > CW) U -= 1;
  const cw = F * (118 / 206); // 数字列宽(参考 118)
  const sepW = F * 0.3;
  const numH = F * (190 / 206); // 数字行高(参考 190)
  const unitMB = F * (30 / 206);
  // 标签:一行放不下时,有英文 kicker + 中文小注就在两者之间断(去掉中间的「·」),否则按通用规则断
  const kParts = [kicker, kickerZh].map((x) => (x ?? "").trim()).filter(Boolean);
  const labelFit = (() => {
    const maxW = CW - 20 + 1;
    const one = spxFit(labelCs, maxW, 19, 19, 0.16, true);
    if (one.lines.length === 1 && spxTextW(labelText, 19, 0.16, true) <= maxW) return one;
    const fitsAll = (f: { fs: number; lines: SpxChar[][] }) =>
      f.lines.every((l) => spxTextW(l.map((c) => c.ch).join(""), f.fs, 0.16, true) <= maxW);
    if (kParts.length === 2) {
      const a = Array.from(kParts[0]).map((ch) => ({ ch, hot: false }));
      const b = Array.from(kParts[1]).map((ch) => ({ ch, hot: false }));
      let fs = 19;
      while (fs > SPX_SMALL_MIN && Math.max(spxTextW(kParts[0], fs, 0.16, true), spxTextW(kParts[1], fs, 0.16, true)) > maxW) fs--;
      if (fitsAll({ fs, lines: [a, b] })) return { fs, lines: [a, b] };
    }
    const two = spxFit(labelCs, maxW, 19, SPX_SMALL_MIN, 0.16, true);
    if (fitsAll(two)) return two;
    // 字号到下限两行还放不下(很长的英文 kicker):按词贪心折成多行,宁可多一行也不出板
    const lines: SpxChar[][] = [];
    let cur: SpxChar[] = [];
    (labelText.match(/[A-Za-z0-9'’-]+ ?|./gu) ?? []).forEach((word) => {
      const wc = Array.from(word).map((ch) => ({ ch, hot: false }));
      const tryW = spxTextW((cur.map((c) => c.ch).join("") + word).trimEnd(), SPX_SMALL_MIN, 0.16, true);
      if (cur.length && tryW > maxW) {
        lines.push(cur);
        cur = wc;
      } else cur = cur.concat(wc);
    });
    if (cur.length) lines.push(cur);
    return { fs: SPX_SMALL_MIN, lines: lines.map((l) => { const c = l.slice(); while (c.length && c[c.length - 1].ch === " ") c.pop(); return c; }) };
  })();
  const label = labelFit;
  const foot = spxFit(footCs, CW, SPX_FOOT0, SPX_SMALL_MIN, 0.04);
  const footE = spxFit(footEnCs, CW, SPX_SMALL_MIN, SPX_SMALL_MIN, 0.12, true);

  // 纵向:标签 → 数字 → 刻度 → (英文注脚) → 中文注脚
  const labelH = labelCs.length ? 22 + (label.lines.length - 1) * 26 : 0;
  const numTop = labelCs.length ? labelH + 14 : 0; // 参考 36
  const ticksTop = numTop + numH + 18; // 参考 244
  let y = ticksTop + 22 + 16; // 参考注脚 282
  const footEnTop = y;
  if (footEnCs.length) y += footE.lines.length * footE.fs * 1.3 + 6;
    const footLH = foot.fs * 1.4;
  if (footCs.length) y += foot.lines.length * footLH;
  const hasFoot = footCs.length + footEnCs.length > 0;
  // 卡高:有注脚 = 注脚底 + 2(参考 282 + 34 → 352);没注脚 = 刻度底 + 30
  const H = Math.round(34 + (hasFoot ? y + 2 : ticksTop + 22 + 30));
  const TW = CW; // 刻度宽(参考 440)

  // ── 进场 / 退场(参考原样) ──
  const pIn = spxOutExpo(spxProg(tl, 0, 0.55));
  const pOut = Number.isFinite(END) ? spxInCubic(spxProg(t, END - SPX_OUT / spd, END)) : 0;
  const wipe = pIn * (1 - pOut);
  const railS = spxOutCubic(spxProg(tl, 0, 0.4)) * (1 - pOut);
  const dx = spxLerp(-28, 0, spxOutCubic(spxProg(tl, 0, 0.6))) - 46 * pOut;
  // 停留期微呼吸,让画面不死
  const drift = Math.sin(t * spd * 1.6) * 1.2 * spxProg(tc, 2.2 + dT, 2.8 + dT);
  // 角标
  const pc = spxOutCubic(spxProg(tl, 0.35, 0.75));
  // 标签:圆点先弹出,停留期像录制灯慢闪
  const pd = spxSpring(spxProg(tl, 0.12, 0.7));
  const dotA = tc > 2.3 + dT ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos((tc - 2.3 - dT) * 4.2)) : 1;

  // 数字:滚轮式计数;速度 → 运动模糊;落定「顿一下」;暖光一闪
  const v = countValue(t);
  const appear = spxOutCubic(spxProg(tl, 0.2, 0.5));
  const dv = (countValue(t + 0.01) - countValue(t - 0.01)) / 0.02; // 每秒走多少(数值单位)
  const land = spxProg(tc, C1 - 0.25, C1 + 0.45);
  const thud = land > 0 ? Math.sin(land * Math.PI) * Math.exp(-land * 2) * 0.07 : 0;
  const g = spxProg(tc, C1 - 0.35, C1 + 1.0);
  const glowA = g > 0 ? Math.sin(Math.min(g * 2.2, 1) * (Math.PI / 2)) * (1 - g * 0.55) : 0;
  // 列位置(单位:格):最低一列连续滚;高位列像里程表,只在低位整体 9→0 进位那一下跟着转
  const lowUnits = v * Math.pow(10, -lowPlace);
  const colPos = (place: number) => {
    if (place === lowPlace) return lowUnits % 10;
    const span = Math.pow(10, place - lowPlace);
    const carry = Math.max(0, (lowUnits % span) - (span - 1));
    return (Math.floor(lowUnits / span) % 10) + carry;
  };
  // 高位还没轮到的列(前导 0)压暗,像没点亮的刻度;数值快到这一位时亮起
  const colOn = (place: number) => (place <= 0 ? 1 : spxClamp((v / Math.pow(10, place)) * 10 - 9));
  // 单位:数字快到时从下方弹入
  const pu = spxSpring(spxProg(tc, 1.55 + dT, 2.35 + dT));
  const uA = spxProg(tc, 1.55 + dT, 1.8 + dT);
  // 注脚
  const pf = spxOutCubic(spxProg(tc, 1.95 + dT, 2.5 + dT));
  const pfClip = (1 - spxOutCubic(spxProg(tc, 1.95 + dT, 2.6 + dT))) * 100;

  // 刻度:跟着数字一格格点亮;停留期一道光扫过(扫光按参考 90 根的比例折算)
  const plan = spxTickPlan(absT, unit);
  const sweepU = tc > 2.4 + dT ? ((tc - 2.4 - dT) / 1.2) * (110 / 90) - 10 / 90 : -9; // 扫光中心(0~1 = 刻度条左→右)
  const sweepAt = (u: number) => (tc > 2.4 + dT ? Math.exp(-Math.pow((u - sweepU) / (4 / 90), 2)) : 0);

  const labelChars = label.lines.flat();
  return (
    <div
      className={`hud spfx hud-anchor hud-anchor--${position} is-in`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场由下面照搬的收回 + 左滑淡出负责
      // 右侧锚点从右边缘放大(右缘固定往左长);换卡居中时交给 CSS 的中心缩放
      style={{ ["--hud-acc" as string]: acc, ...offsetVars(params), ...(Number.isFinite(END) ? { opacity: 1 } : null), ...((position === "right" || position === "top-right") && (params as { centerOnStage?: boolean }).centerOnStage !== true ? { transformOrigin: "100% 50%" } : null) }}
    >
      <div style={{ position: "relative", width: W / SPX_REF_SCALE, height: H / SPX_REF_SCALE }}>
        <div
          data-fx-role="group"
          style={{
            position: "absolute", left: 0, top: 0, width: W, height: H,
            transformOrigin: "0 0", transform: `scale(${1 / SPX_REF_SCALE})`,
            fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif', color: "#fff",
          }}
        >
          <div
            style={{
              position: "absolute", left: 0, top: 0, width: W, height: H,
              transform: `translate(${dx.toFixed(2)}px, ${drift.toFixed(2)}px)`,
              opacity: +(1 - pOut).toFixed(3), filter: undefined,
              visibility: t < END ? "visible" : "hidden",
            }}
          >
            {/* 落定暖光 */}
            <div
              style={{
                position: "absolute", left: -40, top: 40, width: 420, height: 300, borderRadius: "50%",
                background: `radial-gradient(closest-side, ${acc}, transparent)`,
                opacity: +(glowA * 0.35).toFixed(3), pointerEvents: "none",
              }}
            />
            {/* 深色底板:从左向右擦开 */}
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 6, display: undefined,
                background: "linear-gradient(135deg, rgba(20,20,24,.86) 0%, rgba(26,24,22,.80) 60%, rgba(40,32,18,.78) 100%)",
                boxShadow: "0 24px 60px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.07)",
                clipPath: `inset(0 ${(100 - wipe * 100).toFixed(2)}% 0 0 round 6px)`,
              }}
            />
            {/* 左侧强调竖条 */}
            <div
              style={{
                position: "absolute", left: 0, top: 0, width: 6, height: "100%", background: acc,
                borderRadius: "6px 0 0 6px", transformOrigin: "50% 0", transform: `scaleY(${railS.toFixed(4)})`,
              }}
            />
            {/* HUD 角标 */}
            {[0, 1].map((b) => (
              <div
                key={b}
                style={{
                  position: "absolute", right: -10, ...(b ? { bottom: -10 } : { top: -10 }), width: 16, height: 16,
                  borderStyle: "solid", borderColor: acc, borderWidth: 0,
                  ...(b ? { borderBottomWidth: 2, borderRightWidth: 2 } : { borderTopWidth: 2, borderRightWidth: 2 }),
                  opacity: +(pc * 0.9).toFixed(3),
                  transform: `translate(${((1 - pc) * -14).toFixed(2)}px, ${((1 - pc) * (b ? -14 : 14)).toFixed(2)}px)`,
                }}
              />
            ))}
            <div style={{ position: "absolute", left: SPX_PAD_L, top: 34, width: CW, height: H - 64 }}>
              {/* 标签:圆点 + 逐字上浮;两行时字序接着往下数 */}
              {labelChars.length > 0 && (
                <div
                  data-fx-role="label"
                  style={{
                    position: "absolute", left: 0, top: 0, fontSize: label.fs, lineHeight: "26px", letterSpacing: "0.16em",
                    fontWeight: 600, color: acc, whiteSpace: "nowrap", fontFamily: SPX_MONO, marginTop: -2,
                  }}
                >
                  {label.lines.map((line, li) => {
                    const before = label.lines.slice(0, li).reduce((a, l) => a + l.length, 0);
                    return (
                      <div key={li}>
                        {li === 0 && (
                          <span
                            style={{
                              display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: acc,
                              marginRight: 12, verticalAlign: 2, transform: `scale(${pd.toFixed(3)})`, opacity: +dotA.toFixed(3),
                            }}
                          />
                        )}
                        {li > 0 && <span style={{ display: "inline-block", width: 20 }} />}
                        {line.map((c, ci) => {
                          const p = spxOutCubic(spxProg(tl, 0.18 + (before + ci) * 0.028, 0.48 + (before + ci) * 0.028));
                          return (
                            <span key={ci} style={{ display: "inline-block", opacity: +p.toFixed(3), transform: `translateY(${((1 - p) * 10).toFixed(2)}px)` }}>
                              {c.ch === " " ? " " : c.ch}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 数字行:前缀 + 滚轮数字 + 单位,底边对齐 */}
              <div
                data-fx-role="reading"
                style={{ position: "absolute", left: -6, top: numTop, height: numH, display: "flex", alignItems: "flex-end", whiteSpace: "nowrap" }}
              >
                {pre && (
                  <div style={{ fontSize: U, fontWeight: 700, lineHeight: 1, margin: `0 8px ${unitMB.toFixed(1)}px 0`, opacity: +appear.toFixed(3) }}>
                    {pre}
                  </div>
                )}
                <div style={{ display: "flex", height: numH, transformOrigin: "50% 100%", transform: `scale(${(1 + thud).toFixed(4)})` }}>
                  {glyphs.map((gl, i) => {
                    const on = colOn(gl.d ? gl.place : gl.ch === "," ? gl.place : 0);
                    const a = (0.16 + 0.84 * on) * appear;
                    if (!gl.d) {
                      return (
                        <div
                          key={i}
                          style={{
                            width: sepW, height: numH, lineHeight: `${numH}px`, fontSize: F, fontWeight: 800, textAlign: "center",
                            fontFamily: SPX_NUM_FONT, opacity: +a.toFixed(3),
                          }}
                        >
                          {gl.ch}
                        </div>
                      );
                    }
                    const sp = Math.abs(dv) * Math.pow(10, -gl.place); // 这一列每秒转几格
                    return (
                      <div key={i} style={{ position: "relative", width: cw, height: numH, overflow: "hidden" }}>
                        <div
                          style={{
                            position: "absolute", left: 0, top: 0, width: "100%",
                            transform: `translateY(${(-colPos(gl.place) * numH).toFixed(2)}px)`,
                            opacity: +a.toFixed(3),
                            filter: sp > 0.2 ? `blur(${Math.min(sp * 0.8, 3).toFixed(2)}px)` : "none",
                          }}
                        >
                          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, di) => (
                            <div
                              key={di}
                              style={{
                                height: numH, lineHeight: `${numH}px`, fontSize: F, fontWeight: 800, textAlign: "center",
                                fontFamily: SPX_NUM_FONT, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
                              }}
                            >
                              {d}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {unit && (
                  <div
                    style={{
                      fontSize: U, fontWeight: 700, lineHeight: 1, margin: `0 0 ${unitMB.toFixed(1)}px ${/^[%％+＋]/.test(unit) ? 4 : 14}px`,
                      opacity: +uA.toFixed(3), transform: `translateY(${((1 - pu) * 26).toFixed(2)}px)`,
                    }}
                  >
                    {unit}
                  </div>
                )}
              </div>

              {/* 刻度 / 比例条 */}
              <div style={{ position: "absolute", left: 0, top: ticksTop, width: TW, height: 22 }}>
                {plan.kind === "ticks"
                  ? Array.from({ length: plan.n }, (_, i) => {
                      const N = plan.n;
                      const major = i === 0 || (plan.major > 0 && (i + 1) % plan.major === 0);
                      const on = spxClamp(v * plan.per - i);
                      let a = 0.16 + 0.74 * on;
                      if (major && on > 0) a = Math.max(a, 0.95 * on);
                      const sw = sweepAt(N > 1 ? i / (N - 1) : 0);
                      a = Math.min(1, a + sw * 0.5);
                      const st = (i / N) * 0.27; // 刻度从左到右依次长出(参考 90 根 × 0.003s)
                      const sy = 0.4 + 0.6 * spxOutCubic(spxProg(tl, 0.3 + st, 0.6 + st)) + sw * 0.35;
                      return (
                        <i
                          key={i}
                          style={{
                            position: "absolute", bottom: 0, left: N > 1 ? (i * (TW - 2)) / (N - 1) : 0, width: 2,
                            height: major ? 22 : 10, borderRadius: 1,
                            background: (major && on > 0.5) || sw > 0.4 ? acc : "#fff",
                            opacity: +(a * appear).toFixed(3),
                            transformOrigin: "50% 100%", transform: `scaleY(${sy.toFixed(3)})`,
                          }}
                        />
                      );
                    })
                  : (() => {
                      // 比例条:数值太大数不出根数,只画一条随数字填满的条;两端立高刻度,扫光照样走
                      const fill = absT > 0 ? spxClamp(v / absT) : 0;
                      const grow = 0.4 + 0.6 * spxOutCubic(spxProg(tl, 0.3, 0.87));
                      const swX = sweepU * TW;
                      return (
                        <>
                          <div style={{ position: "absolute", left: 0, bottom: 0, width: TW, height: 10, borderRadius: 1, background: "#fff", opacity: +(0.16 * appear).toFixed(3), transformOrigin: "50% 100%", transform: `scaleY(${grow.toFixed(3)})` }} />
                          <div style={{ position: "absolute", left: 0, bottom: 0, width: TW * fill, height: 10, borderRadius: 1, background: "#fff", opacity: +(0.9 * appear).toFixed(3), transformOrigin: "50% 100%", transform: `scaleY(${grow.toFixed(3)})` }} />
                          {tc > 2.4 + dT && (
                            <div style={{ position: "absolute", left: swX - TW * 0.1, bottom: 0, width: TW * 0.2, height: 14, background: `linear-gradient(90deg, transparent, ${acc}, transparent)`, opacity: 0.8 }} />
                          )}
                          {[0, 1].map((e) => (
                            <i key={e} style={{ position: "absolute", bottom: 0, left: e ? TW - 2 : 0, width: 2, height: 22, borderRadius: 1, background: (e ? fill >= 1 : fill > 0) ? acc : "#fff", opacity: +((e ? 0.16 + 0.79 * (fill >= 1 ? 1 : 0) : 0.95) * appear).toFixed(3), transformOrigin: "50% 100%", transform: `scaleY(${grow.toFixed(3)})` }} />
                          ))}
                        </>
                      );
                    })()}
              </div>

              {/* 注脚:上浮 + 从左往右擦出;强调段用强调色 */}
              {hasFoot && (
                <div
                  data-fx-role="label"
                  style={{
                    position: "absolute", left: 0, top: footEnTop, width: "max-content",
                    opacity: +pf.toFixed(3), transform: `translateY(${((1 - pf) * 14).toFixed(2)}px)`,
                    clipPath: `inset(0 ${pfClip.toFixed(2)}% 0 0)`,
                  }}
                >
                  {footEnCs.length > 0 &&
                    footE.lines.map((line, li) => (
                      <div key={`e${li}`} style={{ fontFamily: SPX_MONO, fontSize: footE.fs, lineHeight: 1.3, letterSpacing: "0.12em", color: "rgba(255,255,255,.55)", whiteSpace: "nowrap", marginBottom: li === footE.lines.length - 1 ? 6 : 0 }}>
                        {line.map((c) => c.ch).join("")}
                      </div>
                    ))}
                  {foot.lines.map((line, li) => (
                    <div key={li} style={{ fontSize: foot.fs, lineHeight: `${footLH}px`, fontWeight: 500, color: "rgba(255,255,255,.88)", whiteSpace: "nowrap", letterSpacing: "0.04em" }}>
                      {line.map((c, ci) => (
                        <span key={ci} style={c.hot ? { color: acc, fontWeight: 600 } : undefined}>
                          {c.ch}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const statProofDef: EffectDef<StatProofParams> = {
  id: "stat-proof",
  name: "StatProof",
  description: "数字实证 · 巨号滚动计数 + 双语注脚",
  tags: ["滚动计数"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    kicker: "EN KICKER · HERE",
    kickerZh: "中文小注写在这",
    value: 10000,
    suffix: "+",
    prefix: "",
    footEn: "EN FOOTNOTE · SOURCE",
    footZh: "数字的出处写在这",
    countMs: 1600,
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
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
        { label: "居中", value: "center" },
        { label: "左上", value: "top-left" },
        { label: "右上", value: "top-right" },
      ],
    },
    { key: "kicker", label: "顶部 kicker(英文等宽)", type: "text" },
    { key: "kickerZh", label: "kicker 中文小注", type: "text" },
    { key: "value", label: "目标数字(可带小数)", type: "text" },
    { key: "prefix", label: "数字前缀(+/¥)", type: "text" },
    { key: "suffix", label: "数字后缀(+/%)", type: "text" },
    { key: "footEn", label: "注脚(英文等宽)", type: "text" },
    { key: "footZh", label: "注脚(中文)", type: "text" },
    { key: "countMs", label: "计数时长(卡点用)", type: "range", min: 400, max: 5000, step: 100, unit: "ms" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: StatProof,
};
