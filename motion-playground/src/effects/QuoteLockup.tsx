import type { ReactElement } from "react";
import type { EffectDef, EffectProps } from "./types";
import { useCardElapsed, usePlateSpeed } from "./hud/useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./hud/accent";

export interface QuoteLockupParams {
  theme: "dark" | "light";
  side: "left" | "right";
  quote: string;
  author: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}


/* ══════════ 精修版:照隔离 Opus 原作逐拍移植(renderAt 纯函数 → t 的纯函数) ══════════ */

const qClamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const qProg = (t: number, a: number, b: number) => qClamp((t - a) / (b - a), 0, 1);
const qOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const qOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);
const qInCubic = (x: number) => x * x * x;
const qInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
/** 欠阻尼弹簧:0→1,带一次轻微过冲(原作原样) */
function qSpring(x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 1 - Math.exp(-6.5 * x) * Math.cos(9.5 * x);
}
const qLerp = (a: number, b: number, k: number) => a + (b - a) * k;

/* ── 安全区排版(字宽估算,导出逐帧确定;偏差靠 Q_SAFE 留余量) ── */
const Q_SAFE = 0.96;
const qIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const qIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
function qCharEm(c: string) {
  if (qIsWide(c)) return 1;
  if (c === " ") return 0.3;
  if (/[A-Z0-9]/.test(c)) return 0.66;
  if (/[a-z]/.test(c)) return 0.56;
  return 0.4;
}
/** 卡片(缩放前)最大宽:不越人脸线(左锚右缘 ≤700,右锚左缘 ≥1220) */
function qMaxWidth(side: string, scale: number, ox: number) {
  const SW = 1920;
  // 人脸线只按默认大小(scale=1)、默认位置(offsetX=0)算:用户拉大就真的变大、拖开只平移;按真实大小/偏移只防出画(离边 48)
  return Math.min(qWidthWithin(SW, side, 1, 0, 1220), qWidthWithin(SW, side, scale, ox, 48));
}
/** 卡的远端边离远端画面边至少 limit 时的最大宽(横版人脸线 = 1220) */
function qWidthWithin(SW: number, side: string, scale: number, ox: number, limit: number) {
  const s = Math.max(0.2, scale);
  if (side !== "right") return (SW - limit - 120 - ox) / s;
  // 右锚点 right:120,根元素 transformOrigin 在右边:右缘固定 = SW−120+ox,左缘 = 右缘 − W·s(放大只往左长)
  return (SW - 120 + ox - limit) / s;
}

/** mark:0 普通 / 1 被划掉(铺垫里的旧说法) / 2 重点(黄字+下划线+高光);run = 同一个词的序号 */
type QChar = { c: string; mark: 0 | 1 | 2; run: number };

