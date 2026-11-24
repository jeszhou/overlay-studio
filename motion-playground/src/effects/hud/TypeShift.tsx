import { useId } from "react";
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

export interface TypeShiftParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  lines: string; // 行,| 分隔;第一行会成为 hero
  shiftAtMs: number; // 何时"啪"地重排
  /** 新动效草稿框上的小角标,留空不显示 */
  draftTag?: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

/** 杂志排版流:先像草稿左错落,再"啪"地重排成层级版式 */
/* ───────────── 精修版:「从草稿到定稿」 ─────────────
   动法逐拍照搬隔离 Opus 的一次性作品(canvas 版 renderAt),改成 SVG/DOM。
   1.6s(shiftAtMs)前:细体逐字打出 + 闪烁光标 + 虚线框/基线辅助线/DRAFT 标签 + 字轻微歪斜晃动;
   转折那一拍:逐字弹簧跳到定稿位(带抛物线跳起)、细→粗、底板变深色实心圆角板、暖色扫光、角标外弹淡出;
   定稿:逗号退场换成留白、行错位成一组(首行靠左、末行靠右)、逗号后的半句上强调色、末句强调词下划出刃线、底板轻呼吸;
   有终点时最后 0.5s:字逐个上飘淡出、底板纵向收起。全部是 t 的纯函数。 */
const tpClamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const tpLerp = (a: number, b: number, p: number) => a + (b - a) * p;
const tpEo = (p: number) => 1 - Math.pow(1 - tpClamp(p), 3);
const tpEio = (p: number) => {
  p = tpClamp(p);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
const tpEi = (p: number) => {
  p = tpClamp(p);
  return p * p * p;
};
const tpHash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** 阻尼弹簧,0→1 带一点过冲 */
const tpSpring = (t: number, dur = 0.62) => {
  if (t <= 0) return 0;
  const x = t / dur;
  if (x >= 1.6) return 1;
  return 1 - Math.exp(-5.2 * x) * Math.cos(9.5 * x);
};

/* 安全区:左锚点右缘 ≤ 700、右锚点左缘 ≥ 1220。字宽用估算(导出逐帧确定),靠 TP_SAFE 留余量。 */
const TP_SAFE = 0.96;
const TP_FACE_X = 700;
const TP_V_MARGIN = 48;
const TP_FONT = 'var(--hud-font, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)';
const tpIsWide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x2e80;
const tpIsWord = (c: string) => /[A-Za-z0-9]/.test(c);
const tpIsComma = (c: string) => c === "," || c === "，" || c === "、";
function tpCharEm(c: string) {
  if (tpIsWide(c)) return 1;
  if (c === " ") return 0.3;
  if (/[A-Z0-9]/.test(c)) return 0.66;
  if (/[a-z]/.test(c)) return 0.56;
  return 0.4;
}
/** 卡片(缩放前)最大宽:按画幅、锚点、卡片大小、水平偏移推算。
 *  横版人脸线只按默认位置(offsetX=0)算:手动拖开后卡宽锁住只平移,只防出画(离画面边 TP_V_MARGIN) */
function tpMaxWidth(position: string, scale: number, ox: number) {
  const SW = 1920;
  const s = Math.max(0.2, scale);
  if (position === "left" || position === "right") {
    // 人脸线只按默认大小(scale=1)、默认位置算:用户拉大就真的变大(盖脸是自己选的);按真实大小/偏移只防出画
    return Math.min(tpWidthWithin(SW, position, 1, 0, SW - TP_FACE_X), tpWidthWithin(SW, position, s, ox, TP_V_MARGIN));
  }
  return (2 * (SW / 2 - Math.abs(ox) - (60))) / s;
}
/** 左/右锚点:远端边不越过离画面边 limit 的线时的最大宽(两侧都从近画面边那条边缩放,放大只往里长) */
function tpWidthWithin(SW: number, position: string, s: number, ox: number, limit: number) {
  const edge = 120;
  if (position === "left") return (SW - limit - edge - ox) / s;
  // 右锚点:根元素 transformOrigin 在右边,右缘固定 = SW−120+ox,左缘 = 右缘 − W·s
  return (SW - edge + ox - limit) / s;
}

type TpRole = "hero" | "mid" | "small";
const TP_ROLE_K: Record<TpRole, number> = { hero: 1, mid: 0.6, small: 0.36 };
type TpCh = { ch: string; comma: boolean; acc: boolean; i: number; ai: number; em: number };
type TpLine = { role: TpRole; chars: TpCh[] };
/** 一行在定稿里的宽(em):逗号换成 0.32em 留白;行尾逗号不计 */
const tpRowEm = (cs: TpCh[]) =>
  cs.reduce((w, c, j) => w + (c.comma ? (j === cs.length - 1 ? 0 : 0.32) : c.em), 0);
/** 一行太长时折成两行:取最均衡处,逗号后断最好,不拆英文词、标点不放行首 */
function tpBreakTwo(cs: TpCh[]): TpCh[][] {
  let best: { at: number; cost: number } | null = null;
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1];
    const b = cs[i];
    if (tpIsWord(a.ch) && tpIsWord(b.ch)) continue;
    if (/[，。、！？：；,.!?:;）)」』》]/.test(b.ch)) continue;
    const maxW = Math.max(tpRowEm(cs.slice(0, i)), tpRowEm(cs.slice(i)));
    // 逗号后断最好;其次在虚词边上断(「的」之后、「在/是/把…」之前),少拆实词
    const soft = /[的了着过]/.test(a.ch) || /[在是和与就也都把被让给对向从将再还]/.test(b.ch);
    const cost = maxW * (a.comma ? 0.78 : soft ? 0.82 : 1) * (a.acc !== b.acc && !a.comma ? 0.95 : 1);
    if (!best || cost < best.cost) best = { at: i, cost };
  }
  return best ? [cs.slice(0, best.at), cs.slice(best.at)] : [cs];
}
/** 兜底:按宽度贪心折行(宁可多一行也不出画) */
function tpGreedy(cs: TpCh[], maxEm: number): TpCh[][] {
  const rows: TpCh[][] = [[]];
  cs.forEach((c) => {
    const cur = rows[rows.length - 1];
    if (cur.length && tpRowEm([...cur, c]) > maxEm && !/[，。、！？：；,.!?:;）)」』》]/.test(c.ch)) rows.push([c]);
    else cur.push(c);
  });
  return rows;
}

