import { EFFECTS } from "../effects/registry";
import type { StageRatio } from "../stage";

/** 时间轴上的一张动效卡 */
export interface OverlayCard {
  id: string; // 唯一标识,如 "card-1"
  kind: string; // 卡片类型 = 特效 id(registry 里的 31 种之一)
  start: number; // 出现时间(秒,来自 SRT)
  end: number; // 消失时间(秒)
  /** 段落分组:同 seg 的卡进左列自动顺排容器(段头卡是整段拖拽把手) */
  seg?: string;
  /** 检查器忽略标记(用户主动决定):true = 整卡免检;数组 = 忽略指定规则名 */
  lintOff?: boolean | string[];
  params: Record<string, unknown>; // 该特效的参数(缺省字段用特效默认值补齐)
}

/**
 * 底幕先画:选了「置于底层」的 glass-pane 排到渲染列表最前,
 * 配合 CSS 里的 z0,底幕就真的在所有卡下面——不管它在时间轴里排第几张。
 * (sort 是稳定的,其余卡的相对顺序不动)
 */
export function backdropFirst<T extends OverlayCard>(cards: T[]): T[] {
  const rank = (c: T) => {
    if (c.kind === "frost-screen") return 0;
    return c.kind === "glass-pane" && (c.params.layer ?? "back") !== "front" ? 0 : 1;
  };
  return cards.slice().sort((a, b) => rank(a) - rank(b));
}

/** 退场淡出时长(秒):卡片在 end 前留这么久整卡溶解 */
export const OUTRO_SEC = 0.3;

/**
 * 退场淡出:返回卡片在 t 时刻的整卡不透明度(0~1)。
 *
 * 可见区间是左闭右开(t >= start && t < end),走到 end 那一刻卡片直接从 DOM 卸掉,
 * 没有播退场动画的余地 —— 只能硬切。时间轴末尾又常有好几张卡的 end 压在同一秒
 * (常驻章节条/字幕层 + 结尾卡),于是最后一帧不是「某张卡没了」,而是「全场清空」,
 * 看着就是闪一下。这里赶在卸载前先把它淡掉。
 *
 * 淡出全程在 end 之前走完,不会和下一张卡叠在一起。
 * 逐帧算成定值、不走 CSS transition —— 导出是虚拟时间,过渡不可信。
 */
export function outroFade(t: number, card: { start: number; end: number }): number {
  // 短卡不能让淡出吃掉大半条命:淡出最多占自身时长的四分之一
  const fade = Math.min(OUTRO_SEC, Math.max(0, card.end - card.start) * 0.25);
  if (fade <= 0) return 1;
  const left = card.end - t;
  if (left >= fade) return 1;
  return Math.min(1, Math.max(0, left / fade));
}

/** Overlay 工程文件(Skill 生成 / Studio 导入导出) */
export interface OverlayDoc {
  version: 1;
  theme?: "dark" | "light"; // 全局主题,卡片 params.theme 可覆盖
  /** 文字可读性光晕(默认关;true 才开)——开了字会发虚,按画面自己定 */
  glow?: boolean;
  /** 全局口播视频(H264):运镜卡 camSrc 留空时导出统一用它,按时间轴自动对位 */
  cam?: string;
  /** 全局字体(src/assets/fonts/ 里的文件名):空 = 默认 IBM Plex Sans SC */
  font?: string;
  /** 皮肤(hud.css 的 data-skin 令牌组):rose/iris/dawn,空 = 默认现状配色 */
  skin?: string;
  /** 风格骨架(hud.css 的 data-style 令牌组):skin 换配色,style 换材质骨架;sketch = 手绘白卡 */
  style?: string;
  /** 画幅:h = 16:9 横版(默认),v = 9:16 竖版。缺省 = 横版,老工程文件行为不变 */
  ratio?: StageRatio;
  /** 侧边色块(仅 sketch 风格):卡片左缘一道漫画感色带,hex 颜色,空 = 不要色块 */
  sideColor?: string;
  /** 全局文字色:盖住皮肤自带的 --hud-ink(主文字),次要文字自动按同色降透明度。
   *  空 = 用皮肤默认值。这是「盖一层」,不改各卡参数,随时清空即恢复。 */
  inkColor?: string;
  cards: OverlayCard[];
}

