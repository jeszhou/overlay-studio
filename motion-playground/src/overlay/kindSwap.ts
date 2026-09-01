import { EFFECTS } from "../effects/registry";

/**
 * 换卡时的「内容搬家」映射:每种卡声明自己的
 *  t = 标题字段  b = 正文/条目字段(| 分隔)  r = 节奏字段
 *  from = 从复合条目里取纯文字  to = 把纯文字包成新卡的条目格式  sep = 正文拼接符
 */
interface CMap {
  t?: string;
  b?: string;
  r?: string;
  from?: (s: string) => string;
  to?: (s: string, i: number) => string;
  sep?: string;
}

const stripIcon = (s: string) => (s.includes(",") ? s.split(",").slice(1).join(",") : s);
const stripTag = (s: string) => {
  const parts = s.split(",");
  return parts.length > 1 ? parts.slice(1).join(" · ") : s;
};
const numTag = (s: string, i: number) => `${String(i + 1).padStart(2, "0")},${s},`;

const M: Record<string, CMap> = {
  "kinetic-words": { b: "chunks", r: "holdMs" },
  "karaoke-line": { b: "words", r: "wordMs" },
  "number-beats": { b: "points", r: "holdMs" },
  "word-spin": { b: "words", r: "spinMs" },
  "outline-tree": { t: "root", b: "kids", r: "stepMs" },
  "type-shift": { b: "lines" },
  "marker-highlight": { b: "text", sep: "," },
  "blur-text": { b: "text", r: "staggerMs" },
  "decrypt-text": { b: "text", sep: " " },
  "true-focus": { b: "words", r: "focusMs" },
  "pain-points": { t: "kicker", b: "pains", r: "stepMs" },
  "term-card": { t: "term", b: "def", sep: "," },
  "steer-hint": { t: "head", b: "points" },
  checklist: { t: "title", b: "items", r: "stepMs" },
  "quote-cite": { b: "quote", sep: "," },
  "punch-pill": { b: "text", sep: " · " },
  "quote-lockup": { b: "quote" },
  "step-timeline": { t: "title", b: "steps" },
  "flow-chart": { t: "title", b: "nodes", r: "stepMs" },
  "ecosystem-hub": { t: "hub", b: "icons", from: stripIcon, to: (s) => `✦,${s}` },
  "chip-cluster": { t: "title", b: "chips", from: stripIcon, to: (s) => `✦,${s}`, r: "stepMs" },
  "card-swap": { b: "cards", from: stripTag, to: numTag, r: "swapMs" },
  "stepper-flow": { b: "steps", r: "stepMs" },
  "magic-bento": { b: "cells", from: stripTag, to: numTag, r: "spotMs" },
  converge: { t: "core", b: "nodes" },
  "focus-card": { b: "items", r: "stepMs" },
};

const GENERIC = ["theme", "accent", "offsetX", "offsetY", "scale", "speed"];

/** 把旧卡参数尽量翻译成新卡参数:通用设置 + 落位 + 标题 + 条目 + 节奏 */
export function swapCardParams(
  oldKind: string,
  old: Record<string, unknown>,
  newKind: string,
): Record<string, unknown> {
  const def = EFFECTS.find((e) => e.id === newKind);
  if (!def) return old;
  const dflt = def.defaults as Record<string, unknown>;
  const p: Record<string, unknown> = { ...dflt };

  for (const k of GENERIC) if (old[k] !== undefined) p[k] = old[k];

  // 落位:position / side 互通(left/right 直接带过去)
  const pos = (old.position ?? old.side) as string | undefined;
  if (pos) {
    if ("position" in dflt) p.position = pos;
    if ("side" in dflt) p.side = pos === "left" || pos === "right" ? pos : dflt.side;
  }

  const om = M[oldKind];
  const nm = M[newKind];
  if (om && nm) {
    if (om.t && nm.t && old[om.t] != null) p[nm.t] = old[om.t];
    if (om.b && nm.b && old[om.b] != null) {
      const items = String(old[om.b])
        .split("|")
        .map((s) => (om.from ? om.from(s.trim()) : s.trim()))
        .filter(Boolean);
      if (items.length) {
        p[nm.b] = items.map((s, i) => (nm.to ? nm.to(s, i) : s)).join(nm.sep ?? "|");
      }
    }
    if (om.r && nm.r && old[om.r] != null) p[nm.r] = old[om.r];
  }

  // 计数字段跟着条目数走:打勾数 / 揭示到第几章,别留模板默认值
  if (nm?.b && typeof p[nm.b] === "string") {
    const n = String(p[nm.b]).split("|").filter((s) => s.trim()).length;
    if ("checked" in dflt) p.checked = n;
    if ("revealed" in dflt) p.revealed = n;
  }
  return p;
}

/** 两种卡之间能否自动搬正文内容(搬不了时调用方给用户明确提示) */
export function canCarryContent(oldKind: string, newKind: string): boolean {
  return Boolean(M[oldKind]?.b && M[newKind]?.b);
}
