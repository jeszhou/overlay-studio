import type { EffectDef, EffectProps } from "../types";
import type { CSSProperties } from "react";
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

export interface BlurTextParams {
  theme: "dark" | "light";
  position: "center" | "top" | "bottom";
  text: string; // 词块 | 分隔,*关键词* 高亮
  staggerMs: number; // 每块间隔
  accent: string;
  /** 动法:rise 上浮对焦(原版) / drift 侧飘收拢 / zoom 拉焦 / bloom 关键词发光;缺省 = rise */
  motion?: "rise" | "drift" | "zoom" | "bloom";
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

/** React Bits「Blur Text」风格:词块从模糊中逐个浮现(情绪款) */

/* ───────── 精修版:逐帧照搬参考作品 board.html 的 renderAt(t) ─────────
   全部画面是卡片秒数 t 的纯函数(导出逐帧确定);只用行内样式,不吃 hud.css 的 .bt-* 规则。
   无边框柔光暗场先亮;逐字从虚焦里浮现(模糊 outQuint 收得快、透明度和上浮 outCubic 收得慢);
   两行时第一行是小字题注(宽字距 + 两侧短线),第二行是主句;*关键词* 用强调色、失焦更深放大更多,
   落定后亮一下留余温,再从左到右画出一笔细线;整块从 0.985 缓慢靠前到 1;
   最后 0.4 秒逐字重新失焦、上飘、淡出,暗场最后离开。
   尺寸:参考作品是这张卡 scale 1.55 下的样子,参考像素 ÷ 1.55 = 卡内像素(scale 1 时主句 59px,和原卡 64px 同档)。 */
const BP_FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const BP_REF = 1.55;
const BP_EXIT = 0.4;
const BP_INK = "#FBF7F0";
const BP_SPEC = {
  title: { font: 46, weight: 400, ls: 0.32, lh: 65, ink: "rgba(251,247,240,0.86)" },
  main: { font: 92, weight: 600, ls: 0.06, lh: 129, ink: BP_INK },
} as const;
const BP_TITLE_GAP = 5; // 题注行底到主句行顶
const BP_RULE_Y = 4; // 细线在字行下方
const bpClamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const bpLerp = (a: number, b: number, k: number) => a + (b - a) * k;
const bpOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const bpOutQuint = (k: number) => 1 - Math.pow(1 - k, 5);
const bpInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const bpInCubic = (k: number) => k * k * k;
const bpProg = (t: number, s: number, d: number) => bpClamp((t - s) / d, 0, 1);

/* ── 字宽:用 canvas 量(和渲染同一套系统字体);没有 canvas 时按字符类别估 ── */
let bpCtx: CanvasRenderingContext2D | null | undefined;
const bpWidthCache = new Map<string, number>();
function bpEm(s: string, weight: number) {
  const key = `${weight}|${s}`;
  let em = bpWidthCache.get(key);
  if (em == null) {
    if (bpCtx === undefined) bpCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (bpCtx) {
      bpCtx.font = `${weight} 100px ${BP_FONT}`;
      em = bpCtx.measureText(s).width / 100;
    } else {
      em = Array.from(s).reduce((w, c) => w + ((c.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : /[A-Z0-9]/.test(c) ? 0.66 : 0.56), 0);
    }
    bpWidthCache.set(key, em);
  }
  return em;
}

type BpKind = keyof typeof BP_SPEC;
/** 一个排版单元:中文/标点逐字;英文数字连成一个词(不拆);空格是 0.12em 的小缝。acc = 关键词段序号,-1 = 普通 */
type BpUnit = { s: string; type: "ch" | "latin" | "sp"; acc: number; wide?: boolean };
function bpUnits(line: string, accBase: { n: number }): BpUnit[] {
  const out: BpUnit[] = [];
  line.split(/(\*[^*]+\*)/).filter(Boolean).forEach((seg) => {
    const isKey = seg.length > 2 && seg.startsWith("*") && seg.endsWith("*");
    const acc = isKey ? accBase.n++ : -1;
    const body = isKey ? seg.slice(1, -1) : seg;
    (body.match(/[A-Za-z0-9]+(?:['’.\-][A-Za-z0-9]+)*|\s+|[\s\S]/gu) ?? []).forEach((tok) => {
      if (/^\s+$/.test(tok)) out.push({ s: " ", type: "sp", acc });
      else if (/^[A-Za-z0-9]/.test(tok)) out.push({ s: tok, type: "latin", acc });
      else out.push({ s: tok, type: "ch", acc });
    });
  });
  // 两个英文词之间的空格要像正常词距(0.3em),中英之间才是 0.12em 的小缝
  out.forEach((u, i) => {
    if (u.type === "sp" && out[i - 1]?.type === "latin" && out[i + 1]?.type === "latin") u.wide = true;
  });
  return bpTrim(out);
}
const bpTrim = (u: BpUnit[]) => {
  let a = 0;
  let b = u.length;
  while (a < b && u[a].type === "sp") a++;
  while (b > a && u[b - 1].type === "sp") b--;
  return u.slice(a, b);
};
const bpIsPunct = (u: BpUnit) => /^[，。、！？：；,.!?:;）)」』》”’…—]$/.test(u.s);
/** 单元宽(px):字宽 + 行字距;英文词自带 0.08em 字距;空格 0.12em */
function bpUnitW(u: BpUnit, kind: BpKind, F: number) {
  const sp = BP_SPEC[kind];
  if (u.type === "sp") return (u.wide ? 0.3 : 0.12) * F;
  // 英文词内部 0.08em 字距,词尾和中文字一样留出行字距(参考作品里「AI 时 代」是等距的)
  if (u.type === "latin") return (bpEm(u.s, sp.weight) + 0.08 * u.s.length + Math.max(0, sp.ls - 0.08)) * F;
  return (bpEm(u.s, sp.weight) + sp.ls) * F;
}
/** 整行宽:单元宽之和 + 行首缩进(= 字距,和参考作品 text-indent 一样把末字的字距配平) */
const bpRowW = (u: BpUnit[], kind: BpKind, F: number) => u.reduce((w, x) => w + bpUnitW(x, kind, F), 0) + BP_SPEC[kind].ls * F;

/** 最多两行:最均衡、不拆英文词、行首不放标点、尽量不拆关键词;不需要拆返回 [] ,拆不下返回 null */
function bpBreak2(u: BpUnit[], kind: BpKind, F: number, maxW: number): BpUnit[][] | null {
  if (bpRowW(u, kind, F) <= maxW) return [u];
  let best: { a: BpUnit[]; b: BpUnit[]; cost: number } | null = null;
  for (let i = 1; i < u.length; i++) {
    if (bpIsPunct(u[i])) continue;
    const a = bpTrim(u.slice(0, i));
    const b = bpTrim(u.slice(i));
    if (!a.length || !b.length) continue;
    const w = Math.max(bpRowW(a, kind, F), bpRowW(b, kind, F));
    if (w > maxW) continue;
    const inKey = u[i - 1].acc >= 0 && u[i - 1].acc === u[i].acc;
    const afterPunct = bpIsPunct(u[i - 1]) || (u[i - 1].type === "sp" && i > 1 && bpIsPunct(u[i - 2]));
    const cost = w * (inKey ? 1.5 : 1) * (afterPunct ? 0.75 : 1); // 有逗号就优先在逗号后断
    if (!best || cost < best.cost) best = { a, b, cost };
  }
  return best ? [best.a, best.b] : null;
}
/** 兜底:按宽度贪心折行(宁可多一行也不出画) */
function bpGreedy(u: BpUnit[], kind: BpKind, F: number, maxW: number): BpUnit[][] {
  const rows: BpUnit[][] = [];
  let cur: BpUnit[] = [];
  u.forEach((x) => {
    const next = [...cur, x];
    if (cur.length && bpRowW(bpTrim(next), kind, F) > maxW && !bpIsPunct(x)) {
      rows.push(bpTrim(cur));
      cur = [x];
    } else cur = next;
  });
  if (bpTrim(cur).length) rows.push(bpTrim(cur));
  return rows;
}

type BpRow = { units: BpUnit[]; kind: BpKind; F: number; lh: number; w: number; top: number; line: number };
/** z = 参考像素 → 卡内像素的系数;mode:one 每行不拆 / two 每行最多拆两行 / greedy 兜底 */
function bpLayout(lines: BpUnit[][], kinds: BpKind[], z: number, maxW: number, mode: "one" | "two" | "greedy") {
  const rows: BpRow[] = [];
  let top = 0;
  let W = 0;
  for (let i = 0; i < lines.length; i++) {
    const kind = kinds[i];
    const sp = BP_SPEC[kind];
    const F = sp.font * z;
    const avail = kind === "title" ? maxW - 196 * z : maxW; // 题注两侧还要放短线(间隔 34 + 线长 64)
    let parts: BpUnit[][] | null;
    if (mode === "one") parts = bpRowW(lines[i], kind, F) <= avail ? [lines[i]] : null;
    else if (mode === "two") parts = bpBreak2(lines[i], kind, F, avail);
    else parts = bpGreedy(lines[i], kind, F, avail);
    if (!parts) return null;
    if (i > 0 && kinds[i - 1] === "title") top += BP_TITLE_GAP * z;
    for (const p of parts) {
      const w = bpRowW(p, kind, F);
      rows.push({ units: p, kind, F, lh: sp.lh * z, w, top, line: i });
      W = Math.max(W, kind === "title" ? w + 196 * z : w);
      top += sp.lh * z;
    }
  }
  return { rows, W, H: top + (BP_RULE_Y + 4) * z };
}

function BlurText({ params, playToken }: EffectProps<BlurTextParams>) {
  const { position, text, staggerMs, accent } = params;
  const tp = params as BlurTextParams & { __t?: number; __start?: number; __end?: number };
  const tRaw = useCardElapsed(tp, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const dur = typeof tp.__end === "number" ? Math.max(0, tp.__end - (tp.__start ?? 0)) : null;
  const t = Math.max(0, dur == null ? tRaw : Math.min(tRaw, dur));
  const acc = ACCENT_VAR[accent] ?? ACCENT_VAR.orange;

  // ── 内容:| 分行;两行时第一行是小字题注、第二行主句;一行 / 三行以上全按主句排 ──
  const accN = { n: 0 };
  const lines0 = (text || "").split("|").map((s) => bpUnits(s.trim(), accN)).filter((u) => u.length);
  const lines = lines0.length ? lines0 : [[{ s: " ", type: "sp" as const, acc: -1 }]];
  const n = lines.length;
  const kinds: BpKind[] = lines.map((_, i) => (n === 2 && i === 0 ? "title" : "main"));

  // ── 安全区:三种落位都水平居中于 cx、按 scale 绕中心放大 ──
  const extra = params as { scale?: number; __scale?: number };
  const s = Math.max(0.2, (Number(extra.scale) || 1) * (Number(extra.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const oy = params.offsetY ?? 0;
  const SW = 1920;
  const SH = 1080;
  const cx = SW / 2 + ox;
  // 人脸线 / 脸下方那条带只按默认大小、默认位置(scale=1、offset=0)算:手动拖开或拉大排版锁住,
  // 拖开只平移、拉大就真变大;只有出画按真实 scale 和 offset 算
  const cx0 = SW / 2;
  // 横版居中会压脸:整块挪到人脸下方,上缘挂在 y=712(锚点改成顶挂、绕上缘中点缩放),offset 照常叠加
  const below = position === "center";
  const box = (H: number, oyv = oy, sv = s) => {
    let cy: number;
    if (below) cy = 712 + oyv + (H * sv) / 2;
    else if (position === "top") cy = 110 + oyv + H / 2;
    else if (position === "bottom") cy = SH - 120 + oyv - H / 2;
    else cy = SH / 2 + oyv;
    return { topE: cy - (H * sv) / 2, botE: cy + (H * sv) / 2 };
  };
  /** 允许的半宽(屏幕像素):和人脸同一高度时,挪到脸左/右侧就不越过人脸线;压在脸上挪不开就限宽(只能靠缩小) */
  const frameHalf = Math.min(cx - 48, SW - 48 - cx); // 出画:真实位置
  const faceHalf = (H: number) => {
    const { topE, botE } = box(H, 0, 1);
    if (topE < 700 && botE > 80) {
      if (cx0 - 1220 >= 160) return cx0 - 1220;
      if (700 - cx0 >= 160) return 700 - cx0;
      return 500;
    }
    return Infinity;
  };
  const fits = (L: { W: number; H: number }) => {
    const { topE, botE } = box(L.H);
    const d = box(L.H, 0, 1);
    const m = 24; // 横版上下留 24:参考作品字底就压在 y≈1000,暗场一直铺到画面底
    // 脸下方那条带(底边离画面底 ≥ 40)按默认大小/位置排;拉大/拖动后快出画在下面整块上移、再缩小
    if (below ? d.botE > SH - 40 : topE < m || botE > SH - m) return false;
    // 横版正对人脸那一列(挪不到脸侧)时,上缘不越过 y=700,压不开就继续缩
    if (cx0 - 1220 < 160 && 700 - cx0 < 160 && d.topE < 700 && d.botE > 80) return false;
    return L.W / 2 <= Math.max(60, faceHalf(L.H)) * 0.99 && (L.W * s) / 2 <= Math.max(60, frameHalf) * 0.99;
  };
  type BpL = NonNullable<ReturnType<typeof bpLayout>>;
  const z0 = 1 / BP_REF;
  const zMin = Math.min(z0, 44 / (BP_SPEC.main.font * s)); // 主句不小于 44px(题注随之 ≥ 22px)
  // 断行宽度上限两档:不受人脸限制的整宽 / 和人脸同高时的窄宽(卡内像素)
  const wides = [(2 * frameHalf * 0.99) / s, 2 * Math.min(frameHalf / s, Math.max(60, faceHalf(SH))) * 0.99];
  const tryLay = (z: number, mode: "one" | "two" | "greedy") => {
    for (const mw of wides) {
      const L = bpLayout(lines, kinds, z, mw, mode);
      if (L && fits(L)) return L;
    }
    return null;
  };
  let lay: BpL | null = null;
  // 只差一点(85% 以内)先微缩;再不行先拆两行、再缩字号;最后兜底按宽贪心折行
  for (let z = z0; z >= Math.max(zMin, z0 * 0.85) - 1e-6 && !lay; z -= z0 * 0.01) lay = tryLay(z, "one");
  for (let z = z0; z >= zMin - 1e-6 && !lay; z -= z0 * 0.01) lay = tryLay(z, "two");
  if (!lay) lay = tryLay(zMin, "greedy") ?? (bpLayout(lines, kinds, zMin, wides[1], "greedy") as BpL);
  const { rows, W, H } = lay as BpL;
  // 脸下方那条带(712~1040)最小字号也放不下:最后才整块缩小
  // 拉大 / 拖动后快出画(按真实 scale、offset):先整块挪回画内(底离画面底 40、顶离画面顶 24),还放不下再缩小
  const fitK = below ? Math.min(1, (1080 - 40 - 712) / H, (1080 - 40 - 24) / (H * s)) : 1;
  const bTop = 712 + oy;
  const bBot = bTop + H * s * fitK;
  const liftY = !below ? 0 : bBot > 1080 - 40 ? bBot - (1080 - 40) : bTop < 24 ? bTop - 24 : 0;
  const anchorFix = below
    ? ({ top: 712, bottom: "auto", ["--anchor-tf" as string]: "translateX(-50%)", transformOrigin: "50% 0" } as CSSProperties)
    : null;
  const z = rows[0].F / BP_SPEC[rows[0].kind].font;

  // ── 每个字的入场节奏(参考:题注每字 0.075s、时长 1.0、虚焦 16、上浮 10;主句每字 0.065s、时长 1.05/关键词 1.25、虚焦 20/26、上浮 14) ──
  const stagger = Math.max(0, (Number(staggerMs) || 420) / 1000);
  const lineCount = lines.map((u) => u.length);
  const seen = lines.map(() => 0);
  type BpPlan = { start: number; dur: number; blur: number; rise: number; acc: boolean };
  const plans: BpPlan[][] = rows.map((r) => {
    const cnt = lineCount[r.line];
    return r.units.map((u) => {
      const k = seen[r.line]++;
      const isAcc = u.acc >= 0;
      if (r.kind === "title") {
        const step = cnt > 1 ? Math.min(0.075, 0.9 / (cnt - 1)) : 0;
        return { start: r.line * stagger + k * step / spd, dur: 1.0 / spd, blur: 16, rise: 10, acc: isAcc };
      }
      const step = cnt > 1 ? Math.min(0.065, 0.9 / (cnt - 1)) : 0;
      return { start: r.line * stagger + k * step / spd, dur: (isAcc ? 1.25 : 1.05) / spd, blur: isAcc ? 26 : 20, rise: 14, acc: isAcc };
    });
  });
  const total = plans.reduce((a, p) => a + p.length, 0);
  const EXIT = BP_EXIT / spd;
  const exitStart = dur == null ? Infinity : dur - EXIT;
  const ex = bpProg(t, exitStart, EXIT);

  // 整体慢呼吸:整块极轻地向前靠;收尾再放大一点点
  const breathe = bpLerp(0.985, 1.0, bpOutCubic(bpProg(t, 0, 2.6 / spd)));
  const groupScale = breathe * (1 + 0.02 * bpInCubic(ex));

  // 暗场:先于文字一点点亮起,收尾时最后离开
  const sIn = bpInOut(bpProg(t, 0, 0.9 / spd));
  const sOut = 1 - bpInOut(bpProg(t, exitStart + 0.08 / spd, EXIT - 0.08 / spd));
  const padX = Math.max(160 * z, Math.min(288 * z, 0.35 * W));
  const shadow = `0 ${(2 * z).toFixed(2)}px ${(18 * z).toFixed(2)}px rgba(0,0,0,0.45), 0 ${z.toFixed(2)}px ${(2 * z).toFixed(2)}px rgba(0,0,0,0.35)`;

  // 第一行两侧短线(只在「题注 + 主句」两行时有)
  const tk = bpOutQuint(bpProg(t, 0.35 / spd, 1.0 / spd));
  const tOut = 1 - bpInCubic(bpProg(t, exitStart, EXIT * 0.6));
  // 关键词下划线:字落定后一笔画出(参考:关键词起点 0.42 → 1.55 落笔)
  const rOut = 1 - bpInCubic(bpProg(t, exitStart, EXIT * 0.7));

  let idx = 0;
  return (
    // 有终点时退场由自己收,行内 opacity:1 盖掉 hud.css 通用的 [data-outro] .hud 淡出,免得叠两层提前变淡
    <div className={`hud hud-anchor hud-anchor--${position}`} style={{ ...offsetVars(params), ...anchorFix, ...(dur != null ? { opacity: 1 } : null) }}>
      <div style={{ position: "relative", width: W, height: H, fontFamily: BP_FONT, WebkitFontSmoothing: "antialiased", filter: undefined, ...(fitK < 1 || liftY !== 0 ? { transform: `${liftY !== 0 ? `translateY(${(-liftY / s).toFixed(2)}px) ` : ""}scale(${fitK.toFixed(4)})`, transformOrigin: "50% 0" } : null) }}>
        <div
          style={{
            position: "absolute", left: -padX, top: -58 * z, width: W + 2 * padX, height: H + 143 * z, pointerEvents: "none", display: undefined,
            background:
              "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(14,10,8,0.72) 0%, rgba(14,10,8,0.58) 40%, rgba(14,10,8,0.24) 70%, rgba(14,10,8,0) 100%)",
            opacity: +(sIn * sOut).toFixed(4),
            transform: `scale(${bpLerp(0.92, 1, bpOutCubic(bpProg(t, 0, 1.6 / spd))).toFixed(4)})`,
          }}
        />
        {rows.map((r, ri) => {
          const sp = BP_SPEC[r.kind];
          const left = (W - r.w) / 2;
          const plan = plans[ri];
          // 单元的 x(行内,含行首缩进)
          let x = sp.ls * r.F;
          const xs = r.units.map((u) => {
            const x0 = x;
            x += bpUnitW(u, r.kind, r.F);
            return x0;
          });
          // 关键词连续段 → 一笔细线
          const runs: { a: number; b: number }[] = [];
          r.units.forEach((u, i) => {
            if (u.acc < 0) return;
            const last = runs[runs.length - 1];
            if (last && r.units[i - 1]?.acc === u.acc) last.b = u.type === "sp" ? last.b : i;
            else if (u.type !== "sp") runs.push({ a: i, b: i });
          });
          const isTickRow = r.kind === "title" && (ri === 0 || rows[ri - 1].kind !== "title");
          const w = 64 * z * tk;
          const gap = r.w / 2 + 34 * z;
          const base = idx;
          idx += r.units.length;
          return (
            <div key={ri}>
              {isTickRow &&
                [-1, 1].map((side) => (
                  <div
                    key={side}
                    style={{
                      position: "absolute", top: r.top + 31 * z, height: Math.max(1, 1.5 * z), width: w,
                      left: side < 0 ? W / 2 - gap - w : W / 2 + gap, background: "rgba(251,247,240,0.55)",
                      opacity: +(tk * tOut).toFixed(4),
                    }}
                  />
                ))}
              <div
                style={{
                  position: "absolute", left, top: r.top, width: r.w, height: r.lh, whiteSpace: "pre",
                  fontSize: r.F, fontWeight: sp.weight, lineHeight: `${r.lh}px`, color: sp.ink,
                  transformOrigin: "50% 50%", transform: `scale(${groupScale.toFixed(5)})`,
                }}
              >
                {r.units.map((u, i) => {
                  const p = plan[i];
                  const k = bpProg(t, p.start, p.dur);
                  let blur = p.blur * (1 - bpOutQuint(k)); // 焦点收得快
                  let op = bpOutCubic(bpProg(t, p.start, p.dur * 0.7));
                  let y = p.rise * (1 - bpOutCubic(k));
                  const sc = bpLerp(p.acc ? 1.12 : 1.06, 1, bpOutCubic(k));
                  // 收尾:从左到右依次重新失焦、上飘、淡出
                  const e = bpProg(t, exitStart + (base + i) * (0.14 / total / spd), EXIT - 0.15 / spd);
                  const ee = bpInCubic(e);
                  blur += 14 * ee;
                  op *= 1 - bpOutCubic(e);
                  y -= 12 * ee;
                  let ts = shadow;
                  if (p.acc) {
                    // 重点词:落定后亮一下,再退成余温
                    const g = bpProg(t, p.start + p.dur * 0.55, 0.9 / spd);
                    const glow = (Math.sin(Math.PI * g) * 0.75 + 0.22 * bpOutCubic(g)) * (1 - ee);
                    const pct = bpClamp(55 * glow, 0, 100);
                    ts = `0 0 ${((18 + 18 * glow) * z).toFixed(2)}px color-mix(in srgb, ${acc} ${pct.toFixed(1)}%, transparent), ${shadow}`;
                  }
                  return (
                    <span
                      key={i}
                      style={{
                        position: "absolute", left: xs[i], top: 0, display: "inline-block",
                        letterSpacing: u.type === "latin" ? "0.08em" : u.type === "sp" ? 0 : `${sp.ls}em`,
                        color: p.acc ? acc : undefined, textShadow: ts,
                        opacity: +op.toFixed(4), filter: blur * z > 0.05 ? `blur(${(blur * z).toFixed(2)}px)` : "none",
                        transform: `translateY(${(y * z).toFixed(2)}px) scale(${sc.toFixed(4)})`,
                      }}
                    >
                      {u.type === "sp" ? "" : u.s}
                    </span>
                  );
                })}
                {runs.map((rn, j) => {
                  const st = plan[rn.a].start + 1.13 / spd;
                  const rr = bpOutQuint(bpProg(t, st, 0.7 / spd));
                  const rl = xs[rn.a] + 6 * z;
                  const rw = xs[rn.b] + bpUnitW(r.units[rn.b], r.kind, r.F) - xs[rn.a] - 12 * z;
                  return (
                    <div
                      key={`r${j}`}
                      style={{
                        position: "absolute", left: rl, top: r.lh + BP_RULE_Y * z, width: Math.max(0, rw), height: 3 * z,
                        borderRadius: 2 * z, transformOrigin: "0 50%", transform: `scaleX(${rr.toFixed(4)})`,
                        background: `linear-gradient(90deg, transparent, ${acc} 22%, ${acc} 78%, transparent)`,
                        opacity: +(Math.min(1, rr * 3) * rOut * 0.9).toFixed(4),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export const blurTextDef: EffectDef<BlurTextParams> = {
  id: "blur-text",
  name: "BlurText",
  description: "模糊浮现 · 词块从虚焦中逐个清晰",
  tags: ["玻璃虚化", "逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    text: "走心的句子|从虚焦里|*慢慢浮现*",
    staggerMs: 420,
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
        { label: "居中", value: "center" },
        { label: "顶部", value: "top" },
        { label: "底部", value: "bottom" },
      ],
    },
    { key: "text", label: "词块(| 分隔,*关键词*)", type: "text" },
    { key: "staggerMs", label: "每块间隔", type: "range", min: 150, max: 1200, step: 30, unit: "ms" },
    { key: "accent", label: "关键词颜色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: BlurText,
};
