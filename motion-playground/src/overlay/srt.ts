/** SRT 字幕解析:给编辑台的字幕稿面板用 */
export interface SrtLine {
  start: number;
  end: number;
  text: string;
}

function toSec(t: string): number {
  const m = t.trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)$/);
  if (!m) return NaN;
  return (
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
  );
}

/** 宽松解析:跳过序号行,合并同条多行文本,忽略坏块 */
export function parseSrt(text: string): SrtLine[] {
  const lines: SrtLine[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const rows = block.split("\n").filter((r) => r.trim());
    const ti = rows.findIndex((r) => r.includes("-->"));
    if (ti === -1) continue;
    const [a, b] = rows[ti].split("-->");
    const start = toSec(a);
    const end = toSec(b);
    const body = rows.slice(ti + 1).join(" ").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !body) continue;
    lines.push({ start, end, text: body });
  }
  return lines.sort((a, b) => a.start - b.start);
}

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

/** 字幕稿 → SRT 文本。交给 AI 助手时用 ——
 *  字幕是转写出来的,原文件根本不存在;不还原成 SRT,AI 就没有任何东西可读。 */
export function toSrtText(lines: SrtLine[]): string {
  return lines
    .map((l, i) => `${i + 1}\n${stamp(l.start)} --> ${stamp(l.end)}\n${l.text}\n`)
    .join("\n");
}
