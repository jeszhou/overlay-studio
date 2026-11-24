import type { EffectDef, EffectProps } from "../types";
import { useCardElapsed, usePlateSpeed } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_SWATCH,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
} from "./accent";

export interface TermCardParams {
  theme: "dark" | "light";
  position: "left" | "right";
  en: string; // 英文 / 拼音,可留空
  term: string;
  def: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

/* ── 精修版「术语卡」:动作逐拍照搬隔离 Opus 一次性作品 board.html 的 renderAt(t) ──
   深色玻璃底板左向右展开 → 英文小字字距收紧逐字亮起 + 探测波小点 → 术语逐字从模糊中回弹浮出
   → 分隔线画出 → 定义上浮 → 关键词变暖色 + 虚线下划线画出后缓慢流动;最后 0.5s 内容上飘、底板向左收回。
   全部画面是 t 的纯函数;只用行内样式 / SVG 属性,不依赖 hud.css */
const TP = {
  W: 568, // 参考作品底板宽
  padL: 50, padR: 40, padT: 40, padB: 29,
  headH: 28, // 英文小字一行高
  termGap: 14, ruleGap: 18, defGap: 22,
  termFs: 112, termLH: 132 / 112,
  defFs: 34, defLH: 46 / 34,
  enFs: 20,
  OUTLEN: 0.5, // 最后 0.5 秒收走
};
const T_MONO = '"SF Mono", Menlo, "Helvetica Neue", monospace';
const T_FACE_X = 700; // 横版人脸左缘约 720,卡不越过这条线(右锚点对称)
const T_V_MARGIN = 48;
const T_SAFE = 0.96; // 字宽是估算的,留一点余量

const tClamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const tProg = (t: number, a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : tClamp((t - a) / (b - a))); // 先比端点:退场时刻为 Infinity(没有 __end)时不出 NaN
const tOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const tOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const tInCubic = (x: number) => x * x * x;
const tInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** 带一点回弹的弹簧(阻尼振荡) */
const tSpring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(9 * x));

/* ── 排版:先换行(最多两行,自然断开)再缩字号,有字号下限 ── */
type TChar = { c: string; key: boolean };
const tIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const tIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
/** 估算字宽(em):全角 1,大写/数字 0.66,小写 0.56,空格 0.3,其余 0.4 */
const tEm = (c: string) => (tIsWide(c) ? 1 : c === " " ? 0.3 : /[A-Z0-9]/.test(c) ? 0.66 : /[a-z]/.test(c) ? 0.56 : 0.4);
type TMeasure = (c: string) => number;
const tLineW = (cs: TChar[], m: TMeasure, fs: number, ls: number) => cs.reduce((w, ch) => w + (m(ch.c) + ls) * fs, 0);
const tTrim = (cs: TChar[]) => {
  let a = 0;
  let b = cs.length;
  while (a < b && cs[a].c === " ") a++;
  while (b > a && cs[b - 1].c === " ") b--;
  return cs.slice(a, b);
};
/** 断成两行:不拆英文单词、行首不放标点、尽量不拆关键词、优先在关键词边上断,挑两行最均衡的位置 */
function tSplit2(cs: TChar[], m: TMeasure): [TChar[], TChar[]] | null {
  const w = cs.map((ch) => m(ch.c));
  const total = w.reduce((a, b) => a + b, 0);
  let best: { at: number; cost: number } | null = null;
  let loose: { at: number; cost: number } | null = null;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const a = cs[i - 1].c;
    const b = cs[i].c;
    const cost = Math.max(acc, total - acc) * (cs[i - 1].key && cs[i].key ? 1.25 : 1) * (a === " " || b === " " ? 0.97 : 1) * (cs[i - 1].key !== cs[i].key ? 0.8 : 1); // 关键词前后是最自然的断点
    if (!loose || cost < loose.cost) loose = { at: i, cost };
    if (tIsWord(a) && tIsWord(b)) continue;
    if (/[，。、！？：；,.!?:;）)」』》]/.test(b)) continue;
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  const pick = best ?? loose;
  if (!pick) return null;
  return [tTrim(cs.slice(0, pick.at)), tTrim(cs.slice(pick.at))];
}
/** 兜底:下限字号两行还放不下,按宽度贪心折成多行(英文单词、关键词整个挪到下一行,一行都放不下才硬拆) */
function tGreedy(cs: TChar[], m: TMeasure, fs: number, ls: number, maxW: number) {
  const units: TChar[][] = [];
  cs.forEach((ch, i) => {
    const last = units[units.length - 1];
    if (last && i > 0 && ((tIsWord(cs[i - 1].c) && tIsWord(ch.c)) || (cs[i - 1].key && ch.key))) last.push(ch);
    else units.push([ch]);
  });
  const lines: TChar[][] = [];
  let cur: TChar[] = [];
  const pushChar = (ch: TChar) => {
    if (cur.length && tLineW([...cur, ch], m, fs, ls) > maxW) {
      lines.push(tTrim(cur));
      cur = ch.c === " " ? [] : [ch];
    } else cur.push(ch);
  };
  units.forEach((u) => {
    if (u.length > 1 && cur.length && tLineW([...cur, ...u], m, fs, ls) > maxW && tLineW(u, m, fs, ls) <= maxW) {
      lines.push(tTrim(cur));
      cur = [...u];
    } else u.forEach(pushChar);
  });
  if (cur.length) lines.push(tTrim(cur));
  return lines.filter((l) => l.length);
}
/** 定字号和断行:单行原字号 → 单行缩到 oneMin → 两行(从原字号往下缩到 min) → min 字号多行兜底 */
function tFit(cs: TChar[], m: TMeasure, maxW: number, base: number, oneMin: number, min: number, ls: number) {
  for (let fs = base; fs >= oneMin; fs--) if (tLineW(cs, m, fs, ls) <= maxW) return { fs, lines: [cs] };
  const two = cs.length >= 2 ? tSplit2(cs, m) : null;
  if (two) for (let fs = base; fs >= min; fs--) if (Math.max(tLineW(two[0], m, fs, ls), tLineW(two[1], m, fs, ls)) <= maxW) return { fs, lines: two };
  return { fs: min, lines: tGreedy(cs, m, min, ls, maxW) };
}