/**
 * 校验 + 规范化:补默认参数、按 start 排序。
 *
 * 认不出的卡**跳过,不作废整份编排**。以前一见 unknown kind 就整份
 * 返回错误 —— 免费版卡少,拿到一份用完整版做的编排,用户看到的是「导入失败」
 * 四个字,像是软件坏了,而其余十几张明明都放得出来。跳过的卡放进 dropped 带出去,
 * 由调用方明说少了哪几张,别让它无声消失。
 *
 * 只有「连 cards 数组都没有」这类根本不是编排的输入才整份拒绝。
 */
export function parseOverlay(raw: unknown): {
  doc?: OverlayDoc;
  error?: string;
  /** 被跳过的卡:kind = 认不出的类型,n = 这份编排里有几张 */
  dropped?: { kind: string; n: number }[];
} {
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || !Array.isArray(o.cards)) return { error: "缺少 cards 数组" };
    const ids = new Set<string>();
    const cards: OverlayCard[] = [];
    const dropCount = new Map<string, number>();
    for (let i = 0; i < o.cards.length; i++) {
      const c = o.cards[i];
      const def = EFFECTS.find((e) => e.id === c.kind);
      if (!def) {
        const k = String(c?.kind ?? "(没写 kind)");
        dropCount.set(k, (dropCount.get(k) ?? 0) + 1);
        continue;
      }
      if (typeof c.start !== "number" || typeof c.end !== "number" || c.end <= c.start)
        return { error: `第 ${i + 1} 张卡片时间非法: start=${c.start} end=${c.end}` };
      const id = String(c.id ?? `card-${i + 1}`);
      if (ids.has(id)) return { error: `卡片 id 重复: "${id}"` };
      ids.add(id);
      // 特效默认值垫底,JSON 里的参数覆盖
      const params = { ...def.defaults, ...(c.params ?? {}) };
      // 旧档迁移:letter-glitch 的翻动速度曾叫 speed(与全局「动画速度」撞名 → N 倍速),搬到 flipMs
      if (c.kind === "letter-glitch" && typeof params.speed === "number" && params.speed > 8) {
        if (typeof params.flipMs !== "number") params.flipMs = params.speed;
        delete params.speed;
      }
      const seg = typeof c.seg === "string" && c.seg ? c.seg : undefined;
      const lintOff =
        c.lintOff === true
          ? true
          : Array.isArray(c.lintOff) && c.lintOff.every((r: unknown) => typeof r === "string")
            ? (c.lintOff as string[])
            : undefined;
      cards.push({ id, kind: c.kind, start: c.start, end: c.end, seg, lintOff, params });
    }
    cards.sort((a, b) => a.start - b.start);
    // 一张都不认识:多半不是「少几张卡」,而是拿错了文件或者版本对不上。
    // 这种情况给整份错误比给一份空编排有用 —— 空编排会让人以为文件是空的。
    if (!cards.length && dropCount.size)
      return {
        error: `这份编排里的 ${o.cards.length} 张卡这一版都不支持(${[...dropCount.keys()]
          .slice(0, 3)
          .join("、")}${dropCount.size > 3 ? " 等" : ""})`,
      };
    const dropped = [...dropCount].map(([kind, n]) => ({ kind, n }));
    const theme = o.theme === "light" ? "light" : o.theme === "dark" ? "dark" : undefined;
    return {
      dropped: dropped.length ? dropped : undefined,
      doc: {
        version: 1,
        theme,
        glow: o.glow === true,
        cam: typeof o.cam === "string" && o.cam ? o.cam : undefined,
        font: typeof o.font === "string" && o.font ? o.font : undefined,
        skin: ["rose", "iris", "dawn"].includes(o.skin) ? o.skin : undefined,
        style: ["sketch"].includes(o.style) ? o.style : undefined,
        ratio: o.ratio === "v" ? "v" : undefined,
        sideColor: typeof o.sideColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.sideColor) ? o.sideColor : undefined,
        inkColor: typeof o.inkColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.inkColor) ? o.inkColor : undefined,
        cards,
      },
    };
  } catch (e) {
    return { error: `JSON 解析失败: ${e}` };
  }
}
