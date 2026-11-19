import type {SrtLine} from './srt';
import { EFFECTS } from "../effects/registry";

/** 时间轴上的一张动效卡 */
export interface OverlayCard {
  id: string; // 唯一标识,如 "card-1"
  kindBackups?: Record<string, {params: Record<string, unknown>; seg?: string}>;
  kind: string; // 卡片类型 = 特效 id(registry 里的一种)
  start: number; // 出现时间(秒,来自 SRT)
  end: number; // 消失时间(秒)
  /** 段落分组:同 seg 的卡进左列自动顺排容器(段头卡是整段拖拽把手) */
  seg?: string;
  /** 检查器忽略标记(用户主动决定):true = 整卡免检;数组 = 忽略指定规则名 */
  lintOff?: boolean | string[];
  params: Record<string, unknown>; // 该特效的参数(缺省字段用特效默认值补齐)
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
  projectId?: string;
  projectName?: string;
  srt?: SrtLine[];
  previewVideo?: string;
  reviewOrigin?: OverlayDoc;
  layerOrder?: "manual";
  fontAssets?: {family: string; url: string; weight?: string}[];
  ratio?: "h" | "v" | "4:3";
  exportFps?: number;
  videoScale?: number;
  fxScale?: number;
  animSpeed?: number;
  version: 1;
  theme?: "dark" | "light"; // 全局主题,卡片 params.theme 可覆盖
  /** 文字可读性光晕(默认关;true 才开)——开了字会发虚,按画面自己定 */
  glow?: boolean;
  /** 呼吸感:卡片落定后微动(手持镜头、漂浮、落地余震、跟随)。整片一个开关,默认关;单卡可用 params.breath 改 */
  breath?: boolean;
  /** 全局口播视频(H264):运镜卡 camSrc 留空时导出统一用它,按时间轴自动对位 */
  cam?: string;
  /** 全局字体(src/assets/fonts/ 里的文件名):空 = 默认 IBM Plex Sans SC */
  font?: string;
  /** 全局文字色:盖住主题自带的 --hud-ink(主文字),次要文字自动按同色降透明度。
   *  空 = 用主题默认值。这是「盖一层」,不改各卡参数,随时清空即恢复。 */
  inkColor?: string;
  cards: OverlayCard[];
}

