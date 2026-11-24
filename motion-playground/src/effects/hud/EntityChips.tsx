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

export interface EntityChipsParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  /** 一行一块名牌:「牌面|名称|身份/EN」,牌面 light=白牌 dark=黑牌 */
  chips: string;
  /** 名牌右侧的小注(如股票代码/头衔),「上行|下行」 */
  note?: string;
  /** 名牌逐块滑入间隔 */
  stepMs?: number;
  /** 新动效:牌面不同的两块之间压的圆徽章字(默认 VS,留空不显示) */
  vsText?: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

interface Chip {
  style: string;
  name: string;
  sub: string;
}

function parseChips(raw: string): Chip[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((l) => {
      const [style = "light", name = "", sub = ""] = l.split("|").map((s) => s.trim());
      return { style, name, sub };
    });
}

/**
 * 实体名牌(人物/公司锚定):讲到某个人或机构时,
 * 一排名牌依次滑入并常驻——白牌(机构)+ 黑牌(人物·头衔)+ 侧注(代码/身份),
 * 之后整段讨论期间一直钉在画面上,观众随时知道"现在在说谁"。
 */
/* ───────────── 精修版:两版对照名牌(逐拍照搬隔离 Opus 原作 renderAt) ─────────────
 * 牌面分两种性格:
 *   dark  → 「机器方」深石墨底 + 冷蓝 + 等宽字 + 细网格:线性擦出、身份行逐字打出、方块光标闪、周期扫描光
 *   light → 「主角方」暖象牙底 + 点缀色 + 粗体 + 手写下划线:弹簧落位(带倾斜)、呼吸圆点
 * (照面板上「light=白牌 dark=黑牌」的字面:黑牌出深底那一版,白牌出象牙底那一版)
 * 相邻两块牌面不同 → 接缝上压一枚 VS 徽章;同牌面就不压(没有对立关系)。
 * 侧注挂在最后一块名牌下方:竖向引线长出,每行一块深色小底依次滑入。
 * 有 __end 时最后 0.5s 按 侧注 → VS → 名牌(自下而上)倒序收走。全部画面是 t 的纯函数。 */

const ec = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ePrg = (t: number, s: number, d: number) => ec((t - s) / d);
const eOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const eInCubic = (x: number) => x * x * x;
/** 阻尼弹簧:0→1,带一次自然回弹 */
const eSpring = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(11 * x));

const E_SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const E_MONO = '"SF Mono", Menlo, Consolas, monospace';
const E_PW = 440; // 参考作品名牌宽
const E_PH = 112; // 参考作品名牌高
const E_GAP = 20; // 两块名牌的间距(VS 压在中间)
const E_VS = 56;
const E_VS_OVER = 26; // VS 伸出名牌右边缘的量(482+56−72−440)
const E_COOL = "#9DBBFF";

/* ── 长内容排版(通用规矩):先换行(最多两行、从中间自然断开),两行还放不下再缩字号,有字号下限 ── */
/** 估一个字符占几个 em(只用来决定断行/缩字号,不求精确):中日韩/全角 1,大写 0.68,空格 0.3,其余 0.56;等宽字体非中文一律 0.6 */
const eGlyph = (ch: string, mono: boolean) =>
  /[⺀-￿]/.test(ch) ? 1 : mono ? 0.6 : /[A-Z]/.test(ch) ? 0.68 : ch === " " ? 0.3 : 0.56;
const eTextW = (s: string, fs: number, ls: number, mono = false) =>
  Array.from(s).reduce((w, ch) => w + (eGlyph(ch, mono) + ls) * fs, 0);
