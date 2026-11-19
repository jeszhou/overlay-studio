import { EFFECTS } from "../effects/registry";
interface ContentFields {
  title?: string;
  body?: string;
  rhythm?: string;
  separator?: string;
}

const CONTENT_FIELDS: Record<string, ContentFields> = {
  "type-shift": { body: "lines" },
  "blur-text": { body: "text", rhythm: "staggerMs" },
  "term-card": { title: "term", body: "def", separator: "," },
  checklist: { title: "title", body: "items", rhythm: "stepMs" },
  "punch-pill": { body: "text", separator: " · " },
  "quote-lockup": { body: "quote" },
  "step-timeline": { title: "title", body: "steps" },
  "focus-card": { body: "items", rhythm: "stepMs" },
};
const GENERIC = ["theme", "accent", "offsetX", "offsetY", "scale", "speed"];

/** 把旧卡参数尽量翻译成新卡参数:通用设置 + 落位 + 标题 + 条目 + 节奏 */
export function swapCardParams(
  oldKind: string,
  old: Record<string, unknown>,
  newKind: string,
): Record<string, unknown> {
  const def = EFFECTS.find((e) => e.id === newKind);
  if (!def || oldKind === newKind) return old;
  const defaults = def.defaults as Record<string, unknown>;
  const p: Record<string, unknown> = { ...defaults };

  for (const k of GENERIC) if (old[k] !== undefined) p[k] = old[k];

  // 落位:position / side 互通(left/right 直接带过去)
  const pos = (old.position ?? old.side) as string | undefined;
  if (pos) {
    // 不同卡的锚点枚举不同,不能把 left 填给只支持 top/bottom/center 的卡。
    // 无效 class 会让卡失去定位,看起来像替换后消失。
    for (const key of ["position", "side"]) {
      const control = def.controls.find((c) => c.key === key && c.type === "select");
      if (control?.type === "select" && control.options.some((o) => o.value === pos)) p[key] = pos;
    }
  }

  for (const control of def.controls) {
    if (Object.hasOwn(old, control.key) && ["text", "textarea"].includes(control.type))
      p[control.key] = old[control.key];
  }
  const sourceFields = CONTENT_FIELDS[oldKind];
  const targetFields = CONTENT_FIELDS[newKind];
  if (sourceFields && targetFields) {
    if (
      sourceFields.title &&
      targetFields.title &&
      Object.hasOwn(defaults, targetFields.title) &&
      old[sourceFields.title] != null
    )
      p[targetFields.title] = old[sourceFields.title];
    if (
      sourceFields.body &&
      targetFields.body &&
      Object.hasOwn(defaults, targetFields.body) &&
      old[sourceFields.body] != null
    ) {
      const items = String(old[sourceFields.body])
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length) {
        p[targetFields.body] = items.join(targetFields.separator ?? "|");
      }
    }
    if (
      sourceFields.rhythm &&
      targetFields.rhythm &&
      Object.hasOwn(defaults, targetFields.rhythm) &&
      old[sourceFields.rhythm] != null
    )
      p[targetFields.rhythm] = old[sourceFields.rhythm];
  }

  // 计数字段跟着条目数走:打勾数 / 揭示到第几章,别留模板默认值
  if (targetFields?.body && typeof p[targetFields.body] === "string") {
    const n = String(p[targetFields.body])
      .split("|")
      .filter((s) => s.trim()).length;
    if ("checked" in defaults) p.checked = n;
    if ("revealed" in defaults) p.revealed = n;
  }
  return p;
}
