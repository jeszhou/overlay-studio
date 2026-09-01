import { EFFECTS } from "../effects/registry";
import { parseOverlay, type OverlayCard, type OverlayDoc } from "./types";

/**
 * overlay JSON 检查器(纯函数,只报告、永不改写)。
 * error = 绝不可能是故意的硬伤;warn = 违反编排规律,人判优先。
 * 卡片带 lintOff(true = 整卡免检;字符串数组 = 忽略指定规则)即用户主动决定,静默跳过。
 */
export interface LintIssue {
  level: "error" | "warn";
  /** 问题锚定的卡(解析类问题没有卡) */
  cardId?: string;
  /** 问题锚定的时间点(秒):没有卡但有位置的问题(如空白段)用它定位 */
  at?: number;
  /** 规则名,lintOff 数组里写它可单独忽略 */
  rule: string;
  message: string;
}

/** 阈值配置:lint-rules.default.json 公共温和默认,lint-rules.local.json 个人覆盖 */
export interface LintConfig {
  /** 内容卡最短驻留秒数(快闪警告) */
  minDwell: number;
  /** 不受驻留规则约束的卡型(氛围/运镜/常驻类) */
  dwellExemptKinds: string[];
  /** 同段同屏卡 offsetY 至少要错开的像素 */
  minOffsetGap: number;
  /** 相邻两个动作(卡进场或板内行点亮)之间允许的最长空白秒数 */
  maxQuietGap: number;
  /** 允许的 scale 档位;空数组 = 不检查 */
  scaleTiers: number[];
  /** 档位容差 */
  scaleTolerance: number;
  /** 出现 caption-track 卡时提醒(原片可能已有烧录字幕) */
  warnCaptionTrack: boolean;
  /** 文案里出现精确小数百分比时提醒口语化取整 */
  warnDecimalPercent: boolean;
  /** 底板叠层检查:用常驻玻璃底幕(frost-screen/glass-pane)当垫层的工作流才打开。
   *  默认关 —— 「板要不要自带底」是风格选择,不是对错 */
  warnBackdropStack: boolean;
  /** 块级小标题(section-head size=s)的 offsetY 下限;0 = 不检查。
   *  只有把 size=s 当"钉在别处的块级标题"用的工作流才需要设 */
  blockTitleMinOffsetY: number;
}

export const LINT_DEFAULTS: LintConfig = {
  minDwell: 2,
  dwellExemptKinds: [
    "burst-halo",
    "light-sweep",
    "punch-zoom",
    "cam-pan",
    "ambient-wash",
    "glass-pane",
    "frost-screen",
    "chapter-bar",
    "caption-track",
    "ghost-video",
    "icon-pop",
  ],
  minOffsetGap: 90,
  maxQuietGap: 10,
  scaleTiers: [],
  scaleTolerance: 0.06,
  warnCaptionTrack: true,
  warnDecimalPercent: true,
  warnBackdropStack: false,
  blockTitleMinOffsetY: 0,
};

export function mergeLintConfig(...parts: (Partial<LintConfig> | null | undefined)[]): LintConfig {
  const out = { ...LINT_DEFAULTS };
  for (const p of parts) if (p) Object.assign(out, p);
  return out;
}

/** 组件默认值里"示例文案"的判定:中文演示句,或带明显占位标记 */
function isDemoCopy(s: string): boolean {
  if (!s) return false;
  const cjk = (s.match(/[一-鿿]/g) ?? []).length;
  if (/示例|占位|可空|这一行|写在这|HERE/.test(s)) return true;
  return cjk >= 4;
}

function ruleOff(card: OverlayCard, rule: string): boolean {
  const off = (card as OverlayCard & { lintOff?: boolean | string[] }).lintOff;
  if (off === true) return true;
  return Array.isArray(off) && off.includes(rule);
}

