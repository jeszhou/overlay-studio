import type { EffectDef, EffectProps } from "./types";
import { useEnter } from "./useAnimation";
import {
  ACCENT_OPTIONS,
  ACCENT_VAR,
  OFFSET_CONTROLS,
  OFFSET_DEFAULTS,
  offsetVars,
  THEME_OPTIONS,
} from "./hud/accent";

export interface QuoteLockupParams {
  theme: "dark" | "light";
  side: "left" | "right";
  quote: string;
  author: string;
  accent: string;
  offsetX?: number;
  offsetY?: number;
}

function QuoteLockup({ params, playToken }: EffectProps<QuoteLockupParams>) {
  const { side, quote, author, accent } = params;
  const entered = useEnter(playToken);
  // 用 “|” 手动分行,逐行 mask 揭示
  const lines = quote.split("|").map((l) => l.trim());

  return (
    <div
      className={`hud ql hud-anchor hud-anchor--${side} ${entered ? "is-in" : ""}`}
      style={{ ["--hud-acc" as string]: ACCENT_VAR[accent], ...offsetVars(params) }}
    >
      <div className="ql-card hud-glass">
        <div className="ql-mark hud-fade">&ldquo;</div>
        <div className="ql-body">
          {lines.map((line, i) => (
            <span className="ql-line" key={i}>
              <span style={{ transitionDelay: `${140 + i * 150}ms` }}>{line}</span>
            </span>
          ))}
        </div>
        <div className="ql-rule" />
        {author && (
          <div className="ql-author hud-fade" style={{ transitionDelay: "320ms" }}>
            {author}
          </div>
        )}
      </div>
    </div>
  );
}

export const quoteLockupDef: EffectDef<QuoteLockupParams> = {
  id: "quote-lockup",
  vTier: "half",
  name: "QuoteLockup",
  description: "金句定格卡 · 逐行揭示后定格",
  tags: ["逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    side: "right",
    quote: "多行金句|逐行揭示,|停在画面上。",
    author: "— 署名放这里",
    accent: "blue",
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "side",
      label: "落位",
      type: "select",
      options: [
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "quote", label: "金句(用 | 分行)", type: "text" },
    { key: "author", label: "署名", type: "text" },
    { key: "accent", label: "强调色", type: "select", options: ACCENT_OPTIONS },
    ...OFFSET_CONTROLS,
  ],
  Component: QuoteLockup,
};
