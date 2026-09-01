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