/** 逐条点亮/铺开/收队型卡片的"卡内节奏"规格:起始时刻 + 间隔 × 条数 */
interface SeqSpec {
  /** 起始时刻参数(秒,距卡片 start);缺省 = 从卡片 start 起 */
  at?: string;
  /** 间隔参数(ms);"__span" = 均分整张卡的时长(逐字打字这类连续动作) */
  step: string;
  /** 条目列表参数 */
  list: string;
  /** 列表分隔符,默认换行 */
  sep?: string;
}

const SEQ_SPECS: Record<string, SeqSpec[]> = {
  "clip-parade": [
    { at: "buildAt", step: "buildStepMs", list: "tiles" },
    { at: "paradeAt", step: "paradeStepMs", list: "tiles" },
    // 自由摆放模式的块数看 img1-3
    { at: "buildAt", step: "buildStepMs", list: "__imgs" },
    { at: "paradeAt", step: "paradeStepMs", list: "__imgs" },
  ],
  "video-showcase": [{ at: "startAt", step: "stepMs", list: "clips" }],
  "icon-swarm": [{ at: "startAt", step: "stepMs", list: "items" }],
  "glow-badges": [{ at: "badgesAt", step: "stepMs", list: "badges", sep: "|" }],
  "terminal-3d": [{ step: "__span", list: "lines", sep: "|" }],
  "kinetic-words": [{ step: "holdMs", list: "chunks", sep: "|" }],
  "karaoke-line": [{ step: "wordMs", list: "words", sep: "|" }],
  "checklist": [{ step: "stepMs", list: "items", sep: "|" }],
  "pain-points": [{ step: "stepMs", list: "pains", sep: "|" }],
  "chip-cluster": [{ step: "stepMs", list: "chips", sep: "|" }],
  "stepper-flow": [{ step: "stepMs", list: "steps", sep: "|" }],
  "flow-chart": [{ step: "stepMs", list: "nodes", sep: "|" }],
  "fact-stack": [{ step: "stepMs", list: "items", sep: "|" }],
  "rule-card": [{ step: "stepMs", list: "bans", sep: "|" }],
  "bar-race": [{ step: "stepMs", list: "rows", sep: "|" }],
  "entity-chips": [{ step: "stepMs", list: "chips" }],
  "outline-tree": [{ step: "stepMs", list: "kids", sep: "|" }],
  "number-beats": [{ step: "holdMs", list: "points", sep: "|" }],
  "word-spin": [{ step: "spinMs", list: "words", sep: "|" }],
  "card-swap": [{ step: "swapMs", list: "cards", sep: "|" }],
  "focus-card": [{ step: "stepMs", list: "items", sep: "|" }],
  "focus-takeover": [{ step: "stepMs", list: "items", sep: "|" }],
  "proof-shot": [{ step: "stepMs", list: "__imgs" }],
  "phone-shot": [{ step: "stepMs", list: "__imgs" }],
};

/** 从 times 类参数 + 卡内逐条节奏里抽出动作时间点(板内行点亮、逐块铺开都算) */
function actionTimes(card: OverlayCard): number[] {
  const out: number[] = [];
  const p = (card.params ?? {}) as Record<string, unknown>;

  const t = p.times;
  if (typeof t === "string") {
    out.push(
      ...t
        .split(/[|,\s]+/)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .map((n) => card.start + n),
    );
  }

  // 复刻入库:三站 + 落库 + 小注,各算一个动作
  if (card.kind === "replicate-loop") {
    for (const v of String(p.stopsAt ?? "").split("|").map(Number))
      if (Number.isFinite(v)) out.push(card.start + v);
    for (const k of ["intoAt", "noteAt"]) {
      const v = Number(p[k]);
      if (Number.isFinite(v)) out.push(card.start + v);
    }
  }

  // 基建三拍:三拍各算一个动作(一张卡陪跑整段,靠内部卡点撑节奏)
  if (card.kind === "studio-build") {
    for (const k of ["libAt", "deckAt", "payAt"]) {
      const v = Number(p[k]);
      if (Number.isFinite(v)) out.push(card.start + v);
    }
  }

  // 手托展示:左右两次托起各算一个动作
  if (card.kind === "hand-lift") {
    for (const k of ["leftAt", "rightAt"]) {
      const v = Number(p[k]);
      if (Number.isFinite(v)) out.push(card.start + v);
    }
  }

  for (const spec of SEQ_SPECS[card.kind] ?? []) {
    const n =
      spec.list === "__imgs"
        ? ["img1", "img2", "img3"].filter((k) => typeof p[k] === "string" && p[k]).length
        : typeof p[spec.list] === "string"
          ? (p[spec.list] as string)
              .split(spec.sep ?? "\n")
              .map((x) => x.trim())
              .filter(Boolean).length
          : 0;
    if (n < 1) continue;
    const at = spec.at ? Number(p[spec.at]) || 0 : 0;
    const stepSec =
      spec.step === "__span"
        ? (card.end - card.start) / Math.max(n, 1)
        : (Number(p[spec.step]) || 0) / 1000;
    if (!Number.isFinite(stepSec) || stepSec <= 0) {
      out.push(card.start + at);
      continue;
    }
    for (let i = 0; i < n; i++) out.push(card.start + at + i * stepSec);
  }

  return out.filter((v) => v >= card.start - 0.01 && v <= card.end + 0.01);
}