/** 定义句里的关键词:优先 *关键词*;没标就取最后一个「的」后面那 2-6 个字(「……的隐形变量」);都没有就不点亮 */
function tDefChars(def: string): TChar[] {
  if (/\*[^*]+\*/.test(def)) {
    const out: TChar[] = [];
    def.split(/(\*[^*]+\*)/).filter(Boolean).forEach((seg) => {
      const key = seg.length > 2 && seg.startsWith("*") && seg.endsWith("*");
      Array.from(key ? seg.slice(1, -1) : seg).forEach((c) => out.push({ c, key }));
    });
    return out;
  }
  const cs = Array.from(def);
  let end = cs.length;
  while (end > 0 && /[，。、！？：；,.!?:;\s…]/.test(cs[end - 1])) end--;
  const at = cs.slice(0, end).lastIndexOf("的");
  const len = end - at - 1;
  const hasKey = at > 0 && len >= 2 && len <= 6;
  return cs.map((c, i) => ({ c, key: hasKey && i > at && i < end }));
}

/** 卡片(缩放前)最大宽:不越过人脸线。
 *  人脸线只按默认大小、默认位置(scale=1、offsetX=0)算:用户拉大或拖开就是自己挑的,卡按比例真变大、
 *  宽度锁住只平移;只有出画这条按真实 scale / offsetX 算(离画面边 T_V_MARGIN)。 */
function tMaxWidth(_ratio: string, position: string, scale: number, ox: number) {
  const SW = 1920;
  const face = SW - T_FACE_X;
  return Math.min(tWidthWithin(SW, position, 1, 0, face), tWidthWithin(SW, position, scale, ox, T_V_MARGIN));
}

/** 卡的远端边不越过离画面边 limit 的那条线时,允许的最大宽 */
function tWidthWithin(SW: number, position: string, scale: number, ox: number, limit: number) {
  const edge = 120; // .hud-anchor 左右锚点离边 120px
  const s = Math.max(0.2, scale);
  if (position !== "right") {
    // 左锚点:缩放原点在左边,右缘 = 120 + ox + W·s
    return (SW - limit - edge - ox) / s;
  }
  // 右锚点:新动效根元素 transformOrigin 在右边,右缘固定 = SW−120+ox,左缘 = 右缘 − W·s(放大只往左长)
  return (SW - edge + ox - limit) / s;
}

