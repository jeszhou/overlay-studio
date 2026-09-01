import type { EffectDef, EffectProps } from "../types";
import { useTimelineTime } from "./useTimelineTime";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./accent";

export interface CaptionTrackParams {
  theme: "dark" | "light";
  /**
   * 字幕表,一行一条:起始秒|结束秒|中文(*关键词*变色)|英文小字(可空)
   * 例:12.4|15.2|把*工作流*完整跑一遍|Run the full workflow
   */
  lines: string;
  /** 字幕字体(src/assets/fonts/ 里的家族名,空 = 跟全局) */
  font?: string;
  /** 描边开关 */
  strokeOn?: boolean;
  /** 描边宽度(px) */
  strokeW?: number;
  /** 描边颜色 */
  strokeColor?: string;
  accent: string;
  /** 显示英文小字行 */
  showEn: boolean;
  offsetX?: number;
  offsetY?: number;
  __t?: number;
}

interface Cue {
  start: number;
  end: number;
  zh: string;
  en: string;
}

function parseCues(raw: string): Cue[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const p = l.split("|");
      return {
        start: parseFloat(p[0]) || 0,
        end: parseFloat(p[1]) || 0,
        zh: p[2] ?? "",
        en: p[3] ?? "",
      };
    })
    .filter((c) => c.end > c.start && c.zh);
}

/** 中文行内 *关键词* 用强调色点亮 */
function renderZh(text: string) {
  return text
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((seg, i) =>
      seg.startsWith("*") && seg.endsWith("*") ? (
        <i className="ctrack-kw" key={i}>
          {seg.slice(1, -1)}
        </i>
      ) : (
        <span key={i}>{seg}</span>
      ),
    );
}

/**
 * 常驻双语字幕层:中文主行 + 英文小字,关键词强调色点亮。
 * 画面从头到尾"被设计过"的另一半来源。
 * 用法:一张卡从 0 拉到视频结尾;导入 SRT 会自动生成这张卡,
 * 英文和关键词由生成器(或你手动)补进字幕表。
 */

/** 环形阴影描边:16+8 方向把字往外描一圈,拐角圆润(text-stroke 是尖角会炸毛);
    末尾拼上原有的柔和黑晕,黑白底都稳 */
function capShadow(w: number, color: string, haloK: number): string {
  const halo = `0 1px 2px rgba(0,0,0,${0.9 * haloK}), 0 0 14px rgba(0,0,0,${0.55 * haloK}), 0 6px 28px rgba(0,0,0,${0.45 * haloK})`;
  if (!w || w <= 0) return halo;
  const ring: string[] = [];
  // 外环方向数随宽度自适应(相邻拷贝间距 < 0.5px),再补两层内环填实,
  // 描出来是一圈匀净的圆角轮廓,不会有尖刺也不会有扇贝状缺口
  const n = Math.max(24, Math.ceil(w * 12));
  for (const [r, k] of [[1, n], [0.62, Math.round(n * 0.6)], [0.3, Math.round(n * 0.35)]] as [number, number][]) {
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      ring.push(`${(Math.cos(a) * w * r).toFixed(2)}px ${(Math.sin(a) * w * r).toFixed(2)}px 0 ${color}`);
    }
  }
  return ring.join(", ") + ", " + halo;
}

function CaptionTrack({ params, playToken }: EffectProps<CaptionTrackParams>) {
  const { lines, accent, showEn } = params;
  const t = useTimelineTime(params, playToken);
  const cues = parseCues(lines);
  const idx = cues.findIndex((c) => t >= c.start && t < c.end);
  const cue = idx >= 0 ? cues[idx] : null;
  if (!cue) return null;

  return (
    <div
      className="hud ctrack"
      data-stroke={params.strokeOn ? "on" : "off"}
      style={{
        ...(params.font ? { fontFamily: `"${params.font}", "IBM Plex Sans SC", sans-serif` } : {}),
        ["--cap-stroke-w" as string]: `${params.strokeOn ? (params.strokeW ?? 3) : 0}px`,
        ["--cap-stroke-color" as string]: params.strokeColor || "#000000",
        ["--cap-shadow" as string]: capShadow(params.strokeOn ? (params.strokeW ?? 3) : 0, params.strokeColor || "#000000", 1),
        ["--cap-shadow-en" as string]: capShadow(params.strokeOn ? (params.strokeW ?? 3) * 0.6 : 0, params.strokeColor || "#000000", 0.7), ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      {/* key 换行触发重新进场的淡入 */}
      <div className="ctrack-cue" key={idx}>
        <div className="ctrack-zh">{renderZh(cue.zh)}</div>
        {showEn && cue.en && <div className="ctrack-en">{cue.en}</div>}
      </div>
    </div>
  );
}

export const captionTrackDef: EffectDef<CaptionTrackParams> = {
  id: "caption-track",
  name: "CaptionTrack",
  description: "常驻双语字幕 · 中文主行 + 英文小字 + 关键词点亮",
  tags: ["扫过点亮"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    font: "",
    strokeOn: false,
    strokeW: 3,
    strokeColor: "#000000",
    lines:
      "0|4|这里是*双语字幕层*的中文主行|This is the bilingual caption layer\n" +
      "4|8|加星号的词会被*强调色*点亮|Starred words light up in accent\n" +
      "8|12|它跟着时间轴自动换行|It follows the timeline",
    accent: "blue",
    showEn: true,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "lines",
      label: "字幕表(起始|结束|中文|英文,一行一条)",
      type: "textarea",
      rows: 8,
    },
    { key: "font", label: "字幕字体(assets/fonts 家族名,空=跟全局)", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    { key: "showEn", label: "英文小字行", type: "toggle" },
    { key: "strokeOn", label: "描边(开/关)", type: "toggle" },
    { key: "strokeW", label: "描边宽度", type: "range", min: 1, max: 8, step: 0.5, unit: "px" },
    { key: "strokeColor", label: "描边颜色(取色器带吸管)", type: "color" },
    ...OFFSET_CONTROLS,
  ],
  Component: CaptionTrack,
};