/** 行距:同字号照参考作品(同一句折行 / 换句);字号不同时(大标接小字)按上一行下沿 + 下一行字高留空,免得叠字 */
const tpStep = (sameLine: boolean, prevF: number, F: number, kSame: number, kNext: number) =>
  Math.abs(prevF - F) < 0.5 ? (sameLine ? kSame : kNext) * F : 0.3 * prevF + 0.9 * F + 6;

function TypeShift({ params, playToken }: EffectProps<TypeShiftParams>) {
  const { position, lines, shiftAtMs } = params;
  const t = useCardElapsed(params as { __t?: number; __start?: number }, playToken);
  const spd = usePlateSpeed(); // 卡点秒数不动,只缩放动作时长
  const end = (params as { __end?: number }).__end;
  const dur = typeof end === "number" ? end - ((params as { __start?: number }).__start ?? 0) : null;
  const uid = useId().replace(/:/g, "");
  const acc = ACCENT_VAR[params.accent] ?? ACCENT_VAR.blue;
  const T_SHIFT = Math.max(0.3, (shiftAtMs ?? 1600) / 1000);
  const T_OUT = dur != null ? dur - 0.5 / spd : Infinity;
  // 以转折卡点为锚的「按 1 倍速计的时刻」:卡点那一刻不动,前后的蓄力/重排/扫光都按 spd 缩放;ta = 以卡起点为锚的流逝秒数
  const ts = T_SHIFT + (t - T_SHIFT) * spd;
  const ta = t * spd;

  // ── 内容:* 开头 = 大标,— 开头 = 小字,其余 = 中;大标句尾关键词(逗号后、最多 3 字)上强调色 ──
  const parsed: TpLine[] = lines
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const role: TpRole = raw.startsWith("*") ? "hero" : raw.startsWith("—") || raw.startsWith("-") ? "small" : "mid";
      const text = role === "hero" ? raw.slice(1).trim() : raw;
      const cjk = Array.from(text).some(tpIsWide);
      const arr = Array.from(text).map((c) => (c === "," && cjk ? "，" : c));
      let lastComma = -1;
      arr.forEach((c, i) => {
        if (tpIsComma(c) && i < arr.length - 1) lastComma = i;
      });
      // 上色只落在句尾的关键词上(参考作品:「省下来」「刀刃上」):中文取最后 3 个字,英文取最后一个词
      if (cjk) lastComma = Math.max(lastComma, arr.length - 4);
      else {
        const sp = arr.lastIndexOf(" ", arr.length - 2);
        if (sp > lastComma) lastComma = sp;
      }
      return {
        role,
        chars: arr.map((ch, i) => ({
          ch,
          comma: tpIsComma(ch),
          acc: role === "hero" && !tpIsComma(ch) && ch !== " " && i > lastComma,
          i,
          ai: Math.max(0, i - lastComma - 1), // 上色在关键词里的序号(参考作品「省下来」「刀刃上」从 +0.2s 起逐字 0.04s)
          em: tpCharEm(ch),
        })),
      };
    });
  const nL = parsed.length;

  // ── 排版:先算可用宽,能一行就一行(差一点就微缩),否则长行折两行,再不行缩字号到 44,最后贪心折行 ──
  const extra = params as { scale?: number; __scale?: number };
  const cardScale = (Number(extra.scale) || 1) * (Number(extra.__scale) || 1);
  const maxW = tpMaxWidth(position, cardScale, params.offsetX ?? 0) * TP_SAFE;
  const cyAnchor = 540 + (params.offsetY ?? 0);
  const maxH = (2 * Math.min(1080 - 30 - cyAnchor, cyAnchor - 30)) / cardScale;
  const FS0 = 96;
  const FMIN = 44;
  const fitAt = (F: number, mode: "none" | "two" | "greedy") => {
    const sizeAt = (L: number) => Math.max(parsed[L].role === "small" ? 18 : parsed[L].role === "mid" ? 30 : 0, F * TP_ROLE_K[parsed[L].role]);
    const k = F / FS0;
    const shift = nL > 1 && mode !== "greedy" ? F * 1.1 : 0;
    const avail = maxW - 144 * k;
    const rows: { L: number; cs: TpCh[] }[] = [];
    parsed.forEach((ln, L) => {
      const Fr = Math.max(ln.role === "small" ? 18 : ln.role === "mid" ? 30 : 0, F * TP_ROLE_K[ln.role]);
      let parts = [ln.chars];
      if (mode === "two" && tpRowEm(ln.chars) * Fr + shift > avail) parts = tpBreakTwo(ln.chars);
      if (mode === "greedy") parts = tpGreedy(ln.chars, avail / Fr);
      parts.forEach((cs) => rows.push({ L, cs }));
    });
    const w = (r: { L: number; cs: TpCh[] }) => tpRowEm(r.cs) * Math.max(parsed[r.L].role === "small" ? 18 : parsed[r.L].role === "mid" ? 30 : 0, F * TP_ROLE_K[parsed[r.L].role]);
    const blockInner = Math.max(0, ...rows.map(w));
    // 定稿板高度(和下面排版同一套行距),不能超出画面上下(留 30)
    let hh = 0;
    rows.forEach((r, j) => {
      const Fr = Math.max(parsed[r.L].role === "small" ? 18 : parsed[r.L].role === "mid" ? 30 : 0, F * TP_ROLE_K[parsed[r.L].role]);
      hh += j === 0 ? 18 * k + 0.875 * Fr : tpStep(rows[j - 1].L === r.L, sizeAt(rows[j - 1].L), Fr, 1.12, 1.23);
      if (j === rows.length - 1) hh += 0.25 * Fr + 18 * k;
    });
    return { F, k, shift, rows, ok: blockInner + shift <= avail && hh <= maxH, blockW: blockInner + shift };
  };
  let lay: ReturnType<typeof fitAt> | null = null;
  for (let F = FS0; F >= FS0 * 0.88 && !lay; F -= 1) {
    const r = fitAt(F, "none");
    if (r.ok) lay = r;
  }
  for (let F = FS0; F >= FMIN && !lay; F -= 1) {
    const r = fitAt(F, "two");
    if (r.ok) lay = r;
  }
  if (!lay) lay = fitAt(FMIN, "greedy");
  const { F, k, rows, blockW } = lay;
  const sizeOf = (role: TpRole) => Math.max(role === "small" ? 18 : role === "mid" ? 30 : 0, F * TP_ROLE_K[role]);

  // 定稿版式(局部坐标,底板左上 = 0,0)
  const padX = 72 * k;
  const fRows: { L: number; cs: TpCh[]; Fr: number; base: number; x0: number }[] = [];
  let yb = 0;
  rows.forEach((r, j) => {
    const Fr = sizeOf(parsed[r.L].role);
    if (j === 0) yb = 18 * k + 0.875 * Fr;
    else yb += tpStep(rows[j - 1].L === r.L, fRows[j - 1].Fr, Fr, 1.12, 1.23);
    const rw = tpRowEm(r.cs) * Fr;
    // 两行错位成一组:首行靠左、末行靠右,中间按序递推
    const x0 = padX + (blockW - rw) * (nL > 1 ? r.L / (nL - 1) : 0.5);
    fRows.push({ L: r.L, cs: r.cs, Fr, base: yb, x0 });
  });
  const lastFr = fRows.length ? fRows[fRows.length - 1].Fr : F;
  const finalRect = { x: 0, y: 0, w: blockW + 2 * padX, h: yb + 0.25 * lastFr + 18 * k };
  const fcx0 = finalRect.w / 2;
  const fcy0 = finalRect.h / 2;
  // 草稿版式:细体小字号、左对齐、底板略偏左上
  const dRows = fRows.map((r) => ({ ...r, dF: r.Fr * (58 / 96) }));
  const dMaxW = Math.max(0, ...dRows.map((r) => r.cs.reduce((w, c) => w + c.em * r.dF, 0)));
  let dy = 0;
  const dBases: number[] = [];
  dRows.forEach((r, j) => {
    if (j === 0) dy = (68 / 58) * r.dF;
    else dy += tpStep(dRows[j - 1].L === r.L, dRows[j - 1].dF, r.dF, 1.2, 78 / 58);
    dBases.push(dy);
  });
  const dLast = dRows.length ? dRows[dRows.length - 1].dF : 58 * k;
  const dH = dy + (34 / 58) * dLast;
  const dW = dMaxW + 140 * k;
  const draftRect = { x: fcx0 - 40 * k - dW / 2, y: fcy0 - 0.08 * finalRect.h - dH / 2, w: dW, h: dH };
  const dX0 = draftRect.x + 40 * k;
  // 外框:以定稿板中心对称,锚点居中时定稿板正好居中
  const halfW = Math.max(fcx0, fcx0 - draftRect.x, draftRect.x + draftRect.w - fcx0);
  const halfH = Math.max(fcy0, fcy0 - draftRect.y, draftRect.y + draftRect.h - fcy0);
  const ox = halfW - fcx0;
  const oy = halfH - fcy0;
  const boxW = halfW * 2;
  const boxH = halfH * 2;
  const FR = { x: finalRect.x + ox, y: finalRect.y + oy, w: finalRect.w, h: finalRect.h };
  const DR = { x: draftRect.x + ox, y: draftRect.y + oy, w: draftRect.w, h: draftRect.h };
  const CX = halfW;

  // 逐字:草稿位 → 定稿位
  type Glyph = TpCh & { L: number; g: number; Fr: number; dF: number; dcx: number; dcy: number; fcx: number; fcy: number; appear: number; jr: number; jy: number; jx: number };
  const glyphs: Glyph[] = [];
  const nChars = fRows.reduce((n, r) => n + r.cs.length, 0);
  const DG = Math.min(0.024, 0.55 / Math.max(1, nChars - 1)); // 转折时逐字错拍
  const EG = Math.min(0.012, 0.18 / Math.max(1, nChars - 1)); // 收走时逐字错拍
  const lineLen = parsed.map((l) => l.chars.length);
  let gi = 0;
  fRows.forEach((r, j) => {
    const dF = dRows[j].dF;
    let dx = dX0;
    let fx = r.x0 + ox;
    const start = 0.15 + 0.16 * r.L;
    const step = Math.min(0.034, Math.max(0.008, (T_SHIFT - 0.25 - start) / Math.max(1, lineLen[r.L])));
    r.cs.forEach((c, ci) => {
      const dw = c.em * dF;
      const fw = c.comma ? (ci === r.cs.length - 1 ? 0 : 0.32 * r.Fr) : c.em * r.Fr;
      const g = gi++;
      const s = dF / 58;
      glyphs.push({
        ...c, L: r.L, g, Fr: r.Fr, dF,
        dcx: dx + dw / 2, dcy: dBases[j] + DR.y, fcx: fx + fw / 2, fcy: r.base + oy,
        appear: start + c.i * step,
        jr: (tpHash((g + 1) * 3.1) - 0.5) * 0.09,
        jy: (tpHash((g + 1) * 7.7) - 0.5) * 7 * s,
        jx: (tpHash((g + 1) * 1.3) - 0.5) * 4 * s,
      });
      dx += dw;
      fx += fw;
    });
  });

  const out = dur != null ? tpEio(((t - T_OUT) * spd) / 0.47) : 0; // 收走进度
  const morph = tpEio((ts - (T_SHIFT - 0.1)) / 0.36); // 底板从草稿框变定稿板
  const pre = tpClamp((ts - (T_SHIFT - 0.28)) / 0.28); // 转折前的蓄力

  // ── 底板 ──
  const R = {
    x: tpLerp(DR.x, FR.x, morph), y: tpLerp(DR.y, FR.y, morph),
    w: tpLerp(DR.w, FR.w, morph), h: tpLerp(DR.h, FR.h, morph),
  };
  const breathe = morph >= 1 ? 1 + 0.006 * Math.sin((ts - T_SHIFT - 0.5) * 2.2) : 1;
  const colY = 1 - tpEi(out); // 收走时纵向压扁
  const intro = tpEo(ta / 0.3);
  const fillA = tpLerp(0.32, 0.86, morph);
  const rad = tpLerp(6, 26, morph);
  const dashA = (1 - morph) * tpEo(ta / 0.35);
  const sw = tpClamp((ts - T_SHIFT) / 0.55);
  const sx = tpLerp(-300, R.w + 300, tpEio(sw));

  // 角标:转折时从草稿框弹向四角后淡出
  const cm = tpClamp((ts - (T_SHIFT - 0.05)) / 0.6);
  const cornerA = ts < T_SHIFT + 0.6 && intro > 0 ? (t < T_SHIFT ? 0.7 * tpEo(ta / 0.4) : 0.7 * (1 - tpEo(cm))) : 0;
  const cex = tpEo(cm) * 22;

  // 光标(草稿态):跟着最后打出的字
  let lastTyped: Glyph | null = null;
  for (const c of glyphs) if (t - c.appear >= 0 && ts < T_SHIFT + 0.1) lastTyped = c;

  // 刃线:末一个上色的半句下面,定稿后从左往右划出
  let blade: Glyph[] = [];
  for (let L = nL - 1; L >= 0 && !blade.length; L--) {
    const accs = glyphs.filter((c) => c.L === L && c.acc);
    if (accs.length) {
      const lastY = accs[accs.length - 1].fcy;
      blade = accs.filter((c) => c.fcy === lastY);
    }
  }
  const cut = tpEo((ts - (T_SHIFT + 0.45)) / 0.32);
  const cutOut = dur != null ? 1 - tpEo(((t - T_OUT) * spd) / 0.25) : 1;

  if (dur != null && t >= dur) return null;

  return (
    // 有终点时退场由自己收,行内 opacity:1 盖掉 hud.css 通用的 [data-outro] .hud 淡出
    // 右锚点从右边缘缩放(纵向保持中心),拉大往左长;换卡居中时交给 hud.css 的中心缩放
    <div className={`hud hud-anchor hud-anchor--${position}`} style={{ ...offsetVars(params), ...(dur != null ? { opacity: 1 } : null), transformOrigin: position === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? "right center" : undefined }}>
      <div style={{ position: "relative", width: boxW, height: boxH, fontFamily: TP_FONT, filter: undefined }}>
        {/* 底板组:呼吸 + 收起时纵向压扁,绕定稿中心缩放 */}
        <div
          style={{
            position: "absolute", left: R.x, top: R.y, width: R.w, height: R.h,
            transformOrigin: `${CX - R.x}px ${R.h / 2}px`,
            transform: `scale(${(breathe * (1 - 0.04 * out)).toFixed(4)},${(colY * (0.96 + 0.04 * intro)).toFixed(4)})`,
            opacity: intro,
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: rad, overflow: "hidden", display: undefined,
              background: `linear-gradient(180deg, rgba(24,24,28,${fillA.toFixed(3)}), rgba(12,12,15,${fillA.toFixed(3)}))`,
              boxShadow: `0 12px 40px rgba(0,0,0,${(0.35 * morph).toFixed(3)}), inset 0 0 0 1px rgba(255,255,255,${(0.1 * morph).toFixed(3)})`,
            }}
          >
            {sw > 0 && sw < 1 && (
              <div
                style={{
                  position: "absolute", top: 0, bottom: 0, left: sx - 220, width: 440,
                  background: `linear-gradient(90deg, transparent, ${acc}, transparent)`,
                  opacity: 0.22 * Math.sin(Math.PI * sw),
                }}
              />
            )}
          </div>
          {dashA > 0.01 && (
            <svg width={R.w} height={R.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <rect
                x={0} y={0} width={R.w} height={R.h} rx={rad} fill="none"
                stroke="#fff" strokeOpacity={0.55 * dashA} strokeWidth={1.5}
                strokeDasharray="10 8" strokeDashoffset={-ta * 40}
              />
              {/* 基线辅助线 */}
              {dRows.map((_, j) => (
                <line
                  key={j} x1={16} x2={R.w - 16} y1={DR.y + dBases[j] + 12 * k - R.y} y2={DR.y + dBases[j] + 12 * k - R.y}
                  style={{ stroke: acc }} strokeOpacity={0.28 * dashA} strokeWidth={1}
                />
              ))}
              {(params.draftTag ?? "DRAFT · v0.3").trim() && (
                <text x={16} y={-12} fill="#fff" fillOpacity={(0.5) * dashA} style={{ font: '500 17px "SF Mono", Menlo, "PingFang SC", monospace' }}>
                  {(params.draftTag ?? "DRAFT · v0.3").trim()}
                </text>
              )}
            </svg>
          )}
        </div>

        <svg width={boxW} height={boxH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {cornerA > 0 &&
            ([[R.x, R.y, 1, 1], [R.x + R.w, R.y, -1, 1], [R.x, R.y + R.h, 1, -1], [R.x + R.w, R.y + R.h, -1, -1]] as const).map(
              ([x0, y0, sxx, syy], i) => {
                const x = x0 - sxx * (10 + cex);
                const y = y0 - syy * (10 + cex);
                return (
                  <path
                    key={i} d={`M${x},${y + syy * 22}L${x},${y}L${x + sxx * 22},${y}`} fill="none"
                    style={{ stroke: acc }} strokeOpacity={cornerA} strokeWidth={2.5}
                  />
                );
              },
            )}

          {/* 文字 */}
          <g style={{ filter: "drop-shadow(0 3px 7px rgba(0,0,0,0.45))" }}>
            {glyphs.map((c) => {
              const age = t - c.appear;
              if (age < 0) return null;
              const pIn = tpEo((age * spd) / 0.16);
              const p = tpSpring(ts - T_SHIFT - c.g * DG); // 草稿→定稿
              const settle = tpClamp(p);
              const loose = (1 - settle) * (1 - 0.6 * pre); // 草稿态的松散抖动,转折时收敛到 0
              const wob = Math.sin(ta * 2.6 + c.g * 1.7);
              const x = tpLerp(c.dcx + c.jx * loose, c.fcx, p);
              const yLift = Math.sin(Math.PI * tpClamp((ts - T_SHIFT - c.g * DG) / 0.5)) * -26 * k; // 跳起的弧线
              const y = tpLerp(c.dcy + (c.jy + wob * 1.2) * loose, c.fcy, p) + yLift + (1 - pIn) * 14 * k;
              const rot = c.jr * loose + wob * 0.01 * loose;
              const sc = tpLerp(c.dF / c.Fr, 1, p) * (1 - 0.03 * pre * (1 - settle));
              const o = tpClamp(((t - T_OUT) * spd - c.g * EG) / 0.3); // 收走:逐字上飘淡出
              const oyy = -tpEo(o) * 24 * k;
              const oa = 1 - tpEo(o);
              const wFinal = c.comma ? 0 : tpClamp(p * 1.8);
              const kk = c.comma ? 1 - tpEo((ts - T_SHIFT) / 0.28) : 1; // 逗号在定稿时退场
              if (kk <= 0 || oa <= 0) return null;
              const accT = c.acc ? tpEo((ts - T_SHIFT - 0.35 - (0.2 + c.ai * 0.04)) / 0.3) : 0;
              const small = parsed[c.L].role === "small";
              const boldA = wFinal * pIn * oa;
              const tf =
                `translate(${x.toFixed(2)} ${(y + oyy - c.Fr * 0.35 * sc).toFixed(2)}) rotate(${((rot * 180) / Math.PI).toFixed(3)}) ` +
                `scale(${sc.toFixed(4)}) translate(0 ${(c.Fr * 0.35).toFixed(2)})` + (c.comma ? ` scale(${kk.toFixed(4)})` : "");
              const ch = c.ch === " " ? " " : c.ch;
              return (
                <g key={c.g} transform={tf} style={{ fontSize: c.Fr }}>
                  {wFinal < 1 && (
                    <text textAnchor="middle" fill="#fff" fillOpacity={0.8 * pIn * (1 - wFinal) * oa * kk} style={{ fontWeight: 300 }}>
                      {ch}
                    </text>
                  )}
                  {wFinal > 0 && (
                    <text textAnchor="middle" fill="#fff" fillOpacity={boldA * (small ? (0.62) : 1)} style={{ fontWeight: small ? 500 : 600 }}>
                      {ch}
                    </text>
                  )}
                  {wFinal > 0 && accT > 0 && (
                    <text textAnchor="middle" fillOpacity={boldA * accT} style={{ fontWeight: 600, fill: acc }}>
                      {ch}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* 光标(草稿态) */}
          {lastTyped && t < T_SHIFT && (
            <rect
              x={lastTyped.dcx + lastTyped.dF * 0.55} y={lastTyped.dcy - lastTyped.dF * 0.85} width={4} height={lastTyped.dF}
              style={{ fill: acc }}
              fillOpacity={(ta < 0.7 ? 1 : Math.floor(ta * 3) % 2 === 0 ? 1 : 0.15) * (1 - tpClamp((ts - (T_SHIFT - 0.12)) / 0.12))}
            />
          )}

          {/* 刃线 + 刃尖闪光 */}
          {blade.length > 0 && cut > 0 && cutOut > 0 && (() => {
            const b0 = blade[0];
            const b1 = blade[blade.length - 1];
            const x0 = b0.fcx - (b0.em * b0.Fr) / 2;
            const x1 = b1.fcx + (b1.em * b1.Fr) / 2;
            const y = b0.fcy + 20 * k;
            const xe = tpLerp(x0, x1, cut);
            const d = `M${x0},${y}L${xe},${y - 1}L${xe},${y + 3}L${x0},${y + 6}Z`;
            return (
              <g opacity={cutOut}>
                <path d={d} style={{ fill: acc }} fillOpacity={0.95} />
                <defs>
                  <linearGradient id={`${uid}bl`} gradientUnits="userSpaceOnUse" x1={x0} y1={0} x2={x1} y2={0}>
                    <stop offset="0" stopColor="#fff" stopOpacity={0} />
                    <stop offset="1" stopColor="#fff" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <path d={d} fill={`url(#${uid}bl)`} />
                {cut < 1 && <circle cx={xe} cy={y + 1} r={5} fill="rgb(255,250,225)" fillOpacity={1 - cut} />}
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}


export const typeShiftDef: EffectDef<TypeShiftParams> = {
  id: "type-shift",
  name: "TypeShift",
  description: "排版流 · 草稿错落 → 啪地重排成版式",
  tags: ["聚散飞行"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    lines: "把结尾的升华放在这里|它会一行一行铺开|*停在最重的那一句|— 小字署名收尾",
    shiftAtMs: 1600,
    draftTag: "DRAFT · v0.3",
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
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "lines", label: "行(| 分隔;*开头=大标,—开头=小字)", type: "text" },
    { key: "shiftAtMs", label: "何时重排", type: "range", min: 800, max: 4000, step: 100, unit: "ms" },
    { key: "draftTag", label: "草稿角标(精修版,留空不显示)", type: "text" },
    { key: "accent", label: "大标颜色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: TypeShift,
};