/** 一分为二:有空格就挑离中点最近的空格断,没有就按宽度对半断;断点挪开行首标点 */
function eSplit2(s: string, mono: boolean): [string, string] {
  const cs = Array.from(s);
  const total = cs.reduce((w, ch) => w + eGlyph(ch, mono), 0);
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
    acc += eGlyph(ch, mono);
  });
  if (bestSpace > 0) return [cs.slice(0, bestSpace).join(""), cs.slice(bestSpace + 1).join("")];
  cut = Math.max(1, Math.min(cs.length - 1, cut));
  while (cut < cs.length - 1 && /[,，。、;；:：!！?？)）」』”·]/.test(cs[cut])) cut++;
  return [cs.slice(0, cut).join(""), cs.slice(cut).join("")];
}
/** 两行在下限字号还放不下时的兜底:按宽度贪心折成多行 */
function eGreedy(s: string, fs: number, ls: number, maxW: number, mono: boolean): string[] {
  const lines: string[] = [];
  let cur = "";
  Array.from(s).forEach((ch) => {
    if (cur && eTextW(cur + ch, fs, ls, mono) > maxW) {
      lines.push(cur);
      cur = ch === " " ? "" : ch;
    } else cur += ch;
  });
  if (cur) lines.push(cur);
  return lines;
}
/** 定字号和断行:单行原字号 → 单行微缩到 oneLineMin → 两行(从原字号往下缩到 min) → 下限字号多行兜底 */
function eFit(s: string, maxW: number, base: number, oneLineMin: number, min: number, ls: number, mono = false) {
  for (let fs = base; fs >= oneLineMin; fs--) if (eTextW(s, fs, ls, mono) <= maxW) return { fs, lines: [s] };
  if (Array.from(s).length >= 2) {
    const two = eSplit2(s, mono);
    for (let fs = base; fs >= min; fs--)
      if (Math.max(eTextW(two[0], fs, ls, mono), eTextW(two[1], fs, ls, mono)) <= maxW) return { fs, lines: two };
  }
  return { fs: min, lines: eGreedy(s, min, ls, maxW, mono) };
}

/**
 * 整块最大宽度(安全区):左锚右边缘 ≤ x700、右锚左边缘 ≥ x1220。
 * 按锚点的缩放原点把 scale/offsetX 一起算进去(全局 fxScale 卡里拿不到,只算这张卡自己的 scale)。
 * 横版人脸线只按默认位置(offsetX=0)、默认大小(scale=1)算:手动拖开整块宽度锁住,不再越拖越窄;拖开后只防出画(离边 48)。
 */
function eMaxWidth(position: string, _ratio: string, ox: number, s: number) {
  const stageW = 1920;
  if (position === "left") {
    const frame = (stageW - 48 - 120 - ox) / s; // 左锚 left:120,缩放原点在左
    return Math.min(700 - 120, frame);
  }
  if (position === "right") {
    const frame = (stageW - 120 + ox - 48) / s; // 右锚 right:120,新动效从右边缘缩放:右缘固定,左缘 = 右缘 − W·s 不出画
    return Math.min(stageW - 120 - 1220, frame);
  }
  return (stageW - 96 - 2 * Math.abs(ox)) / s; // 居中:不出画、左右各留 48
}