/** 检查一份已解析的 overlay 文档 */
export function lintOverlay(
  doc: OverlayDoc,
  config?: Partial<LintConfig> | null,
  opts?: { duration?: number },
): LintIssue[] {
  const cfg = mergeLintConfig(config);
  const issues: LintIssue[] = [];
  const push = (i: LintIssue) => issues.push(i);
  const cards = doc.cards;

  for (const c of cards) {
    const def = EFFECTS.find((e) => e.id === c.kind);
    if (!def) continue; // parseOverlay 已拦,防御而已

    // error: 占位/示例文案残留(参数值 === 组件默认演示文案,导出会真的渲染出来)
    if (!ruleOff(c, "placeholder-text")) {
      for (const [k, v] of Object.entries(c.params ?? {})) {
        const d = (def.defaults as Record<string, unknown>)[k];
        if (typeof v === "string" && v !== "" && v === d && isDemoCopy(v)) {
          push({
            level: "error",
            cardId: c.id,
            rule: "placeholder-text",
            message: `「${c.id}」(${c.kind}) 的 ${k} 还是组件示例文案「${String(v).slice(0, 18)}…」,不用就清成空字符串`,
          });
        }
      }
    }

    // error: 时间越界(提供视频时长时)
    if (opts?.duration && !ruleOff(c, "over-duration") && c.end > opts.duration + 0.5) {
      push({
        level: "error",
        cardId: c.id,
        rule: "over-duration",
        message: `「${c.id}」end=${c.end}s 超过视频时长 ${opts.duration}s`,
      });
    }

    // warn: 吃口播视频的卡没给素材 —— 预览走 PIP 直接搬你导入的那条,看得到人;
    // 导出只在填了 camSrc(或全局 doc.cam)时才把人烤进透明层,不填就导出一个空框。
    // 预览和成片不一致且没有任何提示,是最容易白导一次的坑,所以在导出前拦一下。
    if (!ruleOff(c, "missing-cam")) {
      const takesCam = def.controls?.some((x) => (x as { key?: string }).key === "camSrc");
      if (takesCam && !c.params?.camSrc && !doc.cam) {
        push({
          level: "warn",
          cardId: c.id,
          rule: "missing-cam",
          message: `「${c.id}」(${c.kind}) 没填「口播视频」、全局也没设 —— 预览里看得到人,导出会是个空框`,
        });
      }
    }

    // warn: 内容卡驻留过短(快闪)
    if (
      !ruleOff(c, "short-dwell") &&
      !cfg.dwellExemptKinds.includes(c.kind) &&
      c.end - c.start < cfg.minDwell
    ) {
      push({
        level: "warn",
        cardId: c.id,
        rule: "short-dwell",
        message: `「${c.id}」(${c.kind}) 只驻留 ${(c.end - c.start).toFixed(1)}s(< ${cfg.minDwell}s),快闪不如驻留到论点讲完`,
      });
    }

    // warn: scale 不在三档制
    const scale = c.params?.scale;
    if (
      !ruleOff(c, "scale-tier") &&
      cfg.scaleTiers.length &&
      typeof scale === "number" &&
      !cfg.scaleTiers.some((t) => Math.abs(t - scale) <= cfg.scaleTolerance)
    ) {
      push({
        level: "warn",
        cardId: c.id,
        rule: "scale-tier",
        message: `「${c.id}」scale=${scale} 不在约定档位 [${cfg.scaleTiers.join("/")}],尺寸跳来跳去是"乱"的主要来源`,
      });
    }

    // warn: 精确小数百分比(口语化取整更好听)
    if (cfg.warnDecimalPercent && !ruleOff(c, "decimal-percent")) {
      for (const [k, v] of Object.entries(c.params ?? {})) {
        if (typeof v === "string" && /\d+\.\d+\s*%/.test(v)) {
          push({
            level: "warn",
            cardId: c.id,
            rule: "decimal-percent",
            message: `「${c.id}」的 ${k} 含精确小数「${(v.match(/\d+\.\d+\s*%/) ?? [""])[0]}」,口播里取整更顺("16.2%"→"不到 17%")`,
          });
          break; // 一张卡报一次就够
        }
      }
    }
  }

  // warn: caption-track 提醒(原片可能已有烧录字幕,动效层再加就重复)
  if (cfg.warnCaptionTrack) {
    const cap = cards.find((c) => c.kind === "caption-track" && !ruleOff(c, "caption-track"));
    if (cap) {
      push({
        level: "warn",
        cardId: cap.id,
        rule: "caption-track",
        message: `编排里有字幕卡「${cap.id}」——先确认原片没有烧录字幕,有就删掉这张`,
      });
    }
  }

  // warn: 块级小标题(section-head size=s)没挪开落位。
  // 默认关(blockTitleMinOffsetY: 0)。这条只对"把 size=s 当块级标题、钉在画面别处"
  // 的工作流成立;把 size=s 当小一号段头、就该待在段头位置的人不该被它烦。
  if (cfg.blockTitleMinOffsetY > 0) {
    for (const c of cards) {
      if (c.kind !== "section-head" || c.params?.size !== "s") continue;
      if (ruleOff(c, "block-title-anchor")) continue;
      const oy = Number(c.params?.offsetY) || 0;
      if (oy < cfg.blockTitleMinOffsetY) {
        push({
          level: "warn",
          cardId: c.id,
          rule: "block-title-anchor",
          message: `「${c.id}」是块级小标题(size=s)但 offsetY=${oy}(< ${cfg.blockTitleMinOffsetY}),会和同段的大段头叠在左上角——给它一个明确的落位`,
        });
      }
    }
  }

  // warn: 底板叠了两层 / 亮画面上没有底板
  // 实践里遇到过:把 8 块 info-board 的 bg 全从 dark 改成 none —— 因为那一期已经有
  // 常驻的 frost-screen/glass-pane 垫在下面,单卡再垫一块就是两层灰板。反过来,没有
  // 垫层的时间段上 bg:"none" 的白字浮在日光米白墙上,导出合成后基本看不清。
  if (cfg.warnBackdropStack) {
  const SOLID_BACKDROPS = ["frost-screen", "glass-pane"];
  // 只查"板底"类的 bg。demo-rail / clip-parade / video-showcase 的 bg 是"全屏底"
  // (整块盖住原片换景),和垫在文字后面的玻璃板不是一回事,叠着是对的
  const BOARD_BG_KINDS = ["info-board", "glow-badges", "diverge-lines"];
  const panes = cards.filter((c) => SOLID_BACKDROPS.includes(c.kind));
  const coveredAt = (t: number) => panes.some((p) => t >= p.start && t < p.end);
  for (const c of cards) {
    const bg = c.params?.bg;
    if (!BOARD_BG_KINDS.includes(c.kind)) continue;
    if (typeof bg !== "string" || ruleOff(c, "backdrop-stack")) continue;
    const mid = (c.start + c.end) / 2;
    if (bg !== "none" && coveredAt(mid)) {
      push({
        level: "warn",
        cardId: c.id,
        rule: "backdrop-stack",
        message: `「${c.id}」(${c.kind}) bg="${bg}",但这一刻已经有常驻玻璃底幕垫着了——两层灰板叠一起,底板留一层就够(改 bg:"none")`,
      });
    } else if (bg === "none" && !coveredAt(mid)) {
      push({
        level: "warn",
        cardId: c.id,
        rule: "backdrop-stack",
        message: `「${c.id}」(${c.kind}) bg="none" 且这一刻没有玻璃底幕垫着——白字直接压实拍画面,亮片里会看不清`,
      });
    }
  }
  }

  // warn: 同屏散卡叠在一起。同 seg 的卡有自动顺排容器不会叠,只查没进段的散卡:
  // 时间重叠 + 同落位 + offsetX/offsetY 都没错开 = 真的压在一起
  // 背景垫层(glass-pane/ambient-wash 这类)本来就该铺在别的卡下面,不算叠卡
  const BACKDROP_KINDS = ["glass-pane", "frost-screen", "ambient-wash", "letter-glitch"];
  const loose = cards.filter((c) => !c.seg && !BACKDROP_KINDS.includes(c.kind));
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i];
      const b = loose[j];
      const later = a.start <= b.start ? b : a;
      if (ruleOff(later, "stack-overlap")) continue;
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (overlap <= 0.5) continue;
      // 没有落位参数的卡是全屏氛围/常驻层(ambient-wash/chapter-bar 等),不参与叠卡检查
      const posA = String(a.params?.position ?? a.params?.side ?? "");
      const posB = String(b.params?.position ?? b.params?.side ?? "");
      if (!posA || !posB || posA !== posB) continue;
      const gapY = Math.abs(Number(a.params?.offsetY ?? 0) - Number(b.params?.offsetY ?? 0));
      const gapX = Math.abs(Number(a.params?.offsetX ?? 0) - Number(b.params?.offsetX ?? 0));
      if (gapY < cfg.minOffsetGap && gapX < cfg.minOffsetGap) {
        push({
          level: "warn",
          cardId: later.id,
          rule: "stack-overlap",
          message: `「${a.id}」和「${b.id}」同屏同落位(${posA || "默认"}),offset 几乎没错开(Y差${gapY}px/X差${gapX}px),会叠在一起——错开或并进同一段`,
        });
      }
    }
  }

  // warn: 长时间无新动作(卡进场和板内行点亮都算动作)
  if (cards.length && cfg.maxQuietGap > 0) {
    const times = cards
      .flatMap((c) => [c.start, ...actionTimes(c)])
      .sort((x, y) => x - y);
    const lastEnd = Math.max(...cards.map((c) => c.end));
    times.push(lastEnd);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > cfg.maxQuietGap) {
        push({
          level: "warn",
          at: times[i - 1],
          rule: "quiet-gap",
          message: `${times[i - 1].toFixed(1)}s → ${times[i].toFixed(1)}s 之间 ${gap.toFixed(1)}s 没有任何新动作(> ${cfg.maxQuietGap}s)——重要的话要有卡点动效,可补一行或拆细 times`,
        });
      }
    }
  }

  return issues;
}

/** 从原始 JSON 文本一步到位:解析失败算 error,成功则继续 lint */
export function lintOverlayText(
  text: string,
  config?: Partial<LintConfig> | null,
  opts?: { duration?: number },
): { doc?: OverlayDoc; issues: LintIssue[] } {
  const { doc, error } = parseOverlay(text);
  if (error || !doc) {
    return { issues: [{ level: "error", rule: "parse", message: error ?? "解析失败" }] };
  }
  return { doc, issues: lintOverlay(doc, config, opts) };
}
