/**
 * 自定义字体:把 .ttf/.otf/.woff/.woff2 丢进 src/assets/fonts/ 即自动注册,
 * 字体名 = 文件名(去扩展名),Studio 左栏「全局字体」下拉自动出现。
 * 选择存进编排 JSON(doc.font),导出同步生效。
 *
 * 同一家族的多个字重:文件名写成「家族名-字重数字」(思源黑体-400.otf /
 * 思源黑体-700.otf / 思源黑体-900.otf),会合并成一个下拉项「思源黑体」,
 * 各字重按真实字形渲染。不这么写的话浏览器只能拿唯一那个字重去「伪粗」,
 * 大标题会糊成一团——那种干净的重黑体,靠的就是真字重不是伪粗。
 */
const files = import.meta.glob("./assets/fonts/*.{ttf,otf,woff,woff2}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** 文件名 → { 家族名, 字重 };结尾的 -数字 当字重,没写就是 400 */
function parseName(path: string) {
  const base = path.split("/").pop()!.replace(/\.(ttf|otf|woff2?)$/i, "");
  const m = base.match(/^(.+)-(\d{3})$/);
  return m ? { family: m[1], weight: m[2] } : { family: base, weight: "400" };
}

/** 可选字体名列表(同家族多字重只出现一次) */
export const CUSTOM_FONTS = [
  ...new Set(Object.keys(files).map((p) => parseName(p).family)),
].sort();

let css = "";
for (const [path, url] of Object.entries(files)) {
  const { family, weight } = parseName(path);
  css += `@font-face{font-family:"${family}";font-weight:${weight};src:url("${url}");font-display:swap;}\n`;
}
if (css) {
  const el = document.createElement("style");
  el.setAttribute("data-custom-fonts", "");
  el.textContent = css;
  document.head.appendChild(el);
}
