import type { CSSProperties } from "react";
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

export interface VersusCardParams {
  theme: "dark" | "light";
  aKicker: string;
  aTitle: string;
  aSub: string;
  aAccent: string;
  bKicker: string;
  bTitle: string;
  bSub: string;
  winner: "a" | "b" | "none"; // 强调哪边(另一边降调)
  offsetX?: number;
  offsetY?: number;
}


/* ── 精修版「新旧对比」:动作逐拍照搬隔离 Opus 一次性作品 board.html 的 renderAt(t) ──
   左右两张卡 + 中间 VS 徽章。落败一边 = 深色玻璃卡:进场后抖一下 → 去饱和、缩小、往外退、标题被红线划掉;
   胜出一边 = 亮白实卡:弹簧放大、强调色描边 + 外发光、高光扫过、对勾描出;停留期呼吸 + VS 外环慢转 + 每 4 秒一道轻扫光。
   「都不」= 两张都是亮卡,只进场不分胜负。参考作品底部两个按内容画的小细节(内存条、入库方块)不通用,去掉。
   全部画面是 t 的纯函数;只用行内样式 / SVG 属性,不依赖 hud.css */
const VS_W = 520; // 参考作品卡宽
const VS_GAP = 124; // 两卡间距(中间放 96 的 VS)
const VS_PAD = 38; // 卡内左右边距
const VS_RED = "#FF5A4E"; // 删除线红,不跟强调色走
const VS_OUT = 0.5; // 最后 0.5s 收走
const VS_FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
/** 整组压在画面下半(口播人胸前),顶边不高于 y660,脸完全空出来 */
const VS_BAND = [660, 1050] as const;

const vsClamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const vsProg = (t: number, a: number, b: number) => vsClamp((t - a) / (b - a), 0, 1);
const vsLerp = (a: number, b: number, k: number) => a + (b - a) * k;
const vsOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const vsInCubic = (k: number) => k * k * k;
const vsInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const vsOutBack = (k: number) => {
  const c1 = 1.6;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
/** 阻尼弹簧:0→1,带轻微过冲 */
const vsSpring = (k: number, f: number, z: number) => {
  if (k <= 0) return 0;
  const w = f * 2 * Math.PI;
  return 1 - Math.exp(-z * w * k) * Math.cos(w * Math.sqrt(1 - z * z) * k);
};
/** 确定性抖动 */
const vsJitter = (t: number, seed: number) => Math.sin(t * 37.1 + seed) * 0.6 + Math.sin(t * 61.7 + seed * 2.3) * 0.4;

/* ── 长内容排版:先换行(最多两行、自然断开),两行还放不下再缩字号,有下限 ── */
const vsGlyph = (ch: string) => (/[⺀-￿]/.test(ch) ? 1 : ch === " " ? 0.3 : /[A-Z]/.test(ch) ? 0.68 : 0.56);
const vsTextW = (s: string, fs: number, ls: number) => Array.from(s).reduce((w, ch) => w + (vsGlyph(ch) + ls) * fs, 0);
const VS_NO_HEAD = /[，。、！？：；,.!?:;）)」』》”’·…]/; // 不放行首
/** 一分为二:不拆英文单词/数字、行首不放标点,在两行最均衡的地方断;有空格优先断空格 */
function vsSplit2(s: string): [string, string] | null {
  const cs = Array.from(s);
  const w = cs.map(vsGlyph);
  const total = w.reduce((a, b) => a + b, 0);
  let best = -1;
  let bestCost = Infinity;
  let acc = 0;
  for (let i = 1; i < cs.length; i++) {
    acc += w[i - 1];
    const a = cs[i - 1];
    const b = cs[i];
    if (/[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b)) continue;
    if (VS_NO_HEAD.test(b)) continue;
    const cost = Math.max(acc, total - acc) * (a === " " || b === " " ? 0.97 : 1);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  if (best < 0) return null;
  return [cs.slice(0, best).join("").trim(), cs.slice(best).join("").trim()];
}
/** 下限字号两行还放不下:按宽度贪心折成多行(宁可多一行也不出卡) */
function vsGreedy(s: string, fs: number, ls: number, maxW: number) {
  const lines: string[] = [];
  let cur = "";
  Array.from(s).forEach((ch) => {
    if (cur && vsTextW(cur + ch, fs, ls) > maxW) {
      lines.push(cur.trim());
      cur = ch === " " ? "" : ch;
    } else cur += ch;
  });
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}
type VsFitted = { fs: number; lines: string[] };
/** 定字号和断行:单行原字号 → 单行微缩到 oneLineMin → 两行(从原字号往下缩到 min) → min 字号多行兜底 */
function vsFit(s: string, maxW: number, base: number, oneLineMin: number, min: number, ls: number): VsFitted {
  if (!s) return { fs: base, lines: [] };
  for (let fs = base; fs >= oneLineMin; fs--) if (vsTextW(s, fs, ls) <= maxW) return { fs, lines: [s] };
  const two = vsSplit2(s);
  if (two) {
    for (let fs = base; fs >= min; fs--)
      if (Math.max(vsTextW(two[0], fs, ls), vsTextW(two[1], fs, ls)) <= maxW) return { fs, lines: two };
  }
  for (let fs = oneLineMin - 1; fs >= min; fs--) if (vsTextW(s, fs, ls) <= maxW) return { fs, lines: [s] };
  return { fs: min, lines: vsGreedy(s, min, ls, maxW) };
}

type VsRole = "win" | "lose" | "even";
const VS_CHECK = 52 + 14; // 胜方右上角对勾 52 + 和眉题的间隔

function vsLayout(kicker: string, title: string, note: string, role: VsRole, W: number) {
  const inner = W - VS_PAD * 2;
  const eb = vsFit(kicker, inner - 32 - (role === "win" ? VS_CHECK : 0), 26, 22, 18, 0.12);
  const ti = vsFit(title, inner, 68, 60, 44, 0.02);
  const no = vsFit(note, inner, 28, 24, 18, 0.04);
  const ebH = eb.lines.length === 0 ? 0 : eb.lines.length === 1 ? eb.fs + 11 : eb.lines.length * eb.fs * 1.15 + 11;
  const tiTop = eb.lines.length ? 30 + ebH + 20 : 34;
  const tiH = ti.lines.length * ti.fs * 1.05;
  const noTop = tiTop + tiH + 16;
  const noH = no.lines.length * no.fs * 1.3;
  const h = Math.ceil((no.lines.length ? noTop + noH : tiTop + tiH) + 40);
  return { eb, ti, no, tiTop, noTop, h };
}

function VersusCard({ params, playToken }: EffectProps<VersusCardParams>) {
  const { aKicker, aTitle, aSub, aAccent, bKicker, bTitle, bSub, winner } = params;
  const tp = params as VersusCardParams & { __t?: number; __start?: number; __end?: number; scale?: number; __scale?: number };
  const tRaw = useCardElapsed(tp, playToken);
   const SW = 1920;
  const end = tp.__end;
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const D = typeof end === "number" ? Math.max(0, end - (tp.__start ?? 0)) : Infinity;
  const spd = usePlateSpeed(); // 动画速度:无卡点参数,动作用卡内时间 t*spd,退场按真实结束时刻
  const tr = Math.min(tRaw, D); // 真实流逝秒数(只给退场用)
  const t = tr * spd;

  const roleOf = (side: "a" | "b"): VsRole => (winner === "none" ? "even" : winner === side ? "win" : "lose");
  const roleA = roleOf("a");
  const roleB = roleOf("b");

  // ── 排版:卡宽默认 520(参考作品),内容长就加宽到安全区为止,再不够就换行、缩字号 ──
  const s = Math.max(0.2, (Number(tp.scale) || 1) * (Number(tp.__scale) || 1));
  const ox = params.offsetX ?? 0;
  const maxTotal = (SW - 96 - 2 * Math.abs(ox)) / s; // 整组不出画,左右各留 48
  const need = (k: string, ti: string, no: string, role: VsRole) =>
    Math.max(vsTextW(k, 26, 0.12) + 32 + (role === "win" ? VS_CHECK : 0), vsTextW(ti, 68, 0.02), vsTextW(no, 28, 0.04)) +
    VS_PAD * 2;
  const W = Math.round(
    Math.max(240, Math.min(Math.max(VS_W, need(aKicker, aTitle, aSub, roleA), need(bKicker, bTitle, bSub, roleB)), (maxTotal - VS_GAP) / 2)),
  );
  const LA = vsLayout(aKicker, aTitle, aSub, roleA, W);
  const LB = vsLayout(bKicker, bTitle, bSub, roleB, W);
  const H = Math.max(LA.h, LB.h);
  const totalW = W * 2 + VS_GAP;
  // 纵向:整组放进安全带;放不下就整体再缩(k),胜方弹大时往上多留 4%
  const [bandTop, bandBottom] = VS_BAND;
  // 安全带(躲脸)只按默认大小算:用户拉大就真的变大;按真实大小只防出画(上下各留 48,放不下才整体缩)
  const SH = 1080;
  const oy = params.offsetY ?? 0;
  const k1 = Math.min(1, (bandBottom - bandTop) / (H * 1.04));
  const k = Math.min(k1, (SH - 96) / (H * 1.04 * s));
  const bottomAt = (sv: number, kv: number) => bandTop + H * sv * kv * 1.04 + oy;
  // 拉大后往下长到出画时整组往上挪(默认大小时不挪)
  const cy = bandTop + H * s * k * 0.52 - Math.max(0, bottomAt(s, k) - Math.max(SH - 48, bottomAt(1, k1)));

  // ── 时间轴(照搬 renderAt) ──
  const exitK = Number.isFinite(D) ? vsInCubic(vsProg(tr, D - VS_OUT / spd, D)) : 0;
  const exitE = Number.isFinite(D) ? vsProg(tr, D - VS_OUT / spd, D) : 0;
  const weak = vsInOut(vsProg(t, 1.25, 1.95)); // 落败方被削弱
  const win = vsSpring(vsClamp((t - 1.6) / 1.2, 0, 1), 1.3, 0.5); // 胜出:放大 + 光
  const breathe = t > 2.4 ? Math.sin(((t - 2.4) * Math.PI * 2) / 3.2) : 0; // 呼吸
  const sh = vsClamp(win, 0, 1.2);
  // 高光扫过(胜出瞬间一次,之后每 4 秒一次轻扫)
  const sweepT = t < 5 ? vsProg(t, 1.75, 2.45) : vsProg((t - 2.45) % 4.0, 2.2, 2.9);
  const ck = vsOutBack(vsProg(t, 1.75, 2.15));
  const tickLen = 40;
  const tickOff = tickLen * (1 - vsOutCubic(vsProg(t, 1.95, 2.35)));

  const lineBlock = (
    f: VsFitted,
    lh: number,
    style: CSSProperties,
    strike?: (li: number) => number,
  ) => (
    <div style={{ position: "absolute", left: VS_PAD, fontSize: f.fs, lineHeight: lh, whiteSpace: "nowrap", ...style }}>
      {f.lines.map((line, li) => (
        <div key={li} style={{ position: "relative", width: "fit-content" }}>
          {line}
          {strike && (
            // 删除线:每行一道,下一行紧跟上一行划(错开 0.15s)
            <div
              style={{
                position: "absolute", left: -6, right: -6, top: "54%", height: 7, marginTop: -3.5, borderRadius: 4,
                background: VS_RED, transformOrigin: "0 50%", transform: `scaleX(${strike(li).toFixed(4)})`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );

  const side = (which: "a" | "b") => {
    const role = which === "a" ? roleA : roleB;
    const L = which === "a" ? LA : LB;
    const dir = which === "a" ? -1 : 1; // 往外的方向
    // 进场:左卡先、右卡晚 0.18s(参考作品的两条弹簧)
    const inK = which === "a" ? vsSpring(vsClamp(t / 1.0, 0, 1), 1.15, 0.62) : vsSpring(vsClamp((t - 0.18) / 1.0, 0, 1), 1.1, 0.6);
    const fadeIn = which === "a" ? vsProg(t, 0, 0.35) : vsProg(t, 0.18, 0.5);
    const left = which === "a" ? 0 : W + VS_GAP;
    const origin = which === "a" ? "100% 50%" : "0% 50%"; // 都以靠 VS 的内侧边为缩放原点

    let x = dir * 90 * (1 - inK) + dir * 60 * exitK;
    let y = 24 * exitK;
    let sc = vsLerp(0.92, 1, inK);
    let op = fadeIn * (1 - exitE);
    if (role === "lose") {
      const shake = t > 0.6 && t < 1.25 ? vsJitter(t, 1.3) * 3 * (1 - vsProg(t, 0.6, 1.25)) : 0;
      x += dir * 10 * weak + shake;
      sc *= vsLerp(1, 0.93, weak);
      op *= vsLerp(1, 0.82, weak);
    } else if (role === "win") {
      x += dir * 10 * win;
      y += -6 * win - 3 * breathe;
      sc *= vsLerp(1, 1.06, win) * (1 + breathe * 0.006);
    }
    const tf = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${sc.toFixed(4)})`;

    if (role === "lose") {
      const c = [236, 236, 239].map((v, i) => Math.round(vsLerp(v, ([150, 150, 158])[i], weak)));
      return (
        <div
          key={which}
          style={{
            position: "absolute", left, top: 0, width: W, height: H, borderRadius: 28, boxSizing: "border-box",
            background: "rgba(26,26,30,0.80)", border: "1.5px solid rgba(255,255,255,0.10)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.28)", transformOrigin: origin, transform: tf,
            opacity: op, filter: ["", `saturate(${vsLerp(1, 0.35, weak).toFixed(3)})`].join(" ").trim(),
          }}
        >
          {L.eb.lines.length > 0 && (
            <div
              style={{
                position: "absolute", left: VS_PAD, top: 30, fontSize: L.eb.fs, fontWeight: 600, letterSpacing: "0.12em",
                lineHeight: L.eb.lines.length > 1 ? 1.15 : 1, padding: "5px 16px 6px 16px", borderRadius: 999,
                color: "#C9C9D0", background: "rgba(255,255,255,0.10)", whiteSpace: "nowrap",
              }}
            >
              {L.eb.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {lineBlock(
            L.ti, 1.05,
            { top: L.tiTop, fontWeight: 800, letterSpacing: "0.02em", color: `rgb(${c.join(",")})` },
            (li) => vsOutCubic(vsProg(t, 1.3 + li * 0.15, 1.75 + li * 0.15)),
          )}
          {L.no.lines.length > 0 &&
            lineBlock(L.no, 1.3, { top: L.noTop, fontWeight: 500, letterSpacing: "0.04em", color: "#A9A9B2" })}
        </div>
      );
    }

    // 亮卡(胜方 / 都不)
    const isWin = role === "win";
    return (
      <div key={which} style={{ position: "absolute", left, top: 0, width: W, height: H, transformOrigin: origin, transform: tf, opacity: op }}>
        {isWin && (
          // 外圈光晕:跟着卡走
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: 28,
              boxShadow: `0 0 ${(34 + 8 * breathe).toFixed(1)}px 0px var(--hud-acc)`,
              opacity: vsClamp(win, 0, 1) * (0.55 + 0.15 * breathe) * 0.32,
            }}
          />
        )}
        <div
          style={{
            position: "absolute", inset: 0, borderRadius: 28, boxSizing: "border-box", overflow: "hidden",
            background: "#FBFAF5", border: "1.5px solid rgba(255,255,255,0.9)",
            boxShadow: isWin
              ? `0 ${(18 + 14 * sh).toFixed(1)}px ${(40 + 30 * sh).toFixed(1)}px rgba(0,0,0,${(0.22 + 0.08 * sh).toFixed(3)})`
              : "0 18px 40px rgba(0,0,0,0.22)",
          }}
        >
          {L.eb.lines.length > 0 && (
            <div
              style={{
                position: "absolute", left: VS_PAD, top: 30, fontSize: L.eb.fs, fontWeight: 600, letterSpacing: "0.12em",
                lineHeight: L.eb.lines.length > 1 ? 1.15 : 1, padding: "5px 16px 6px 16px", borderRadius: 999,
                color: "#fff", background: "var(--hud-acc)", whiteSpace: "nowrap",
              }}
            >
              {L.eb.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {lineBlock(L.ti, 1.05, { top: L.tiTop, fontWeight: 800, letterSpacing: "0.02em", color: "#14161A" })}
          {L.no.lines.length > 0 &&
            lineBlock(L.no, 1.3, { top: L.noTop, fontWeight: 500, letterSpacing: "0.04em", color: "#3E4A46" })}
          {isWin && (
            <div
              style={{
                position: "absolute", right: 34, top: 30, width: 52, height: 52, borderRadius: "50%", background: "var(--hud-acc)",
                transform: `scale(${ck.toFixed(4)})`, opacity: vsProg(t, 1.75, 1.9),
              }}
            >
              <svg width="52" height="52" viewBox="0 0 52 52" style={{ position: "absolute", left: 0, top: 0 }}>
                <path
                  d="M15 27 L23 35 L38 18" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={tickLen} strokeDashoffset={tickOff.toFixed(2)}
                />
              </svg>
            </div>
          )}
          {isWin && (
            <div
              style={{
                position: "absolute", top: "-20%", width: 120, height: "140%", transform: "rotate(18deg)",
                left: vsLerp(-200, W + 120, vsInOut(sweepT)),
                background: "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.75),rgba(255,255,255,0))",
                opacity: sweepT > 0 && sweepT < 1 ? (t < 5 ? 1 : 0.5) : 0,
              }}
            />
          )}
        </div>
        {isWin && (
          // 强调色描边(在裁切层外面,不被 overflow 切掉)
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: 28, pointerEvents: "none",
              boxShadow: `0 0 0 ${(3 * sh).toFixed(2)}px var(--hud-acc)`, opacity: 0.95 * vsClamp(sh, 0, 1),
            }}
          />
        )}
      </div>
    );
  };

  // VS:旋入 → 胜出那一拍顿一下 → 外环慢转;退场收缩
  const vsIn = vsOutBack(vsProg(t, 0.45, 0.95));
  const pp = vsProg(t, 1.6, 2.4);
  const vsPunch = 1 + 0.12 * Math.exp(-pp * 5) * Math.sin(pp * Math.PI * 3) * (t > 1.6 ? 1 : 0);
  const vsS = vsIn * vsPunch * vsLerp(1, 0.4, exitK);

  return (
    <div
      className="hud vsx hud-anchor hud-anchor--center is-in"
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由照搬的动作负责,不叠两层。
      // top / --anchor-tf 行内写死:整组中心落在安全带里
      style={{
        ["--hud-acc" as string]: ACCENT_VAR[aAccent] ?? ACCENT_VAR.green,
        ...offsetVars(params),
        top: cy,
        ["--anchor-tf" as string]: "translate(-50%, -50%)",
        opacity: 1,
      }}
    >
      <div
        style={{
          position: "relative", width: totalW, height: H, fontFamily: VS_FONT,
          transform: k < 1 ? `scale(${k.toFixed(4)})` : undefined,
        }}
      >
        {side("a")}
        {side("b")}
        <div
          style={{
            position: "absolute", left: totalW / 2 - 48, top: H / 2 - 48, width: 96, height: 96,
            transform: `scale(${vsS.toFixed(4)}) rotate(${vsLerp(-25, 0, vsOutCubic(vsProg(t, 0.45, 1.0))).toFixed(2)}deg)`,
            opacity: vsProg(t, 0.45, 0.6) * (1 - exitE),
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: "50%", transform: `rotate(${(t * 28).toFixed(2)}deg)`,
              background: `conic-gradient(from 0deg, var(--hud-acc) 0 30%, rgba(255,255,255,0) 30% 50%, ${VS_RED} 50% 62%, rgba(255,255,255,0) 62% 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute", inset: 6, borderRadius: "50%", background: "#14161A", boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
              font: 'italic 900 36px/1 "Helvetica Neue", Arial, sans-serif', letterSpacing: "-0.02em",
            }}
          >
            VS
          </div>
        </div>
      </div>
    </div>
  );
}



export const versusCardDef: EffectDef<VersusCardParams> = {
  id: "versus-card",
  name: "VersusCard",
  description: "VS 对比卡 · 双卡对撞 + 中央徽章",
  tags: ["对撞并置"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    aKicker: "主推 · 会点亮",
    aTitle: "选项 A",
    aSub: "胜出的一边高亮",
    aAccent: "blue",
    bKicker: "对照 · 会变灰",
    bTitle: "选项 B",
    bSub: "落败的一边压暗",
    winner: "a",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    { key: "aKicker", label: "左卡小标", type: "text" },
    { key: "aTitle", label: "左卡标题", type: "text" },
    { key: "aSub", label: "左卡说明", type: "text" },
    { key: "aAccent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "bKicker", label: "右卡小标", type: "text" },
    { key: "bTitle", label: "右卡标题", type: "text" },
    { key: "bSub", label: "右卡说明", type: "text" },
    {
      key: "winner",
      label: "强调哪边",
      type: "select",
      options: [
        { label: "左边", value: "a" },
        { label: "右边", value: "b" },
        { label: "都不", value: "none" },
      ],
    },
    ...OFFSET_CONTROLS,
  ],
  Component: VersusCard,
};
