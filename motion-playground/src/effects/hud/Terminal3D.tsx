import type { EffectDef, EffectProps } from "../types";
import { useElapsed } from "../useAnimation";
import { OFFSET_CONTROLS, OFFSET_DEFAULTS, offsetVars, THEME_OPTIONS } from "./accent";

export interface Terminal3DParams {
  theme: "dark" | "light";
  position: "center" | "left" | "right";
  file: string;
  lines: string; // 用 | 分隔各行
  cps: number; // 每秒打字字符数
  offsetX?: number;
  offsetY?: number;
}

type Cls = "prompt" | "flag" | "str" | "cmt" | "ok" | "bad" | "ink";
interface Ch { c: string; cls: Cls }

/** 一行拆成带语法色的字符序列 */
function tokenizeLine(line: string): Ch[] {
  const out: Ch[] = [];
  const parts = line.split(/(\s+)/);
  let comment = false;
  for (const p of parts) {
    if (p === "") continue;
    let cls: Cls = "ink";
    if (p.trim() === "") cls = "ink";
    else if (comment) cls = "cmt";
    else if (p.startsWith("#")) { comment = true; cls = "cmt"; }
    else if (p === "$" || p === "❯" || p === ">") cls = "prompt";
    else if (/^-{1,2}[\w-]+$/.test(p)) cls = "flag";
    else if (/^["'].*["']$/.test(p)) cls = "str";
    else if (p.startsWith("✓")) cls = "ok";
    else if (p.startsWith("✗") || p.startsWith("✕")) cls = "bad";
    for (const c of p) out.push({ c, cls });
  }
  return out;
}

function Terminal3D({ params, playToken }: EffectProps<Terminal3DParams>) {
  const { position, file, lines, cps } = params;
  const elapsed = useElapsed(playToken, 30000);

  const raw = lines.split("|");
  const chars: Ch[] = [];
  raw.forEach((line, i) => {
    tokenizeLine(line).forEach((ch) => chars.push(ch));
    if (i < raw.length - 1) chars.push({ c: "\n", cls: "ink" });
  });

  const revealed = Math.min(chars.length, Math.floor((elapsed / 1000) * cps));
  const typing = revealed < chars.length;
  const visible = chars.slice(0, revealed);

  // 按换行分组,再把连续同色合并成 span
  const renderLines: Ch[][] = [[]];
  for (const ch of visible) {
    if (ch.c === "\n") renderLines.push([]);
    else renderLines[renderLines.length - 1].push(ch);
  }

  return (
    <div
      className={`hud t3 hud-anchor hud-anchor--${position} is-in`}
      style={offsetVars(params)}
    >
      <div className="t3-card">
        <div className="t3-bar">
          <span className="t3-dot r" />
          <span className="t3-dot y" />
          <span className="t3-dot g" />
          <span className="t3-file">{file}</span>
        </div>
        <div className="t3-body">
          <div className="t3-scroll">
          {renderLines.map((ln, li) => {
            const spans: { text: string; cls: Cls }[] = [];
            for (const ch of ln) {
              const last = spans[spans.length - 1];
              if (last && last.cls === ch.cls) last.text += ch.c;
              else spans.push({ text: ch.c, cls: ch.cls });
            }
            const isLast = li === renderLines.length - 1;
            return (
              <div className="t3-line" key={li}>
                {spans.map((s, si) => (
                  <span className={`tk-${s.cls}`} key={si}>{s.text}</span>
                ))}
                {isLast && <span className="t3-caret" />}
                {ln.length === 0 && !isLast ? " " : ""}
              </div>
            );
          })}
          {!typing && null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const terminal3DDef: EffectDef<Terminal3DParams> = {
  id: "terminal-3d",
  vTier: "full",
  name: "Terminal3D",
  description: "3D 终端打字机 · 多色逐字打命令",
  tags: ["3D 浮屏", "逐条落位"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    position: "center",
    file: "demo — 终端演示",
    lines:
      "$ 敲一条命令 --带参数|# 注释:说明这一步在干嘛|❯ 执行过程逐字打出 ...|✓ 结果一行,绿勾收尾",
    cps: 26,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "底色(此卡独立生效)", type: "select", options: THEME_OPTIONS },
    {
      key: "position",
      label: "落位",
      type: "select",
      options: [
        { label: "居中", value: "center" },
        { label: "左侧", value: "left" },
        { label: "右侧", value: "right" },
      ],
    },
    { key: "file", label: "标题栏文件名", type: "text" },
    { key: "lines", label: "命令行(用 | 分隔;$提示符 -参数 \"字符串\" #注释 ✓成功 ✗失败)", type: "text" },
    { key: "cps", label: "打字速度(字/秒)", type: "range", min: 8, max: 60, step: 2 },
    ...OFFSET_CONTROLS,
  ],
  Component: Terminal3D,
};