/**
 * 校验 + 规范化:补默认参数、按 start 排序。
 *
 * 认不出的卡**跳过,不作废整份编排**。以前一见 unknown kind 就整份
 * 返回错误 —— 编排里混进一张不认识的卡,用户看到的是「导入失败」
 * 四个字,像是软件坏了,而其余的卡明明都放得出来。跳过的卡放进 dropped 带出去,
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
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const o = Array.isArray(parsed?.overlay?.cards)
      ? {...parsed.overlay, srt: parsed.overlay.srt ?? parsed.srt ?? undefined,
         previewVideo: parsed.overlay.previewVideo ?? parsed.videoUrl,
         reviewOrigin: parsed.overlay.reviewOrigin ?? parsed.origin}
      : parsed;
    if (!o || !Array.isArray(o.cards)) return { error: "缺少 cards 数组" };
    if (o.cards.length > 10_000) return {error: '工程超过 10,000 张卡，请拆分后打开'};
    if (o.srt != null && (!Array.isArray(o.srt) || o.srt.length > 10_000 || o.srt.some((line: SrtLine) =>
      !line || typeof line.text !== 'string' || !Number.isFinite(line.start) || !Number.isFinite(line.end)
      || line.start < 0 || line.end < line.start))) return {error: '工程中的字幕文字或时间无效'};
    const ids = new Set<string>();
    const cards: OverlayCard[] = [];
    const dropCount = new Map<string, number>();
    for (let i = 0; i < o.cards.length; i++) {
      const c = o.cards[i];
      if (!c || typeof c !== 'object' || Array.isArray(c)) return {error: `第 ${i + 1} 张卡片数据无效`};
      const def = EFFECTS.find((e) => e.id === c.kind);
      if (!def) {
        const k = String(c?.kind ?? "(没写 kind)");
        dropCount.set(k, (dropCount.get(k) ?? 0) + 1);
        continue;
      }
      if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start)
        return { error: `第 ${i + 1} 张卡片时间非法: start=${c.start} end=${c.end}` };
      const id = String(c.id ?? `card-${i + 1}`);
      if (ids.has(id)) return { error: `卡片 id 重复: "${id}"` };
      ids.add(id);
      // 特效默认值垫底,JSON 里的参数覆盖
      const params = { ...def.defaults, ...(c.params ?? {}) };
      const seg = typeof c.seg === "string" && c.seg ? c.seg : undefined;
      const lintOff =
        c.lintOff === true
          ? true
          : Array.isArray(c.lintOff) && c.lintOff.every((r: unknown) => typeof r === "string")
            ? (c.lintOff as string[])
            : undefined;
      cards.push({ id, kind: c.kind, start: c.start, end: c.end, seg, lintOff, params, kindBackups: c.kindBackups && typeof c.kindBackups === "object" ? c.kindBackups : undefined });
    }
    if (o.layerOrder !== "manual") cards.sort((a, b) => a.start - b.start);
    // 一张都不认识:多半不是「少几张卡」,而是拿错了文件或者版本对不上。
    // 这种情况给整份错误比给一份空编排有用 —— 空编排会让人以为文件是空的。
    if (!cards.length && dropCount.size)
      return {
        error: `这份编排里的 ${o.cards.length} 张卡都不认识(${[...dropCount.keys()]
          .slice(0, 3)
          .join("、")}${dropCount.size > 3 ? " 等" : ""})`,
      };
    const dropped = [...dropCount].map(([kind, n]) => ({ kind, n }));
    const theme = o.theme === "light" ? "light" : o.theme === "dark" ? "dark" : undefined;
    return {
      dropped: dropped.length ? dropped : undefined,
      doc: {
        version: 1,
        projectId: typeof o.projectId === 'string' && o.projectId ? o.projectId : undefined,
        projectName: typeof o.projectName === 'string' ? o.projectName : undefined,
        srt: o.srt ?? undefined,
        previewVideo: typeof o.previewVideo === 'string' && /^\/(?:_media|_projects|demo)\//.test(o.previewVideo) ? o.previewVideo : undefined,
        reviewOrigin: Array.isArray(o.reviewOrigin?.cards) ? {...o.reviewOrigin, reviewOrigin: undefined} : undefined,
        fontAssets: Array.isArray(o.fontAssets) ? o.fontAssets.filter((f: {url:string;family:string}) => f && typeof f.family === 'string' && typeof f.url === 'string' && /^\/_projects\//.test(f.url)) : undefined,
        ratio: o.ratio === '4:3' || o.ratio === 'v' ? o.ratio : undefined,
        layerOrder: o.layerOrder === 'manual' ? 'manual' : undefined,
        exportFps: [29.97,30,50,60].includes(o.exportFps) ? o.exportFps : undefined,
        videoScale: Number.isFinite(o.videoScale) ? o.videoScale : undefined,
        fxScale: Number.isFinite(o.fxScale) ? o.fxScale : undefined,
        animSpeed: Number.isFinite(o.animSpeed) ? o.animSpeed : undefined,
        theme,
        glow: o.glow === true,
        breath: o.breath === true ? true : undefined,
        cam: typeof o.cam === "string" && o.cam ? o.cam : undefined,
        font: typeof o.font === "string" && o.font ? o.font : undefined,
        inkColor: typeof o.inkColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.inkColor) ? o.inkColor : undefined,
        cards,
      },
    };
  } catch (e) {
    return { error: `JSON 解析失败: ${e}` };
  }
}