function EntityChips({ params, playToken }: EffectProps<EntityChipsParams>) {
  const { position, chips, note, stepMs, accent } = params;
  const tm = params as { __t?: number; __start?: number; __end?: number };
  const tRaw = useCardElapsed(tm, playToken);
    const ratio = "h";
  // 有 __end 才退场:卡片时长 = __end − __start,最后 0.5s 收走;没有就一直停着
  const dur = typeof tm.__end === "number" ? Math.max(0, tm.__end - (tm.__start ?? 0)) : Infinity;
  const spd = usePlateSpeed(); // 动画速度:卡点(stepMs 排程)秒数不动,每个动作本身按它加快
  const t = Math.min(tRaw, dur);
  const OUT = dur - 0.5 / spd;
  const P = (a: number, o: number, d: number) => ePrg(t, a + o / spd, d / spd);
  const D = (a: number, o = 0) => (t - a) * spd - o;
  const exitP = (delay: number) => (Number.isFinite(dur) ? eInCubic(P(OUT, delay, 0.32)) : 0);

  const list = parseChips(chips);
  const n = list.length;
  const notes = (note ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 2);
  const step = (stepMs ?? 500) / 1000;
  const dir = position === "right" ? -1 : 1; // 右锚整块镜像:VS 在左、侧注靠右、向右收走
  // 参考作品的珊瑚橙:点缀色选 orange 时用原作的色(主题里的 orange 偏琥珀,压在象牙底上不够跳)
  const accB = accent === "orange" ? "#FF6A3D" : ACCENT_VAR[accent];
  const accBText = accent === "orange" ? "#E8572B" : ACCENT_VAR[accent];

  const cardScale = Number((params as { scale?: number }).scale) || 1;
  const maxW = eMaxWidth(position, ratio, params.offsetX ?? 0, cardScale);
  const isA = (c: Chip) => c.style === "dark"; // 「机器方」深底版
  const vsText = (params.vsText ?? "VS").trim();
  const hasVs = !!vsText && list.some((c, i) => i < n - 1 && isA(c) !== isA(list[i + 1]));
  const over = hasVs ? E_VS_OVER : 0;
  // 名牌宽:默认 440(参考作品),内容长就加宽到安全区为止;所有名牌同宽
  const maxPW = Math.max(300, Math.floor(maxW - over));
  const labelW = (c: Chip) => 34 + eTextW(c.sub, 15, 0.18, true) + 19 + 30;
  const want = Math.max(E_PW, ...list.map((c) => Math.max(64 + eTextW(c.name, 44, 0), c.sub ? labelW(c) : 0)));
  const PW = Math.min(maxPW, Math.ceil(want));

  // 每块名牌:身份小字(等宽 15px)放不下就折两行;名称 44px 是标题下限,不缩,只换行
  const rows = list.map((c) => {
    const lab = c.sub ? eFit(c.sub, PW - 34 - 19 - 30, 15, 15, 15, 0.18, true) : { fs: 15, lines: [] as string[] };
    const name = eFit(c.name, PW - 64, 44, 44, 44, 0);
    const labExtra = Math.max(0, lab.lines.length - 1) * 20;
    const nameLH = name.lines.length > 1 ? 50 : 44;
    const h = E_PH + labExtra + (name.lines.length - 1) * nameLH;
    const lastW = eTextW(name.lines[name.lines.length - 1] ?? "", 44, 0);
    return { lab, name, labExtra, nameLH, h, lastW };
  });
  const tops: number[] = [];
  rows.reduce((y, r) => (tops.push(y), y + r.h + E_GAP), 0);
  const platesBottom = n ? tops[n - 1] + rows[n - 1].h : 0;

  // 侧注:26px,放不下先折行再缩,不小于 18px
  const noteMaxW = maxW - 32 - 32;
  const noteRows = notes.map((s) => {
    const f = eFit(s, noteMaxW, 26, 24, 18, 0);
    const lh = f.fs * 1.15;
    return { ...f, lh, h: 17 + f.lines.length * lh };
  });
  const noteTops: number[] = [];
  noteRows.reduce((y, r) => (noteTops.push(y), y + r.h + 8), 0);
  const noteTop = platesBottom + 28;
  const noteBlockW = Math.max(0, ...noteRows.map((r) => 32 + Math.max(...r.lines.map((l) => eTextW(l, r.fs, 0))) + 32));
  const leadH = noteRows.length ? 28 + noteTops[noteRows.length - 1] + noteRows[noteRows.length - 1].h * 0.6 : 0;
  const totalH = noteRows.length ? noteTop + noteTops[noteRows.length - 1] + noteRows[noteRows.length - 1].h : platesBottom;
  const TW = Math.max(PW + over, 32 + noteBlockW);
  const plateX = dir > 0 ? 0 : TW - PW; // 名牌左边
  // 横版锚点是竖向居中(top 50% + offsetY):名牌多、字长时整块变高,上下各留 24px 不出画,出了就往回推
  let pushY = 0;
  {
    const half = (totalH * cardScale) / 2;
    const cy = 540 + (params.offsetY ?? 0);
    if (cy - half < 24) pushY = (24 - (cy - half)) / cardScale;
    else if (cy + half > 1056) pushY = (1056 - (cy + half)) / cardScale;
  }
  // 时刻:第 i 块 = i×间隔;VS = 后一块落下后 0.5s;侧注 = 全部名牌出完(n×间隔)
  const startOf = (i: number) => i * step;
  const noteT0 = n * step;
  // 退场倒序:侧注 0 → VS → 名牌自下而上,全部在 0.5s 内收完(参考作品两块:B 0.08、VS 0.04、A 0.16)
  const chipDelay = (i: number) => (0.16 * (n - i)) / Math.max(1, n);
  const vsDelay = (i: number) => Math.max(0, chipDelay(i + 1) - 0.04);

  return (
    <div
      className={`hud hud-anchor hud-anchor--${position} is-in`}
      // opacity:1 盖掉编辑台通用的末尾淡出([data-outro] .hud),退场完全由下面照搬的倒序收走负责
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), opacity: 1, ...(position === "right" && (params as { centerOnStage?: boolean }).centerOnStage !== true ? { transformOrigin: "100% 50%" } : null) }}
    >
      <div style={{ position: "relative", width: TW, height: totalH, fontFamily: E_SANS, transform: pushY ? `translateY(${pushY.toFixed(1)}px)` : undefined }}>
        {list.map((c, i) => {
          const r = rows[i];
          const s = startOf(i);
          const out = exitP(chipDelay(i));
          const nameTop = 46 + r.labExtra;
          const nameStyle = (k: number) => ({
            position: "absolute" as const, left: 32, top: nameTop, fontSize: 44, lineHeight: `${r.nameLH}px`,
            whiteSpace: "nowrap" as const, opacity: k, transform: `translateY(${((1 - k) * 14).toFixed(2)}px)`,
          });
          const labelStyle = {
            position: "absolute" as const, left: 34, top: 20, right: 30, fontSize: 15, lineHeight: "20px", fontWeight: 600,
            fontFamily: E_MONO, letterSpacing: "0.18em", whiteSpace: "nowrap" as const,
          };
          const nameEl = (k: number, color: string, weight: number) => (
            <div data-fx-role="label" style={{ ...nameStyle(k), color, fontWeight: weight }}>
              {r.name.lines.map((l, li) => <div key={li}>{l}</div>)}
            </div>
          );

          if (isA(c)) {
            /* ---- 机器方:横向擦出 + 逐字打出 ---- */
            const aIn = eOutExpo(P(s, 0, 0.55));
            const clip = ((1 - aIn) * 100).toFixed(2);
            const txt = Array.from(c.sub);
            const typeDur = 0.5 * Math.max(1, txt.length / 12); // 参考 12 个字母 0.5s 打完,更长按同速
            let left = Math.floor(ec(D(s, 0.2) / typeDur) * txt.length);
            const typed = r.lab.lines.map((l) => {
              const ch = Array.from(l);
              const k = Math.min(ch.length, left);
              left -= k;
              return ch.slice(0, k).join("");
            });
            const cursorOn = D(s, 0.2 + typeDur + 0.2) < 0 || Math.floor((t - s) * spd * 2.2) % 2 === 0; // 方块光标闪烁
            const an = eOutCubic(P(s, 0.25, 0.45));
            const cyc = ((D(s, 1.2) % 2.6) + 2.6) % 2.6; // 周期扫描光
            const scanX = -140 + (cyc / 0.9) * (PW + 260);
            let lastTyped = 0;
            typed.forEach((l, li) => (l || li === 0 ? (lastTyped = li) : 0));
            return (
              <div
                key={i}
                data-fx-role="item"
                style={{
                  position: "absolute", left: plateX, top: tops[i], width: PW, height: r.h, borderRadius: 14, overflow: "hidden",
                  background: "rgba(18,21,28,0.88)",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(150,185,255,0.18)",
                  opacity: (aIn > 0 ? 1 : 0) * (1 - out),
                  clipPath: dir > 0 ? `inset(0 ${clip}% 0 0 round 14px)` : `inset(0 0 0 ${clip}% round 14px)`,
                  transform: `translateX(${(dir * ((1 - aIn) * -24 - out * 60)).toFixed(2)}px)`,
                }}
              >
                <div
                  style={{
                    position: "absolute", inset: 0,
                    backgroundImage:
                      "linear-gradient(rgba(150,185,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(150,185,255,0.07) 1px,transparent 1px)",
                    backgroundSize: "16px 16px",
                  }}
                />
                <div
                  style={{
                    position: "absolute", top: 0, bottom: 0, left: 0, width: 120,
                    background: "linear-gradient(90deg,transparent,rgba(160,195,255,0.16),transparent)",
                    opacity: D(s, 1.2) > 0 ? 1 : 0, transform: `translateX(${scanX.toFixed(1)}px)`,
                  }}
                />
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: "#7FA8FF" }} />
                {c.sub && (
                  <div style={{ ...labelStyle, color: E_COOL }}>
                    {typed.map((l, li) => (
                      <div key={li} style={{ display: "flex", alignItems: "center", gap: 10, height: 20 }}>
                        <span>{l}</span>
                        {li === lastTyped && (
                          <i style={{ display: "inline-block", width: 9, height: 15, background: E_COOL, opacity: cursorOn ? 1 : 0 }} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {nameEl(an, "#E4E9F3", 500)}
              </div>
            );
          }

          /* ---- 主角方:带弹性的落位 + 手写下划线 ---- */
          const bp = P(s, 0, 0.7);
          const bs = eSpring(bp);
          const bn = eOutCubic(P(s, 0.15, 0.45));
          const ul = eOutCubic(P(s, 0.45, 0.5));
          const breathe = D(s, 0.5) > 0 ? 0.5 + 0.5 * Math.sin(D(s, 0.5) * 2.4) : 0; // 暖色呼吸点
          const ulW = Math.max(60, Math.min(PW - 60, r.lastW + 6));
          const sx = ulW / 270;
          const ulD = `M${2 * sx} 8 C ${50 * sx} 3, ${95 * sx} 12, ${140 * sx} 7 S ${225 * sx} 3, ${266 * sx} 8`;
          const ulTop = nameTop + r.name.lines.length * r.nameLH + 2;
          return (
            <div
              key={i}
              data-fx-role="item"
              style={{
                position: "absolute", left: plateX, top: tops[i], width: PW, height: r.h, borderRadius: 14, overflow: "hidden",
                background: "rgba(252,247,238,0.97)",
                boxShadow: "0 12px 32px rgba(60,30,10,0.22), inset 0 0 0 1px rgba(255,106,61,0.25)",
                opacity: ec(bp * 4) * (1 - out),
                transform: `translate(${(dir * ((1 - bs) * -36 - out * 60)).toFixed(2)}px,${((1 - bs) * 18).toFixed(2)}px) rotate(${(dir * (1 - bs) * -2.2).toFixed(3)}deg)`,
              }}
            >
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: accB }} />
              {c.sub && (
                <div style={{ ...labelStyle, color: accBText }}>
                  {r.lab.lines.map((l, li) => (
                    <div key={li} style={{ display: "flex", alignItems: "center", gap: 10, height: 20 }}>
                      {li === 0 ? (
                        <i style={{ position: "relative", width: 9, height: 9, flex: "none" }}>
                          <i
                            style={{
                              position: "absolute", left: -breathe * 5, top: -breathe * 5, width: 9 + breathe * 10, height: 9 + breathe * 10,
                              borderRadius: "50%", background: accB, opacity: 0.25 * (1 - breathe),
                              transform: `scale(${(0.85 + 0.35 * breathe).toFixed(3)})`,
                            }}
                          />
                          <i
                            style={{
                              position: "absolute", inset: 0, borderRadius: "50%", background: accB,
                              transform: `scale(${(0.85 + 0.35 * breathe).toFixed(3)})`,
                            }}
                          />
                        </i>
                      ) : (
                        <i style={{ width: 9, flex: "none" }} />
                      )}
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
              )}
              {nameEl(bn, "#1F1A16", 700)}
              <svg
                width={ulW} height={14} viewBox={`0 0 ${ulW} 14`}
                style={{ position: "absolute", left: 28, top: ulTop, overflow: "visible" }}
              >
                <path
                  d={ulD} pathLength={1} fill="none" stroke={accB} strokeWidth={5} strokeLinecap="round"
                  strokeDasharray="1 1" strokeDashoffset={(1 - ul).toFixed(4)} opacity={ul > 0 ? 1 : 0}
                />
              </svg>
            </div>
          );
        })}

        {/* ---- VS 徽章:只压在牌面不同的两块之间 ---- */}
        {list.map((c, i) => {
          if (!vsText || i >= n - 1 || isA(c) === isA(list[i + 1])) return null;
          const vStart = startOf(i + 1) + 0.5 / spd;
          const vp = P(vStart, 0, 0.55);
          const vsS = eSpring(vp);
          const vOut = exitP(vsDelay(i));
          const upA = isA(c);
          const topBg = upA ? "#14171E" : "#FCF7EE";
          const botBg = upA ? "#FCF7EE" : "#14171E";
          const topInk = upA ? E_COOL : accB;
          const botInk = upA ? accB : E_COOL;
          const cy = tops[i] + rows[i].h + E_GAP / 2;
          const vx = dir > 0 ? PW - 30 : TW - PW + 30 - E_VS;
          return (
            <div
              key={`vs${i}`}
              style={{
                position: "absolute", left: vx, top: cy - E_VS / 2, width: E_VS, height: E_VS, borderRadius: "50%",
                background: `linear-gradient(180deg,${topBg} 50%,${botBg} 50%)`,
                boxShadow: "0 6px 16px rgba(0,0,0,0.3), 0 0 0 3px rgba(255,255,255,0.9)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: ec(vp * 5) * (1 - vOut),
                transform: `scale(${(vsS * (1 - vOut * 0.6)).toFixed(3)}) rotate(${((1 - vsS) * -90 * dir + Math.sin(Math.max(0, D(vStart, 0.6)) * 0.9) * 3).toFixed(2)}deg)`,
              }}
            >
              <span
                style={{
                  // 徽章直径 56:字多时缩字号塞进圆里(VS 两个字母 = 原作 19px)
                  fontFamily: E_MONO, fontWeight: 800, fontSize: Math.min(19, 40 / Math.max(0.01, eTextW(vsText, 1, 0.04, true))), lineHeight: 1, letterSpacing: "0.04em", whiteSpace: "nowrap",
                  background: `linear-gradient(180deg,${topInk} 50%,${botInk} 50%)`,
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                }}
              >
                {vsText}
              </span>
            </div>
          );
        })}

        {/* ---- 侧注:竖向引线 + 每行一块深色小底依次滑入 ---- */}
        {noteRows.length > 0 && (() => {
          const nOut = exitP(0);
          const lp = eOutCubic(P(noteT0, 0, 0.4));
          const leadX = dir > 0 ? 16 : TW - 18;
          return (
            <>
              <div
                style={{
                  position: "absolute", left: leadX, top: platesBottom, width: 2, height: lp * leadH,
                  background: "rgba(255,255,255,0.9)", boxShadow: "0 0 0 1px rgba(0,0,0,0.12)", opacity: 1 - nOut,
                }}
              />
              {noteRows.map((r, i) => {
                const k = eOutCubic(P(noteT0, 0.15 + i * 0.17, 0.45));
                return (
                  <div
                    key={i}
                    data-small-text={i === 0 ? "noteA" : "noteB"}
                    style={{
                      position: "absolute", top: noteTop + noteTops[i],
                      ...(dir > 0 ? { left: 32 } : { right: 32 }),
                      padding: "8px 16px 9px", borderRadius: 8, background: "rgba(18,21,28,0.78)", filter: undefined,
                      color: "#F1F3F7", fontSize: r.fs, fontWeight: 500, lineHeight: `${r.lh}px`, whiteSpace: "nowrap",
                      textAlign: dir > 0 ? "left" : "right",
                      opacity: k * (1 - nOut),
                      transform: `translateX(${(dir * ((1 - k) * -18 - nOut * 40)).toFixed(2)}px)`,
                    }}
                  >
                    {r.lines.map((l, li) => <div key={li}>{l}</div>)}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}


export const entityChipsDef: EffectDef<EntityChipsParams> = {
  id: "entity-chips",
  name: "EntityChips",
  description: "实体名牌 · 人物/公司锚定牌,滑入后常驻",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    chips: "light|白牌写机构名|EN OR ROLE\ndark|黑牌写人名|头衔 · 点缀色",
    note: "侧注上行|下行写代码或身份",
    stepMs: 500,
    vsText: "VS",
    accent: "blue",
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
        { label: "居中", value: "center" },
        { label: "右侧", value: "right" },
      ],
    },
    {
      key: "chips",
      label: "名牌(一行一块:light/dark|名称|身份或EN,最多 3 块)",
      type: "textarea",
      rows: 3,
    },
    { key: "note", label: "侧注(上行|下行,写代码/头衔类小字)", type: "text" },
    { key: "stepMs", label: "逐块滑入间隔", type: "range", min: 0, max: 1500, step: 100, unit: "ms" },
    { key: "vsText", label: "两块之间的圆徽章字(精修版,留空不显示)", type: "text" },
    { key: "accent", label: "点缀色(黑牌身份行)", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: EntityChips,
};
