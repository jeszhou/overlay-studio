import type { EffectDef, EffectProps } from "../types";
import { useEnter } from "../useAnimation";
import { useTimelineTime } from "./useTimelineTime";
import { ACCENT_OPTIONS, ACCENT_VAR, THEME_OPTIONS } from "./accent";

export interface ChapterBarParams {
  theme: "dark" | "light";
  /** 章节表:「名称 起始秒」用 | 分隔,如 "引入 0 | 变现问题 17 | 工作流 43" */
  chapters: string;
  accent: string;
  /** 当前章节底部显示进度线 */
  showProgress: boolean;
  /** 进度形态:fill 整条上色往前推 · line 只在当前章底部一条细线 */
  progMode?: "fill" | "line";
  /** 进度色(空=跟随强调色) */
  progAccent?: string;
  /** 进度色透明度(0.1-1,只要跟底色分得开就行) */
  progAlpha?: number;
  /** 编辑台/导出注入:时间轴当前秒 */
  __t?: number;
  /** 编辑台/导出注入:本卡结束秒(最后一章的进度终点) */
  __end?: number;
}

interface Chapter {
  label: string;
  start: number;
}

/** "引入 0 | 变现问题 17" → [{label, start}],按 start 升序 */
function parseChapters(raw: string): Chapter[] {
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(.*?)\s+([\d.]+)$/);
      return m
        ? { label: m[1].trim(), start: parseFloat(m[2]) }
        : { label: seg, start: 0 };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * 常驻章节导航条:整期视频的地图,贴在画面顶部全程在场。
 * 当前章节高亮 + 章内进度线,讲到哪一章观众随时知道。
 * 用法:一张卡从 0 拉到视频结尾,章节表按你的稿子分段填。
 */
function ChapterBar({ params, playToken }: EffectProps<ChapterBarParams>) {
  const { chapters, accent, showProgress, progMode, progAccent, progAlpha } = params;
  const entered = useEnter(playToken);
  const t = useTimelineTime(params, playToken);
  const items = parseChapters(chapters);
  if (!items.length) return null;

  // 当前章 = 最后一个 start <= t 的章节
  let active = 0;
  for (let i = 0; i < items.length; i++) if (t >= items[i].start) active = i;
  // 章内进度:本章 start → 下一章 start(最后一章用卡片结束时间兜底)
  const cs = items[active].start;
  const ce = items[active + 1]?.start ?? params.__end ?? cs + 30;
  const pct = Math.min(1, Math.max(0, (t - cs) / Math.max(ce - cs, 0.1)));
  // 整条进度 = 已讲完的章(整格) + 当前章内进度(半格),所以颜色是一路往右推的
  const fill = ((active + pct) / items.length) * 100;
  const isFill = (progMode ?? "fill") === "fill";

  return (
    <div
      className={`hud cbar ${entered ? "is-in" : ""}`}
      style={{
        ["--hud-acc" as string]: ACCENT_VAR[accent],
        ["--cbar-prog" as string]: ACCENT_VAR[progAccent || accent],
        ["--cbar-alpha" as string]: `${Math.round((progAlpha ?? 0.25) * 100)}%`,
      }}
    >
      {showProgress && isFill && <i className="cbar-fill" style={{ width: `${fill}%` }} />}
      {items.map((c, i) => (
        <span
          key={i}
          className={`cbar-item ${i === active ? "is-on" : ""} ${i < active ? "is-done" : ""}`}
        >
          <span className="cbar-lb">{c.label}</span>
          {i === active && showProgress && !isFill && (
            <i className="cbar-prog" style={{ width: `${pct * 100}%` }} />
          )}
        </span>
      ))}
    </div>
  );
}

export const chapterBarDef: EffectDef<ChapterBarParams> = {
  id: "chapter-bar",
  name: "ChapterBar",
  description: "常驻章节导航 · 顶部全程在场的本期地图",
  tags: ["生长描画"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    chapters: "开场 0 | 章节名 6 | 按起始秒填 14 | 结尾 24",
    accent: "blue",
    showProgress: true,
    progMode: "fill",
    progAccent: "",
    progAlpha: 0.25,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    { key: "chapters", label: "章节表(名称 起始秒,| 分隔)", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "showProgress", label: "显示进度", type: "toggle" },
    {
      key: "progMode",
      label: "进度形态",
      type: "select",
      options: [
        { label: "整条上色 · 往前推", value: "fill" },
        { label: "细线 · 只在当前章底部", value: "line" },
      ],
    },
    {
      key: "progAccent",
      label: "进度色(默认跟随强调色)",
      type: "select",
      options: [{ label: "跟随强调色", value: "" }, ...ACCENT_OPTIONS],
    },
    { key: "progAlpha", label: "进度色透明度", type: "range", min: 0.1, max: 1, step: 0.05 },
  ],
  Component: ChapterBar,
};
