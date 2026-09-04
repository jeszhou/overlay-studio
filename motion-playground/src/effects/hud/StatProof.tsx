import type { EffectDef, EffectProps } from "../types";
import { useCountUp, useEnter } from "../useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
  GLASS_DEFAULTS,
  glassClass,
  glassVars,
} from "./accent";

export interface StatProofParams {
  theme: "dark" | "light";
  position: "left" | "right" | "center" | "top-left" | "top-right";
  /** 顶部 EN 等宽 kicker */
  kicker: string;
  /** kicker 的中文小注 */
  kickerZh: string;
  /** 目标数字(滚动计数到这里) */
  value: number;
  /** 数字后缀,如 "+" "%" */
  suffix: string;
  /** 数字前缀,如 "+" "¥" */
  prefix: string;
  /** 底部 EN 注脚 */
  footEn: string;
  /** 底部中文注脚(数字的出处) */
  footZh: string;
  /** 计数时长(卡点用) */
  countMs: number;
  accent: string;
  offsetX?: number;
  offsetY?: number;
  glass?: "none" | "dark" | "light";
  glassAlpha?: number;
}

/**
 * 数字实证卡:裸排版滚动计数(无底板),四件套解剖 —
 * EN kicker + 中文小注 / 巨号数字 / EN 注脚 + 中文注脚。
 * 用在里程碑、成绩、金额等"用数字说话"的时刻。
 */
function StatProof({ params, playToken }: EffectProps<StatProofParams>) {
  const { position, kicker, kickerZh, value, suffix, prefix, footEn, footZh, countMs, accent } =
    params;
  const entered = useEnter(playToken);
  // 目标数字兼容文本输入("29593"/"92.4")
  const target = Number(value) || 0;
  const n = useCountUp(target, countMs, playToken);
  const decimals = Number.isInteger(target) ? 0 : 1;
  const shown = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <div
      className={`hud ${glassClass(params.glass)} spf hud-anchor hud-anchor--${position} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params), ...glassVars(params.glassAlpha) }}
    >
      <div className="spf-box">
        <div className="spf-kicker">
          <i className="spf-bar" />
          <span className="spf-kicker-en">{kicker}</span>
        </div>
        {kickerZh && <div className="spf-kicker-zh">{kickerZh}</div>}
        <div className="spf-num">
          {prefix && <span className="spf-fix">{prefix}</span>}
          {shown}
          {suffix && <span className="spf-fix spf-suffix">{suffix}</span>}
        </div>
        {footEn && <div className="spf-foot-en">{footEn}</div>}
        {footZh && <div className="spf-foot-zh">{footZh}</div>}
      </div>
    </div>
  );
}

export const statProofDef: EffectDef<StatProofParams> = {
  id: "stat-proof",
  name: "StatProof",
  description: "数字实证 · 巨号滚动计数 + 双语注脚",
  tags: ["滚动计数"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "left",
    kicker: "EN KICKER · HERE",
    kickerZh: "中文小注写在这",
    value: 10000,
    suffix: "+",
    prefix: "",
    footEn: "EN FOOTNOTE · SOURCE",
    footZh: "数字的出处写在这",
    countMs: 1600,
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
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
        { label: "居中", value: "center" },
        { label: "左上", value: "top-left" },
        { label: "右上", value: "top-right" },
      ],
    },
    { key: "kicker", label: "顶部 kicker(英文等宽)", type: "text" },
    { key: "kickerZh", label: "kicker 中文小注", type: "text" },
    { key: "value", label: "目标数字(可带小数)", type: "text" },
    { key: "prefix", label: "数字前缀(+/¥)", type: "text" },
    { key: "suffix", label: "数字后缀(+/%)", type: "text" },
    { key: "footEn", label: "注脚(英文等宽)", type: "text" },
    { key: "footZh", label: "注脚(中文)", type: "text" },
    { key: "countMs", label: "计数时长(卡点用)", type: "range", min: 400, max: 5000, step: 100, unit: "ms" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: StatProof,
};
