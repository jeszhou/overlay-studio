/**
 * 数据展示卡(2026-10 数据批次)共用的小工具:条目解析、数字格式、多系列配色。
 * 只放两张以上数据卡都要用的东西。
 */

/** "名称:数值:数值" 一行一条(| 或换行分隔)→ [{ name, nums }] */
export function parseRows(v: string | undefined): { name: string; nums: number[]; raw: string[] }[] {
  return (v ?? "")
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/[:：]/).map((s) => s.trim());
      return { name, raw: rest, nums: rest.map((s) => Number(s.replace(/−/g, "-").replace(/[,，+%]/g, ""))) };
    });
}

/** 把 "¥12,480.5万" 拆成前缀 / 数值 / 后缀,滚动时保持原格式 */
export function parseFigure(s: string) {
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(s.trim());
  if (!m) return { prefix: s, value: 0, suffix: "", decimals: 0, comma: false };
  const num = m[2];
  const dot = num.indexOf(".");
  return {
    prefix: m[1],
    value: Number(num.replace(/,/g, "")),
    suffix: m[3],
    decimals: dot < 0 ? 0 : num.length - dot - 1,
    comma: num.includes(","),
  };
}

export function fmtNum(v: number, decimals = 0, comma = true) {
  const s = Math.abs(v).toFixed(decimals);
  const [i, d] = s.split(".");
  const ii = comma ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : i;
  return (v < 0 ? "-" : "") + ii + (d ? "." + d : "");
}

/** 格式化一个按进度 p 滚到位的数字(保留原字符串的前后缀、小数位、千分位) */
export function rollFigure(s: string, p: number) {
  const f = parseFigure(s);
  return f.prefix + fmtNum(f.value * p, f.decimals, f.comma) + f.suffix;
}

/** 多系列色:第 0 个是强调色,往后逐级混向底板色,整组是一个色相的深浅 */
export function toneColor(i: number, n: number) {
  const pct = n <= 1 ? 100 : Math.round(100 - (i / (n - 1)) * 62);
  return `color-mix(in srgb, var(--hud-acc) ${pct}%, var(--nv-plate-solid))`;
}

/** 确定性伪随机:同一个 (i, j) 永远同一个值(0–1),预览和导出一致 */
export const hash = (i: number, j = 0) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + 17.3) * 43758.5453;
  return s - Math.floor(s);
};