/** 拆标记:*重点* / ~划掉~;没写标记时自动找「不从A…|而是从B…」这类对仗:A 划掉、B 高亮 */
function qParse(lines: string[]): QChar[][] {
  let run = 0;
  const marked = lines.some((l) => /\*[^*]+\*|~[^~]+~/.test(l));
  const parsed = lines.map((l) =>
    l
      .split(/(\*[^*]+\*|~[^~]+~)/)
      .filter(Boolean)
      .flatMap((seg) => {
        const m: 0 | 1 | 2 = seg.length > 2 && seg[0] === "*" && seg.endsWith("*") ? 2 : seg.length > 2 && seg[0] === "~" && seg.endsWith("~") ? 1 : 0;
        const body = m ? seg.slice(1, -1) : seg;
        const r = m ? run++ : -1;
        return Array.from(body).map((c) => ({ c, mark: m, run: r }));
      }),
  );
  if (marked || parsed.length < 2) return parsed;
  // 对仗:去掉两行共同的尾巴(如「开始」),再找第二行里最靠后、第一行也有的「锚字」(如「从」「是」),锚字之后到尾巴之前就是对比的两个词
  const a = parsed[parsed.length - 2];
  const b = parsed[parsed.length - 1];
  const isPunct = (c: string) => /[\s，。、！？：；,.!?:;…—\-「」『』《》“”"']/.test(c);
  let suf = 0;
  while (suf < a.length - 1 && suf < b.length - 1 && a[a.length - 1 - suf].c === b[b.length - 1 - suf].c) suf++;
  const aEnd = a.length - suf;
  const bEnd = b.length - suf;
  for (let j = bEnd - 2; j >= 0; j--) {
    const tb = bEnd - 1 - j;
    if (tb > 6 || isPunct(b[j].c)) continue;
    for (let i = aEnd - 2; i >= 0; i--) {
      const ta = aEnd - 1 - i;
      if (ta > 6) break;
      if (a[i].c !== b[j].c) continue;
      const wa = a.slice(i + 1, aEnd);
      const wb = b.slice(j + 1, bEnd);
      if (wa.some((x) => isPunct(x.c)) || wb.some((x) => isPunct(x.c))) continue;
      if (wa.some((x) => wb.some((y) => y.c === x.c))) continue; // 对比的两个词不该有同一个字(「始的」对「始」不算)
      const ra = run++;
      const rb = run++;
      wa.forEach((x) => { x.mark = 1; x.run = ra; });
      wb.forEach((x) => { x.mark = 2; x.run = rb; });
      return parsed;
    }
  }
  return parsed;
}

const qWidth = (cs: QChar[], fs: number, ls: number) => cs.reduce((w, ch) => w + (qCharEm(ch.c) + ls) * fs, 0);
/** 先换行(最多两行,自然断开)再缩字号;两行到下限还放不下才贪心折多行 */
function qFit(cs: QChar[], maxW: number, base: number, min: number, ls: number): { fs: number; lines: QChar[][] } {
  for (let fs = base; fs >= Math.max(min, base * 0.9); fs--) if (qWidth(cs, fs, ls) <= maxW) return { fs, lines: [cs] };
  let best: { at: number; cost: number } | null = null;
  const total = qWidth(cs, 1, ls);
  for (let i = 1; i < cs.length; i++) {
    const x = cs[i - 1];
    const y = cs[i];
    if (qIsWord(x.c) && qIsWord(y.c)) continue; // 英文单词不拆
    if (/[，。、！？：；,.!?:;）)」』》”]/.test(y.c)) continue; // 标点不放行首
    const left = qWidth(cs.slice(0, i), 1, ls);
    const inWord = x.run >= 0 && x.run === y.run;
    const cost = Math.max(left, total - left) * (inWord ? 1.3 : 1) * (x.c === " " || /[，,、；;：:]/.test(x.c) ? 0.9 : 1);
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  if (best) {
    const two = [cs.slice(0, best.at), cs.slice(best.at)].map((l) => (l[0]?.c === " " ? l.slice(1) : l));
    for (let fs = base; fs >= min; fs--) if (Math.max(...two.map((l) => qWidth(l, fs, ls))) <= maxW) return { fs, lines: two };
  }
  const lines: QChar[][] = [[]];
  cs.forEach((ch) => {
    const cur = lines[lines.length - 1];
    if (cur.length && qWidth([...cur, ch], min, ls) > maxW) lines.push(ch.c === " " ? [] : [ch]);
    else cur.push(ch);
  });
  return { fs: min, lines: lines.filter((l) => l.length) };
}

function QuoteLockup({ params, playToken }: EffectProps<QuoteLockupParams>) {
  const { side, quote, author, accent } = params;
  const extra = params as { __t?: number; __start?: number; __end?: number; scale?: number; __scale?: number };
  const tRaw = useCardElapsed(extra, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const acc = ACCENT_VAR[accent] ?? ACCENT_VAR.blue;
  const dur = typeof extra.__end === "number" ? Math.max(0, extra.__end - (extra.__start ?? 0)) : null;
  const t = dur == null ? tRaw : Math.min(tRaw, dur);
  const OUT = dur == null ? Infinity : dur - 0.5 / spd; // 最后 0.5s 收走
  const DUR = dur ?? Infinity;

  // ── 内容:最后一行是重点(粗、大),前面的是铺垫(细、小、之后变淡) ──
  const rawLines = quote.split("|").map((l) => l.trim()).filter(Boolean);
  const parsed = qParse(rawLines.length ? rawLines : [""]);
  const leadSrc = parsed.slice(0, -1);
  const mainSrc = parsed[parsed.length - 1];
  const sign = (author ?? "").replace(/^[\s—–―－\-~·]+/, "").trim();

  // ── 排版:卡宽默认 560(原作),内容长就放宽,不越过安全区;放不下先换行再缩 ──
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const maxCardW = qMaxWidth(side, cardScale, params.offsetX ?? 0) * Q_SAFE;
  const PADL = 52;
  const PADR = 40;
  const need = Math.max(qWidth(mainSrc, 66, 0.04), ...leadSrc.map((l) => qWidth(l, 44, 0.06))) + PADL + PADR;
  const W = Math.round(Math.min(maxCardW, Math.max(560, need)));
  const avail = W - PADL - PADR;
  const leadFits = leadSrc.map((l) => qFit(l, avail, 44, 30, 0.06));
  const leadF = leadFits.length ? Math.min(...leadFits.map((f) => f.fs)) : 44;
  const leadLines = leadFits.flatMap((f) => f.lines);
  const mainFit = qFit(mainSrc, avail, 66, 44, 0.04);
  const mainF = mainFit.fs;
  const signBar = 40 + 14;
  const signF = sign ? Math.max(18, Math.min(26, (avail - signBar) / (Array.from(sign).reduce((w, c) => w + qCharEm(c) + 0.12, 0) || 1))) : 26;
  const signWrap = sign ? Array.from(sign).reduce((w, c) => w + (qCharEm(c) + 0.12) * signF, 0) > avail - signBar : false;

  // ── 节奏:原作 0.32 第一行 → 1.12 划线 → 1.35 第二行 → 2.05 下划线 → 2.35 署名;字数变了整体顺延 ──
  const nLead = leadLines.reduce((n, l) => n + l.length, 0);
  const nMain = mainFit.lines.reduce((n, l) => n + l.length, 0);
  const gLead = nLead > 1 ? Math.min(0.045, 0.7 / (nLead - 1)) : 0;
  const gMain = nMain > 1 ? Math.min(0.06, 0.7 / (nMain - 1)) : 0;
  const D = nLead ? 0.32 + (nLead - 1) * gLead - 0.68 : 0.32 - 1.35; // 没有铺垫行:重点行顶到 0.32 出
  const E = D + (nMain - 1) * gMain - 0.36; // 下划线/署名/高光跟着重点行最后一个字走
  const gLeadX = nLead > 1 ? Math.min(0.012, 0.1 / (nLead - 1)) : 0;
  const gMainX = nMain > 1 ? Math.min(0.014, 0.1 / (nMain - 1)) : 0;
  const exitK = (delay: number) => qInCubic(qProg(t, OUT + delay / spd, OUT + (delay + 0.32) / spd));
  const ts = t * spd; // 入场用的"1 倍速时间"

  // 呼吸:整卡极轻微漂浮
  const bob = Math.sin(ts * 1.6) * 2.2;
  // 1) 底板:从左侧竖条展开,退场向右收走
  const pIn = qOutQuint(qProg(ts, 0, 0.55));
  const pOut = qInCubic(qProg(t, OUT + 0.12 / spd, DUR));
  const rIn = qOutCubic(qProg(ts, 0, 0.3));
  const rOut = qInCubic(qProg(t, OUT, OUT + 0.28 / spd));
  // 2) 引号:弹出
  const qk = qSpring(qProg(ts, 0.18, 0.95));
  const qo = exitK(0);
  // 第一行在第二行到来时退成背景
  const dim = qOutCubic(qProg(ts, 1.25 + D, 1.75 + D));
  // 4) 删除线
  const sk = qOutQuint(qProg(ts, 1.12 + D, 1.48 + D));
  const se = exitK(0);
  // 6) 下划线 + 高光 + 呼吸光
  const uk = qOutQuint(qProg(ts, 2.05 + E, 2.5 + E));
  const ue = exitK(0.08);
  const sh = qProg(ts, 2.55 + E, 3.15 + E);
  const shOp = sh > 0 && sh < 1 ? Math.sin(sh * Math.PI) : 0;
  const glow = 0.35 + 0.25 * Math.sin((ts - 2.4 - E) * 3.0);
  const gOn = qProg(ts, 2.4 + E, 2.8 + E) * (1 - ue);
  // 7) 署名
  const gk = qOutCubic(qProg(ts, 2.35 + E, 2.85 + E));
  const ge = exitK(0.1);

  const CH_SH = "0 2px 10px rgba(0,0,0,0.35)";
  let li = 0;
  const leadChar = (ch: QChar, key: number) => {
    const i = li++;
    const k = qOutCubic(qProg(ts, 0.32 + i * gLead, 0.32 + i * gLead + 0.5));
    const e = exitK(i * gLeadX);
    return (
      <span
        key={key}
        style={{
          display: "inline-block", position: "relative", textShadow: CH_SH, whiteSpace: "pre",
          opacity: +(k * (1 - e)).toFixed(4),
          transform: `translateY(${((1 - k) * 22 - e * 16).toFixed(2)}px)`,
          filter: `blur(${((1 - k) * 8 + e * 6).toFixed(2)}px)`,
        }}
      >
        {ch.c}
      </span>
    );
  };
  let mi = 0;
  const mainChar = (ch: QChar, key: number) => {
    const j = mi++;
    const a0 = 1.35 + D + j * gMain;
    const k2 = qSpring(qProg(ts, a0, a0 + 0.7));
    const o2 = qOutCubic(qProg(ts, a0, a0 + 0.22));
    const e2 = exitK(0.06 + j * gMainX);
    const hiOn = ch.mark === 2;
    return (
      <span
        key={key}
        style={{
          display: "inline-block", position: "relative", whiteSpace: "pre",
          color: hiOn ? acc : undefined,
          textShadow: hiOn
            ? `${CH_SH}, 0 0 ${(18 * gOn).toFixed(2)}px color-mix(in srgb, ${acc} ${(glow * gOn * 100).toFixed(1)}%, transparent)`
            : CH_SH,
          opacity: +(o2 * (1 - e2)).toFixed(4),
          transform: `translateY(${((1 - k2) * 46 - e2 * 18).toFixed(2)}px)`,
          filter: `blur(${((1 - o2) * 6 + e2 * 6).toFixed(2)}px)`,
          clipPath: `inset(-20% -10% ${(e2 > 0 ? 0 : (1 - o2) * 60).toFixed(2)}% -10%)`,
        }}
      >
        {ch.c}
      </span>
    );
  };
  // 一行里把连续同一个词的字并成一块,划线/下划线/高光挂在这块上(词被折行时两行各一段)
  const renderLine = (cs: QChar[], one: (ch: QChar, key: number) => ReactElement) => {
    const pieces: QChar[][] = [];
    cs.forEach((ch) => {
      const last = pieces[pieces.length - 1];
      if (last && last[0].run === ch.run && last[0].mark === ch.mark) last.push(ch);
      else pieces.push([ch]);
    });
    return pieces.map((pc, pi) => {
      const kids = pc.map((ch, ci) => one(ch, ci));
      if (pc[0].mark === 0) return kids;
      return (
        <span key={`w${pi}`} style={{ position: "relative", display: "inline-block" }}>
          {kids}
          {pc[0].mark === 1 && (
            <span
              style={{
                position: "absolute", left: -4, right: 0, top: "54%", height: 3, background: acc, borderRadius: 2,
                transformOrigin: "0 50%", transform: `scaleX(${sk.toFixed(4)})`, opacity: +(1 - se).toFixed(4),
              }}
            />
          )}
          {pc[0].mark === 2 && (
            <>
              <span
                style={{
                  position: "absolute", left: 0, right: 6, top: "calc(100% - 2px)", height: 8, background: acc, borderRadius: 4,
                  transformOrigin: "0 50%", transform: `scaleX(${(uk * (1 - ue)).toFixed(4)})`, opacity: 0.9,
                }}
              />
              <span
                style={{
                  position: "absolute", top: 0, height: "100%", width: 120, pointerEvents: "none",
                  left: `calc(${(qInOutSine(sh) * 100).toFixed(2)}% - ${((1 - qInOutSine(sh)) * 120).toFixed(2)}px)`,
                  background: "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,244,214,0.55) 50%, rgba(255,255,255,0) 100%)",
                  mixBlendMode: "overlay", opacity: +shOp.toFixed(4),
                }}
              />
            </>
          )}
        </span>
      );
    });
  };

  return (
    // 有终点时退场自己收(逐字下沉+底板向右收),行内 opacity:1 盖掉 hud.css 通用的 [data-outro] .hud 淡出
    // 右锚点从右边缘缩放(纵向保持中心),拉大往左长;换卡居中时交给 hud.css 的中心缩放
    <div className={`hud hud-anchor hud-anchor--${side}`} style={{ ...offsetVars(params), ...(dur != null ? { opacity: 1 } : null), transformOrigin: side === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? "right center" : undefined }}>
      <div
        style={{
          position: "relative", width: W, boxSizing: "border-box",
          padding: `66px ${PADR}px 30px ${PADL}px`,
          fontFamily: 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)',
          color: "#fff",
          transform: `translate(${((1 - pIn) * 24 + pOut * 30).toFixed(2)}px,${bob.toFixed(3)}px)`,
          filter: undefined,
        }}
      >
        <div
          style={{
            position: "absolute", inset: 0, borderRadius: 6, display: undefined,
            background: "linear-gradient(135deg, rgba(28,24,20,0.86) 0%, rgba(16,14,12,0.80) 100%)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.06)",
            clipPath: `inset(0 ${((1 - pIn) * 100).toFixed(3)}% 0 ${(pOut * 100).toFixed(3)}% round 6px)`,
          }}
        />
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: 5, height: "100%", background: acc, borderRadius: 3,
            transformOrigin: rOut > 0 ? "50% 100%" : "50% 0", transform: `scaleY(${(rIn * (1 - rOut)).toFixed(4)})`,
          }}
        />
        <div
          style={{
            position: "absolute", left: 30, top: -78, fontFamily: '"Songti SC", "STSong", serif', fontSize: 230, lineHeight: 1,
            color: acc, fontWeight: 900, textShadow: "0 6px 20px rgba(0,0,0,0.25)", transformOrigin: "30% 70%",
            opacity: +(qProg(ts, 0.18, 0.35) * (1 - qo)).toFixed(4),
            transform: `translateY(${((1 - qk) * 30 - qo * 20).toFixed(2)}px) scale(${(0.6 + 0.4 * qk).toFixed(4)}) rotate(${((1 - qk) * -12).toFixed(2)}deg)`,
          }}
        >
          &ldquo;
        </div>
        {leadLines.map((ln, i) => (
          <div
            key={`l${i}`}
            style={{
              position: "relative", whiteSpace: "nowrap", fontSize: leadF, lineHeight: 1.4, fontWeight: 300, letterSpacing: "0.06em",
              color: `rgba(255,255,255,${qLerp(1, 0.62, dim).toFixed(3)})`,
            }}
          >
            {renderLine(ln, leadChar)}
          </div>
        ))}
        {mainFit.lines.map((ln, i) => (
          <div
            key={`m${i}`}
            style={{
              position: "relative", whiteSpace: "nowrap", fontSize: mainF, lineHeight: 1.4, fontWeight: 600, letterSpacing: "0.04em",
              marginTop: i === 0 && leadLines.length ? 6 : 0,
            }}
          >
            {renderLine(ln, mainChar)}
          </div>
        ))}
        <div
          style={{
            display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, marginTop: 8, marginRight: 8,
            fontSize: signF, lineHeight: 1.4, fontWeight: 400, color: "rgba(255,255,255,0.72)", letterSpacing: "0.12em",
            visibility: sign ? "visible" : "hidden",
          }}
        >
          <span
            style={{
              width: 40, height: 2, flex: "none", background: `color-mix(in srgb, ${acc} 90%, transparent)`,
              transformOrigin: "100% 50%", transform: `scaleX(${(gk * (1 - ge)).toFixed(4)})`,
            }}
          />
          <span
            data-small-text="author"
            style={{
              display: "inline-block", whiteSpace: signWrap ? "normal" : "nowrap", maxWidth: avail - signBar,
              ...(signWrap ? ({ textWrap: "balance" } as object) : null),
              opacity: +(gk * (1 - ge)).toFixed(4), transform: `translateX(${((1 - gk) * 14).toFixed(2)}px)`,
            }}
          >
            {sign || "\u00a0"}
          </span>
        </div>
      </div>
    </div>
  );
}


export const quoteLockupDef: EffectDef<QuoteLockupParams> = {
  id: "quote-lockup",
  name: "QuoteLockup",
  description: "金句定格卡 · 逐行揭示后定格",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    side: "right",
    quote: "多行金句|逐行揭示,|停在画面上。",
    author: "— 署名放这里",
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "side",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "quote", label: "金句(用 | 分行)", type: "text" },
    { key: "author", label: "署名", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: QuoteLockup,
};