/** 强调色 → rgb(插值用)。转变橙照参考作品用椅子的暖琥珀黄 */
function tAccentRgb(accent: string): [number, number, number] {
  const hex = accent === "orange" ? "#F7C04A" : /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ACCENT_SWATCH[accent] ?? "#F7C04A";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const tRgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function TermCard({ params, playToken }: EffectProps<TermCardParams>) {
  const { position, en, term, def, accent } = params;
  const t0 = useCardElapsed(params as TermCardParams & { __start?: number; __t?: number }, playToken);
  const extra = params as { scale?: number; __scale?: number; __start?: number; __end?: number };
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const DUR = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) : Infinity;
  const spd = usePlateSpeed(); // 动画速度:无卡点,入场/循环用卡内时间 ts,退场按真实结束时刻
  const OUT = DUR - TP.OUTLEN / spd;
  const t = Math.max(0, Math.min(DUR, t0));
  const ts = t * spd;
  const acc = tAccentRgb(accent);
  const accDark: [number, number, number] = [acc[0] * 0.94, acc[1] * 0.77, acc[2] * 0.6].map(Math.round) as [number, number, number];

  // ── 排版:先定卡宽(安全区),再定各行字号和断行 ──
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const maxW = tMaxWidth("h", position, cardScale, params.offsetX ?? 0) * T_SAFE;
  const W = Math.round(Math.max(300, Math.min(TP.W, maxW)));
  const avail = W - TP.padL - TP.padR;
  const enCs: TChar[] = Array.from(en ?? "").map((c) => ({ c, key: false }));
  const hasEn = tTrim(enCs).length > 0;
  const enFit = hasEn ? tFit(tTrim(enCs), () => 0.62, avail - 42, TP.enFs, 18, 18, 0.32) : null;
  const termFit = tFit(Array.from(term).map((c) => ({ c, key: false })), tEm, avail, TP.termFs, Math.round(TP.termFs * 0.6), 44, 0.072);
  const defFit = tFit(tDefChars(def), tEm, avail, TP.defFs, 31, 30, 0);
  const headH = enFit ? enFit.lines.length * TP.headH : 0;
  const termLH = termFit.fs * TP.termLH;
  const defLH = defFit.fs * TP.defLH;
  const H = Math.round(
    TP.padT + (enFit ? headH + TP.termGap : 0) + termFit.lines.length * termLH + TP.ruleGap + 1 + TP.defGap + defFit.lines.length * defLH + TP.padB,
  );

  // 竖直方向不出画:卡太高时先整体挪回画内,还放不下再整体缩小(只在内容极长、又放得很大时才会发生)
  const sy = cardScale;
  const anchorCy = 540 + (params.offsetY ?? 0);
  const stageH = 1080;
  const room = stageH - 48;
  const fitZ = H * sy > room ? room / (H * sy) : 1;
  const halfH = (H * sy * fitZ) / 2;
  const shiftY = anchorCy - halfH < 24 ? 24 - (anchorCy - halfH) : anchorCy + halfH > stageH - 24 ? stageH - 24 - (anchorCy + halfH) : 0;

  // ── 退场进度 ──
  const fin = Number.isFinite(DUR);
  const o = fin ? tProg(t, OUT, DUR) : 0; // 退场进度 0→1
  const oc = fin ? tInCubic(tProg(t, OUT, OUT + 0.32 / spd)) : 0; // 内容先走
  const op = fin ? tInOutCubic(tProg(t, OUT + 0.12 / spd, DUR)) : 0; // 底板后收

  // 底板:从左向右展开,退场时向左收回
  const pIn = tOutExpo(tProg(ts, 0, 0.55));
  const reveal = pIn * (1 - op);
  const barK = tOutExpo(tProg(ts, 0.05, 0.6)) * (1 - (fin ? tInCubic(tProg(t, OUT, OUT + 0.3 / spd)) : 0));
  const glowOp = 0.75 + 0.25 * Math.sin(ts * 1.6); // 角落暖光缓慢呼吸
  const cOut = 1 - oc;
  const cLift = oc * -14;

  // 英文小字:字距从宽收紧 + 逐字亮起
  const ePro = tOutCubic(tProg(ts, 0.12, 0.75));
  // 探测波小点:核心点弹出,之后持续向外发出探测波
  const cp = tSpring(tProg(ts, 0.08, 0.7));
  const rings = [0, 1].map((k) => {
    const start = 0.35 + k * 0.7;
    const period = 1.4;
    if (ts < start) return null;
    const ph = ((ts - start) % period) / period;
    return { s: 0.35 + 1.15 * tOutCubic(ph), o: (1 - ph) * 0.85 * cOut };
  });
  // 术语停留期极轻的呼吸:字距微微起伏
  const hold = tProg(ts, 0.9, 1.4) * (1 - oc);
  const termLS = 0.06 + 0.012 * hold * Math.sin((ts - 0.9) * 2.2);
  const ruleK = tOutExpo(tProg(ts, 0.34, 0.95)) * (1 - (fin ? tInCubic(tProg(t, OUT, OUT + 0.28 / spd)) : 0));
  const dp = tOutCubic(tProg(ts, 0.38, 0.9));
  // 关键词:虚线下划线画出,之后缓缓流动;颜色从白过渡到强调色
  const lp = tInOutCubic(tProg(ts, 0.8, 1.35));
  const flow = Math.max(0, ts - 1.35) * 9;
  const kp = tProg(ts, 0.75, 1.15);
  const keyColor = `rgb(${[0, 1, 2].map((i) => Math.round(240 + (acc[i] - 240) * kp)).join(",")})`;
  const du = defFit.fs / TP.defFs; // 下划线随字号缩放

  let termIdx = 0;
  let enIdx = 0;
  return (
    <div
      className={`hud tcx hud-anchor hud-anchor--${position} is-in`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的收走动作负责
      // 右锚点从右边缘缩放(纵向保持中心),拉大往左长、不往右冒出画;换卡居中时交给 hud.css 的中心缩放
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1, transformOrigin: position === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? "right center" : undefined }}
    >
      <div style={{ width: W, height: H, transformOrigin: "0 50%", transform: shiftY || fitZ < 1 ? `translateY(${(shiftY / sy).toFixed(2)}px) scale(${fitZ.toFixed(4)})` : undefined }}>
      <div
        data-fx-role="group"
        style={{
          position: "relative", width: W, height: H, borderRadius: 20,
          fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
          background: "linear-gradient(135deg, rgba(22,22,28,0.86) 0%, rgba(12,12,16,0.80) 100%)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.08)",
          filter: undefined,
          clipPath: `inset(0 ${((1 - reveal) * 100).toFixed(3)}% 0 0 round 20px)`,
          transform: `translateX(${((1 - pIn) * -24 + op * -10).toFixed(2)}px)`,
          opacity: Math.min(1, pIn * 1.6) * (1 - o * o),
        }}
      >
        <div
          style={{
            position: "absolute", inset: 0, borderRadius: 20, pointerEvents: "none", opacity: glowOp,
            background: `radial-gradient(420px 220px at 0% 0%, ${tRgba(acc, 0.16)}, ${tRgba(acc, 0)} 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute", left: 0, top: 34, width: 5, height: H - 68, borderRadius: "0 3px 3px 0",
            background: `linear-gradient(180deg, ${tRgba(acc, 1)}, ${tRgba(accDark, 1)})`,
            transformOrigin: "50% 0", transform: `scaleY(${barK.toFixed(4)})`,
          }}
        />
        <div style={{ position: "absolute", left: TP.padL, top: TP.padT, right: TP.padR }}>
          {enFit && (
            <div style={{ display: "flex", alignItems: "flex-start", transform: `translateY(${cLift.toFixed(2)}px)` }}>
              <div style={{ position: "relative", flex: "none", width: 28, height: 28, marginRight: 14 }}>
                {rings.map((r, k) => (
                  <div
                    key={k}
                    style={{
                      position: "absolute", left: 0, top: 0, width: 28, height: 28, borderRadius: "50%", boxSizing: "border-box",
                      border: `2px solid ${tRgba(acc, 1)}`, opacity: r ? r.o : 0, transform: `scale(${r ? r.s.toFixed(4) : 0})`,
                    }}
                  />
                ))}
                <div
                  style={{
                    position: "absolute", left: 9, top: 9, width: 10, height: 10, borderRadius: "50%",
                    background: tRgba(acc, 1), boxShadow: `0 0 12px ${tRgba(acc, 0.8)}`,
                    opacity: cOut, transform: `scale(${cp.toFixed(4)})`,
                  }}
                />
              </div>
              <div
                data-small-text="en"
                style={{
                  fontFamily: T_MONO, fontSize: enFit.fs, fontWeight: 600, color: tRgba(acc, 1), whiteSpace: "nowrap",
                  lineHeight: `${TP.headH}px`, letterSpacing: `${(0.62 - 0.3 * ePro).toFixed(3)}em`,
                }}
              >
                {enFit.lines.map((line, li) => (
                  <div key={li}>
                    {line.map((ch, ci) => {
                      const i = enIdx++;
                      const p = tOutCubic(tProg(ts, 0.12 + i * 0.035, 0.42 + i * 0.035));
                      return (
                        <span key={ci} style={{ display: "inline-block", whiteSpace: "pre", opacity: p * cOut }}>
                          {ch.c}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div
            data-fx-role="label"
            style={{
              marginTop: enFit ? TP.termGap : 0, fontSize: termFit.fs, lineHeight: `${termLH}px`, fontWeight: 700,
              color: "#fff", letterSpacing: `${termLS.toFixed(4)}em`, whiteSpace: "nowrap",
            }}
          >
            {/* 术语:逐字从模糊中浮出(遮罩感 + 轻微回弹);换行时字序接着往下数 */}
            {termFit.lines.map((line, li) => (
              <div key={li} style={{ height: termLH }}>
                {line.map((ch, ci) => {
                  const i = termIdx++;
                  const a = 0.16 + i * 0.07;
                  const p = tProg(ts, a, a + 0.6);
                  const y = (1 - tSpring(p)) * 54 * (termFit.fs / TP.termFs);
                  const blur = (1 - tOutCubic(p)) * 14;
                  return (
                    <span
                      key={ci}
                      style={{
                        display: "inline-block", whiteSpace: "pre",
                        opacity: tOutCubic(tProg(ts, a, a + 0.35)) * cOut,
                        transform: `translateY(${(y + cLift * (1 + i * 0.15)).toFixed(2)}px)`,
                        filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none",
                      }}
                    >
                      {ch.c}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          {/* 分隔线:从左画出 */}
          <div
            style={{
              marginTop: TP.ruleGap, height: 1, width: "100%", background: "rgba(255,255,255,0.22)",
              transformOrigin: "0 50%", transform: `scaleX(${ruleK.toFixed(4)})`,
            }}
          />
          {/* 定义句:上浮淡入 */}
          <div
            data-fx-role="excerpt"
            style={{
              marginTop: TP.defGap, fontSize: defFit.fs, lineHeight: `${defLH}px`, fontWeight: 500,
              color: "rgba(255,255,255,0.88)", whiteSpace: "nowrap",
              opacity: dp * cOut, transform: `translateY(${((1 - dp) * 18 + cLift).toFixed(2)}px)`,
            }}
          >
            {defFit.lines.map((line, li) => {
              // 一行拆成普通段 / 关键词段
              const segs: { key: boolean; s: string }[] = [];
              line.forEach((ch) => {
                const last = segs[segs.length - 1];
                if (last && last.key === ch.key) last.s += ch.c;
                else segs.push({ key: ch.key, s: ch.c });
              });
              return (
                <div key={li}>
                  {segs.map((sg, si) => {
                    if (!sg.key) return <span key={si} style={{ whiteSpace: "pre" }}>{sg.s}</span>;
                    const kw = Math.max(1, Array.from(sg.s).reduce((w, c) => w + tEm(c), 0) * defFit.fs);
                    return (
                      <span key={si} style={{ position: "relative", whiteSpace: "pre", color: keyColor, fontWeight: 600 }}>
                        {sg.s}
                        <svg
                          viewBox={`0 0 ${kw.toFixed(1)} 6`}
                          preserveAspectRatio="none"
                          style={{ position: "absolute", left: 0, bottom: -8 * du, width: "100%", height: 6 * du, overflow: "visible" }}
                        >
                          <line
                            x1="0" y1="3" x2={(kw * lp).toFixed(2)} y2="3"
                            stroke={tRgba(acc, 1)} strokeWidth={3} strokeLinecap="round"
                            strokeDasharray={`${(7 * du).toFixed(2)} ${(7 * du).toFixed(2)}`}
                            strokeDashoffset={(-flow * du).toFixed(2)}
                            opacity={lp > 0.01 ? 1 - oc : 0}
                          />
                        </svg>
                      </span>
                    );
                  })}
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



export const termCardDef: EffectDef<TermCardParams> = {
  id: "term-card",
  name: "TermCard",
  description: "术语解释卡 · 名词 + 一句人话定义",
  tags: ["玻璃虚化"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "right",
    en: "Term Card",
    term: "术语卡",
    def: "视频里蹦出新名词时,用一句话给它下定义。",
    accent: "blue",
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
    { key: "en", label: "英文/拼音(可空)", type: "text" },
    { key: "term", label: "术语", type: "text" },
    { key: "def", label: "一句话定义", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: TermCard,
};
