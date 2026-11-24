import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface PunchPillParams {
  theme: "dark" | "light";
  position: "bottom" | "top-left" | "top-right";
  text: string;
  accent: string;
  /** 动法:pop 淡入放大(原版) / stretch 从圆点拉开 / drop 落定 / ring 光圈弹出;缺省 = pop */
  /** 新动效圆章里的图标:内置图标名或 emoji/字;空 = 对话气泡(三个点轮流跳) */
  icon?: string;
  offsetX?: number;
  offsetY?: number;
  /** 时间轴注入(编辑台/导出),精修版逐帧动画用 */
  __t?: number;
  __start?: number;
}

/* ───────── 精修版:逐帧照搬参考作品 board.html 的 renderAt(t) ─────────
   深色药丸 + 强调色圆章(评论气泡,三个点在停留时轮流跳)。圆章弹簧转进 → 药丸从圆章往右展开 →
   逐字弹簧上浮去模糊 → 重点段下划线扫出 → 一次走光 → 圆章两次脉冲环;退场:字先淡、药丸往回收、圆章缩没。
   文字按第一个「 · 」(或 • | ｜)切成「前半句 + 强调段」;没有分隔时整句白字,下划线划在整句下。
   全部画面是卡片秒数 t 的纯函数;只用行内样式,不吃 hud.css 的 .pp-* 规则。 */
const PP_OUT = 0.3; // 退场时长(s)
const PP_PAPER = "#FFFFFF";
const PP_INK = "#141418";
const PP_F0 = 46; // 参考作品字号;药丸其余尺寸都按 字号/46 等比
const PP_FMIN = 30; // 正文字号下限
const PP_SAFE = 0.96;
const PP_FACE_X = 700; // 横版人脸左缘约 720,左锚点卡不越过这条线(右锚点对称)
const PP_V_MARGIN = 48;
const PP_CHROME_EM = 144 / 46; // 行内非文字部分:左内边距 10 + 圆章 72 + 间距 24 + 右内边距 38
const PP_SEP_EM = 1.0; // 分隔点「·」连左右 14px 外边距的估算宽(em)
const PP_LS_EM = 1 / 46; // 字距 1px@46
const PP_PITCH = 1.45; // 换行后行距(em),给下划线留位置

const ppClamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ppProg = (t: number, s: number, d: number) => ppClamp((t - s) / d, 0, 1);
const ppOutExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const ppOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const ppInCubic = (p: number) => p * p * p;
const ppInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** 0→1 欠阻尼弹簧(闭式解),t 单位秒 */
function ppSpring(t: number, w: number, z: number) {
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

const ppIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const ppIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
/** 字宽估算(em):全角 1,拉丁大写/数字 0.66,小写 0.56,空格 0.3,其他 0.4;另加字距 */
function ppCharEm(c: string) {
  if (c === "·") return PP_SEP_EM;
  const base = ppIsWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4;
  return base + PP_LS_EM;
}

/** 一个字:sep=分隔点;hot=强调色;ul=属于下划线那一段 */
type PpTok = { c: string; sep: boolean; hot: boolean; ul: boolean };
function ppTokens(text: string): PpTok[] {
  const m = /\s*[·•|｜]\s*/.exec(text);
  const A = m ? text.slice(0, m.index).trim() : "";
  const B = m ? text.slice(m.index + m[0].length).trim() : "";
  if (!m || !A || !B) {
    // 没有分隔(或分隔在头尾):整句一样处理,下划线划整句
    return Array.from(text.trim()).map((c) => ({ c, sep: false, hot: false, ul: true }));
  }
  return [
    ...Array.from(A).map((c) => ({ c, sep: false, hot: false, ul: false })),
    { c: "·", sep: true, hot: false, ul: false },
    ...Array.from(B).map((c) => ({ c, sep: false, hot: true, ul: true })),
  ];
}

/** 卡片(缩放前 CSS 像素)最大宽:按画幅、锚点、缩放、水平偏移推算。
 *  横版人脸线只按默认位置(offsetX=0)算:手动拖开卡宽锁住,不再越拖越窄;拖开后只防出画(离边 PP_V_MARGIN) */
function ppMaxWidth(position: string, scale: number, ox: number) {
  const SW = 1920;
  const s = Math.max(0.2, scale);
  const edge = 120; // 锚点离边 120px
  if (position === "top-left") {
    // transform-origin 左上:左缘 = 120 + ox
    const frame = (SW - PP_V_MARGIN - edge - ox) / s;
    return Math.min(PP_FACE_X - edge, frame); // 人脸线只按默认大小(scale=1)算,拉大就真的变大
  }
  if (position === "top-right") {
    // 从右边缘缩放(根元素 transformOrigin right):右缘固定 SW-120+ox,左缘 = 右缘 − W·s
    const within = (o: number, limitX: number, s: number) => (SW - edge + o - limitX) / s;
    // 人脸线只按默认大小(scale=1)、默认位置算;出画用真实 scale / offset
    return Math.min(within(0, SW - PP_FACE_X, 1), within(ox, PP_V_MARGIN, s));
  }
  const m = edge;
  return (SW - 2 * Math.abs(ox) - 2 * m) / s;
}

/** 断成 n 行:让最宽那行尽量窄(极小化最大行宽)。
    能断的位置:分隔点前(分隔点丢掉,换行本身就是分隔,且优先在这里断)、字与字之间
    (不拆英文单词、标点不放行首、开括号不放行尾,尽量不拆强调段)。 */
function ppBreak(toks: PpTok[], n: number) {
  const L = toks.length;
  const w = toks.map((tk) => ppCharEm(tk.c));
  const pre = [0];
  w.forEach((x) => pre.push(pre[pre.length - 1] + x));
  // 断点 j:行在 j 之前结束;下一行从 j 开始(落在分隔点上就从 j+1 开始)。bonus 加在「这一行」的比较宽度上
  const cut: { j: number; next: number; bonus: number }[] = [];
  for (let j = 1; j < L; j++) {
    const a = toks[j - 1];
    const b = toks[j];
    if (b.sep) { cut.push({ j, next: j + 1, bonus: -1.5 }); continue; }
    if (a.sep) continue;
    if (ppIsWord(a.c) && ppIsWord(b.c)) continue; // 英文单词不拆
    if (/[，。、！？：；,.!?:;）)」』》”’]/.test(b.c)) continue; // 标点不放行首
    if (/[（(「『《“‘]/.test(a.c)) continue; // 开括号不放行尾
    cut.push({ j, next: j, bonus: a.hot && b.hot ? 1 : a.c === " " || b.c === " " ? -0.1 : 0 });
  }
  const lineEm = (s: number, e: number) => pre[e] - pre[s];
  type St = { cost: number; lines: number[][] };
  // 两遍 dp:①极小化最宽那行(行宽 + 断点偏好);②在不超过①结果的前提下,各行宽平方和最小 = 尽量匀
  const run = (cap: number | null) => {
    const memo = new Map<string, St | null>();
    const fits = (v: number) => cap == null || v <= cap + 1e-6;
    const solve = (s: number, k: number): St | null => {
      const key = `${s}/${k}`;
      if (memo.has(key)) return memo.get(key)!;
      let res: St | null = null;
      const idx = (e: number) => Array.from({ length: e - s }, (_, i) => s + i);
      if (k === 1) {
        const v = lineEm(s, L);
        if (s < L && fits(v)) res = { cost: cap == null ? v : v * v, lines: [idx(L)] };
      } else {
        for (const c of cut) {
          if (c.j <= s || c.next >= L) continue;
          const v = lineEm(s, c.j);
          if (!fits(v + c.bonus)) continue;
          const rest = solve(c.next, k - 1);
          if (!rest) continue;
          const cost = cap == null ? Math.max(v + c.bonus, rest.cost) : (v + c.bonus) ** 2 + rest.cost;
          if (!res || cost < res.cost) res = { cost, lines: [idx(c.j), ...rest.lines] };
        }
      }
      memo.set(key, res);
      return res;
    };
    return solve(0, n);
  };
  const first = run(null);
  const r = first && (run(first.cost) ?? first);
  return r && { lines: r.lines, maxEm: Math.max(...r.lines.map((ln) => ln.reduce((a, i) => a + w[i], 0))) };
}

/** 排版:一行(只差一点就微缩到 88%)→ 两行(先换行再缩,不小于 PP_FMIN)→ 两行最小字号还放不下才加到三四行 */
function ppLayout(toks: PpTok[], maxW: number) {
  const all = toks.map((_, i) => i);
  const total = toks.reduce((a, tk) => a + ppCharEm(tk.c), 0);
  const widthAt = (F: number, lineEm: number) => F * (PP_CHROME_EM + lineEm);
  const fitW = maxW * PP_SAFE;
  for (let F = PP_F0; F >= PP_F0 * 0.88; F -= 0.5) if (widthAt(F, total) <= fitW) return { F, lines: [all] };
  const two = ppBreak(toks, 2);
  for (let F = PP_F0; F >= PP_FMIN; F -= 0.5) {
    if (widthAt(F, total) <= fitW) return { F, lines: [all] };
    if (two && widthAt(F, two.maxEm) <= fitW) return { F, lines: two.lines };
  }
  // 兜底:宁可多一行也不出画;行数从少到多,每档取放得下的最大字号
  let last = two ?? { lines: [all], maxEm: total };
  for (let n = 3; n <= Math.min(5, toks.length); n++) {
    const b = ppBreak(toks, n);
    if (!b) break;
    last = b;
    const F = Math.min(PP_F0, fitW / (PP_CHROME_EM + b.maxEm));
    if (F >= PP_FMIN) return { F: Math.floor(F * 2) / 2, lines: b.lines };
  }
  return { F: PP_FMIN, lines: last.lines };
}

function PunchPill({ params, playToken }: EffectProps<PunchPillParams>) {
  const { position, text, accent } = params;
  const icon = (params.icon ?? "").trim();
  const t = useCardElapsed(params, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const ts = t * spd;
  const end = (params as { __end?: number }).__end;
  const DUR = typeof end === "number" ? end - (params.__start ?? 0) : null;
  const acc = ACCENT_VAR[accent] ?? ACCENT_VAR.blue;

  // ── 排版 ──
  const extra = params as { scale?: number; __scale?: number };
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const toks = ppTokens(text || "");
  const maxW = ppMaxWidth(position, cardScale, params.offsetX ?? 0);
  const { F, lines } = ppLayout(toks, maxW);
  const u = F / PP_F0;
  const lineEms = lines.map((ln) => ln.reduce((a, i) => a + ppCharEm(toks[i].c), 0));
  const W = F * (PP_CHROME_EM + Math.max(0, ...lineEms)); // 估算整条宽(px),走光行程/展开起点用
  const H1 = 92 * u; // 单行药丸高 = 收起时圆头的宽
  const H = H1 + (lines.length - 1) * PP_PITCH * F;
  const R = 46 * u;
  // 渲染顺序 = 逐字出场顺序(被丢掉的分隔点不占号)
  const order = new Map<number, number>();
  lines.flat().forEach((ti, k) => order.set(ti, k));
  const startOf = (ti: number) => 0.3 + (order.get(ti) ?? 0) * 0.04;
  // 参考作品的几拍(下划线 0.95、走光 1.25、首次脉冲 1.15)挂在「下划线那段最后一个字出发后 0.29s」上;
  // 字多时整体顺延,参考内容正好落在原时刻
  const lastUl = lines.flat().filter((ti) => toks[ti].ul).pop();
  const uStart = lastUl == null ? 0.95 : Math.max(0.95, startOf(lastUl) + 0.29);
  const d = uStart - 0.95;

  if (DUR != null && t >= DUR) return null;
  const x = DUR == null ? 0 : ppClamp((t - (DUR - PP_OUT / spd)) / (PP_OUT / spd), 0, 1); // 退场进度

  // 圆章:弹簧弹出 + 转入,退场时缩没
  const cs = ppSpring(ts, 22, 0.42);
  const cIn = ppClamp(cs, 0, 1.3);
  const cOut = 1 - ppInCubic(ppProg(x, 0.35, 0.65));
  const chipTf = `scale(${(cIn * cOut).toFixed(4)}) rotate(${((1 - ppClamp(cs, 0, 1)) * -70).toFixed(2)}deg)`;

  // 药丸从圆章往右展开;退场往回收
  const open = ppOutExpo(ppProg(ts, 0.12, 0.62));
  const close = ppInCubic(ppProg(x, 0, 0.7));
  const vis = H1 + (W - H1) * open * (1 - close);
  const rPct = ppClamp((1 - vis / W) * 100, 0, 100);
  const bodyAlpha = ppProg(ts, 0.08, 0.12) * (1 - ppProg(x, 0.6, 0.4));
  // 整卡:轻轻上抬落定
  const lift = (1 - ppOutCubic(ppProg(ts, 0, 0.6))) * 14;

  // 下划线:扫入;退场从左往右抹掉
  const uIn = ppOutExpo(ppProg(ts, uStart, 0.5));
  const uOut = ppProg(x, 0, 0.5);
  const ulTf = `scaleX(${(uIn * (1 - uOut)).toFixed(4)})`;
  const ulOrigin = uOut > 0 ? "100% 50%" : "0 50%";

  // 一次走光
  const sh = ppInOut(ppProg(ts, 1.25 + d, 0.8));
  // 圆章脉冲环两拍
  let rs = 1;
  let ro = 0;
  [1.15 + d, 3.2 + d].forEach((s0) => {
    const q = ppProg(ts, s0, 0.9);
    if (q > 0 && q < 1) {
      rs = 1 + ppOutCubic(q) * 0.75;
      ro = (1 - q) * 0.85;
    }
  });
  // 气泡里三个点:停留时轮流跳
  const live = ppProg(ts, 0.6, 0.3) * (1 - x);
  const dots = [0, 1, 2].map((k) => {
    const ph = ((ts - 0.6) * 2 * Math.PI) / 1.1 - k * 0.9;
    const hop = Math.max(0, Math.sin(ph));
    return { cy: 20 - hop * 4 * live, op: 0.55 + 0.45 * hop * live + 0.45 * (1 - live) };
  });

  const exitA = 1 - ppProg(x, 0, 0.45);
  const charEl = (ti: number) => {
    const tk = toks[ti];
    const s = startOf(ti);
    const pp = ppProg(ts, s, 0.45);
    const sp = ppSpring(ts - s, 24, 0.55);
    const y = (1 - ppClamp(sp, 0, 1.2)) * 30 * u;
    const b = (1 - ppOutCubic(pp)) * 8 * u;
    return (
      <span
        key={ti}
        style={{
          display: "inline-block",
          opacity: +(ppOutCubic(ppProg(ts, s, 0.22)) * exitA * (tk.sep ? 0.6 : 1)).toFixed(4),
          transform: `translateY(${y.toFixed(2)}px)`,
          filter: b > 0.05 ? `blur(${b.toFixed(2)}px)` : "none",
          whiteSpace: "pre",
          ...(tk.sep ? { color: acc, margin: `0 ${14 * u}px`, fontWeight: 400 } : null),
        }}
      >
        {tk.c}
      </span>
    );
  };
  // 每行里连续的下划线段并成一块,各自带一条下划线(跨行时两行同一节奏)
  const lineEl = (ln: number[], li: number) => {
    const runs: { ul: boolean; hot: boolean; idx: number[] }[] = [];
    ln.forEach((ti) => {
      const tk = toks[ti];
      const last = runs[runs.length - 1];
      if (last && last.ul === tk.ul && last.hot === tk.hot) last.idx.push(ti);
      else runs.push({ ul: tk.ul, hot: tk.hot, idx: [ti] });
    });
    return (
      <div key={li} style={{ display: "flex", alignItems: "center", height: F, whiteSpace: "nowrap" }}>
        {runs.map((rn, ri) =>
          rn.ul ? (
            <span key={ri} style={{ position: "relative", display: "inline-flex", color: rn.hot ? acc : PP_PAPER }}>
              {rn.idx.map(charEl)}
              <span
                style={{
                  position: "absolute", left: 0, right: 0, bottom: -12 * u, height: 5 * u, borderRadius: 3 * u,
                  background: acc, transformOrigin: ulOrigin, transform: ulTf,
                }}
              />
            </span>
          ) : (
            <span key={ri} style={{ display: "inline-flex", color: rn.hot ? acc : PP_PAPER }}>{rn.idx.map(charEl)}</span>
          ),
        )}
      </div>
    );
  };

  return (
    <div
      className={`hud hud-anchor hud-anchor--${position}`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由下面照搬的收起负责,不叠两层
      // 右上锚点从右边缘缩放(纵向保持中心),拉大往左长不往右冒出画;居中挪位时交给 hud.css
      style={{ ["--hud-acc" as string]: acc, ...offsetVars(params), opacity: 1, transformOrigin: position === "top-right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? "right center" : undefined }}
    >
      <div
        data-fx-role="group"
        style={{
          position: "relative", height: H, transform: `translateY(${(lift * u).toFixed(2)}px)`,
          visibility: t > 0 ? "visible" : "hidden", filter: undefined,
        }}
      >
        {/* 底板:深色药丸,clip-path 从左往右展开 */}
        <div
          style={{
            position: "absolute", inset: 0, borderRadius: R, overflow: "hidden", display: undefined,
            background: "linear-gradient(180deg, rgba(30,30,36,.94), rgba(16,16,20,.94))",
            boxShadow: `0 ${14 * u}px ${36 * u}px rgba(0,0,0,.28), 0 ${2 * u}px ${6 * u}px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.08)`,
            clipPath: `inset(0 ${rPct.toFixed(3)}% 0 0 round ${R}px)`,
            opacity: +bodyAlpha.toFixed(4),
          }}
        >
          <div
            style={{
              position: "absolute", left: 0, top: -20 * u, width: 120 * u, height: H + 40 * u,
              background: "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,0) 100%)",
              transform: `translateX(${((-160 + sh * (W / u + 200)) * u).toFixed(2)}px) skewX(-12deg)`,
              opacity: sh > 0 && sh < 1 ? 1 : 0,
            }}
          />
        </div>
        {/* 内容行:圆章 + 文字;跟着底板一起裁,字不会溢出药丸 */}
        <div
          style={{
            position: "relative", display: "flex", alignItems: "center", height: H,
            padding: `0 ${38 * u}px 0 ${10 * u}px`, whiteSpace: "nowrap",
            clipPath: `inset(-40px ${rPct.toFixed(3)}% -40px -40px)`,
          }}
        >
          <div style={{ position: "relative", width: 72 * u, height: 72 * u, flex: "none" }}>
            <div
              style={{
                position: "absolute", left: 0, top: 0, width: 72 * u, height: 72 * u, borderRadius: "50%",
                border: `${3 * u}px solid ${acc}`, boxSizing: "border-box",
                transform: `scale(${rs.toFixed(4)})`, opacity: +(ro * (1 - x)).toFixed(4),
              }}
            />
            <div
              style={{
                position: "absolute", left: 0, top: 0, width: 72 * u, height: 72 * u, borderRadius: "50%",
                background: acc, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `inset 0 ${-3 * u}px 0 rgba(0,0,0,.12)`, transform: chipTf, opacity: t <= 0 ? 0 : 1,
              }}
            >
              {/* 圆章图标:默认对话气泡;填了图标名/emoji 就换成它 */}
              {!icon ? (
                <svg width={44 * u} height={44 * u} viewBox="0 0 44 44" aria-hidden="true">
                  <path d="M8 9 h28 a4 4 0 0 1 4 4 v14 a4 4 0 0 1 -4 4 h-15 l-7 6 v-6 h-6 a4 4 0 0 1 -4 -4 v-14 a4 4 0 0 1 4 -4z" fill={PP_INK} />
                  {dots.map((dt, k) => (
                    <circle key={k} cx={14 + k * 8} cy={dt.cy.toFixed(2)} r="2.8" style={{ fill: acc }} opacity={dt.op.toFixed(3)} />
                  ))}
                </svg>
              ) : (
                <span style={{ fontSize: 34 * u, lineHeight: 1, fontWeight: 800, color: PP_INK }}>{icon}</span>
              )}
            </div>
          </div>
          <div
            style={{
              marginLeft: 24 * u, display: "flex", flexDirection: "column", gap: (PP_PITCH - 1) * F,
              fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
              fontSize: F, fontWeight: 700, letterSpacing: u, lineHeight: 1, color: PP_PAPER,
            }}
          >
            {lines.map(lineEl)}
          </div>
        </div>
      </div>
    </div>
  );
}


export const punchPillDef: EffectDef<PunchPillParams> = {
  id: "punch-pill",
  name: "PunchPill",
  description: "金句药丸 · 高亮观点定格弹入",
  tags: ["玻璃虚化"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "bottom",
    text: "一句金句,定格三秒",
    accent: "blue",
    icon: "",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "底部居中", value: "bottom" },
        { label: "左上", value: "top-left" },
        { label: "右上", value: "top-right" },
      ],
    },
    { key: "text", label: "金句文字", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "icon", label: "圆章图标(emoji 或一两个字,空=对话气泡)", type: "text" },
    ...OFFSET_CONTROLS,
  ],
  Component: PunchPill,
};
