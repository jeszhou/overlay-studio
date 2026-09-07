#!/usr/bin/env node
/**
 * 卡片库同步:registry.ts(唯一事实来源) → SKILL.md 的「卡片库」一节
 *
 *   npm run sync:cards          写入 SKILL.md
 *   npm run sync:cards -- --check   只检查,有差异就非 0 退出(收工自检用)
 *
 * 自动来自源码:分组、kind、用途(description)、关键 params(controls)
 * 人工维护并原样保留:每张卡的「触发条件」,以及被人精修过的「用途/params」文案
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX_DIR = path.join(ROOT, "src/effects");
const REGISTRY = path.join(FX_DIR, "registry.ts");
const SKILL = path.resolve(ROOT, "../.claude/skills/overlay-fx-generator/SKILL.md");
const BEGIN = "<!-- CARDS:AUTO-BEGIN";
const END = "<!-- CARDS:AUTO-END -->";
const TODO = "⬜ 待补";

/** 每组的编排提示:影响 AI 选卡优先级,人工维护 */
const GROUP_NOTES = {
  "常驻层": "每期必配,画面没有一帧「没人管」",
  "证据实证": "语义可视化核心,优先选用",
  "数据指标": "有具体数字时用,别拿它讲概念",
  "对比取舍": "两个东西对撞/否定一个立一个",
  "金句观点": "口播最常用,一句话一张",
  "步骤流程": "有先后顺序的过程",
  "教程标注": "讲界面、解释术语、给提示",
  "文字进场": "纯文字的进场方式,内容轻时用",
  "人物锚定": "效果直接「碰」人物,会盖住脸,交付时提醒抠像",
  "场景 · 运镜": "独占全屏,勿与其他卡同屏,时长跟整段走",
  "场景 · B-roll": "全屏背景板,只配 B-roll 段落",
};

/** 组件文件里提取 defVar → { id, desc, params } */
function scanEffects() {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && e.name !== "registry.ts") files.push(p);
    }
  })(FX_DIR);

  const byVar = new Map();
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    const re = /export const (\w+Def)\s*:\s*EffectDef<[^>]*>\s*=\s*\{/g;
    let m;
    while ((m = re.exec(s))) {
      const body = s.slice(m.index, m.index + 6000);
      const id = (body.match(/\bid:\s*"([a-z0-9-]+)"/) || [])[1];
      if (!id) continue;
      const desc = (body.match(/\bdescription:\s*"([^"]*)"/) || [])[1] || "";
      const ci = body.indexOf("controls:");
      const seg = ci < 0 ? "" : body.slice(ci);
      const params = [...seg.matchAll(/key:\s*"(\w+)"[^}]*?label:\s*"([^"]*)"/g)]
        .map((x) => `\`${x[1]}\`(${x[2].replace(/\|/g, "/")})`);
      byVar.set(m[1], { id, desc, params, file: path.basename(f) });
    }
  }
  return byVar;
}

/** registry.ts 里提取分组顺序 */
function scanGroups(byVar) {
  const src = fs.readFileSync(REGISTRY, "utf8");
  const groups = [];
  const re = /title:\s*"([^"]+)",\s*effects:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const vars = m[2].split(",").map((v) => v.trim()).filter(Boolean);
    const cards = vars.map((v) => byVar.get(v)).filter(Boolean);
    if (vars.length !== cards.length) {
      const miss = vars.filter((v) => !byVar.has(v));
      console.error(`⚠️  分组「${m[1]}」里这些 def 没找到定义:${miss.join(", ")}`);
    }
    groups.push({ title: m[1], cards });
  }
  return groups;
}

/** 只取卡片库那一段 —— 文档别处的表格不该被当成卡片表读 */
function cardsRegion(md) {
  const b = md.indexOf(BEGIN), e = md.indexOf(END);
  if (b >= 0 && e > b) return md.slice(b, e);
  const h = md.indexOf("## 卡片库");
  if (h < 0) return md;
  const nx = md.indexOf("\n## ", h + 4);
  return nx < 0 ? md.slice(h) : md.slice(h, nx);
}

/** 从卡片库一段里解析已有表格行:kind → [用途, 触发条件, params] */
function parseExisting(md) {
  const rows = new Map();
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    // 未转义的 | 才是列分隔符;最后一列取到行尾,
    // 因为部分人工行的 params 里含未转义的 |(如 `ent|头像图|名字`),硬切会丢内容
    const bars = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "|" && line[i - 1] !== "\\") bars.push(i);
    }
    if (bars.length < 3) continue;
    const cut = (a, b) => line.slice(a + 1, b).trim();
    const kind = (cut(bars[0], bars[1]).match(/^`([a-z0-9-]+)`/) || [])[1];
    if (!kind) continue;
    const last = bars[bars.length - 1];
    rows.set(kind, {
      use: cut(bars[1], bars[2]),
      when: cut(bars[2], bars[3]),
      // params 一路取到行尾:少数人工行的 params 里有没转义的 |
      params: bars.length > 4 ? cut(bars[3], last) : "",
    });
  }
  return rows;
}

function buildSection(groups, old) {
  const out = [];
  let n = 0;
  for (const g of groups) {
    if (!g.cards.length) continue;
    const note = GROUP_NOTES[g.title];
    out.push(`### ${g.title}${note ? `(${note})` : ""}`);
    out.push("| kind | 用途 | 触发条件 | 关键 params |");
    out.push("|---|---|---|---|");
    for (const c of g.cards) {
      n++;
      const prev = old.get(c.id);
      // 已有行:用途/触发条件/params 全部保留人工版本
      // 新卡:用途取 description,触发条件留待补,params 自动列出
      const use = prev?.use || c.desc.replace(/\|/g, "/");
      const when = prev?.when || TODO;
      const params = prev?.params || (c.params.length ? c.params.join("、") : "—");
      out.push(`| \`${c.id}\` | ${use} | ${when} | ${params} |`);
    }
    out.push("");
  }
  return { body: out.join("\n"), count: n };
}

const byVar = scanEffects();
const groups = scanGroups(byVar);
const md = fs.readFileSync(SKILL, "utf8");
const old = parseExisting(cardsRegion(md));

const { body, count } = buildSection(groups, old);

const header =
  `## 卡片库(${count} 种,只能用这些 kind)\n\n` +
  `${BEGIN} 由 \`npm run sync:cards\` 从 registry.ts 生成。\n` +
  `     新增卡片后跑一次,表里会自动多一行;「触发条件」列写着「${TODO}」的需要人工补一句。\n` +
  `     已有行的文案会原样保留,放心精修。 -->\n\n`;

const iBegin = md.indexOf(BEGIN);
const iEnd = md.indexOf(END);
let next;
if (iBegin >= 0 && iEnd > iBegin) {
  // 已托管:替换标记区(连同上方的 ## 卡片库 标题)
  const hStart = md.lastIndexOf("## 卡片库", iBegin);
  next = md.slice(0, hStart) + header + body + END + md.slice(iEnd + END.length);
} else {
  // 首次接管:替换从 ## 卡片库 到下一个 ## 之间的整段
  const hStart = md.indexOf("## 卡片库");
  if (hStart < 0) {
    console.error("✗ SKILL.md 里找不到「## 卡片库」一节");
    process.exit(2);
  }
  const rest = md.indexOf("\n## ", hStart + 4);
  const tailStart = rest < 0 ? md.length : rest + 1;
  next = md.slice(0, hStart) + header + body + END + "\n\n" + md.slice(tailStart);
}

const todos = [...next.matchAll(/^\| `([a-z0-9-]+)` \|[^|]*\| ⬜ 待补 \|/gm)].map((m) => m[1]);
const check = process.argv.includes("--check");

if (next === md && !todos.length) {
  console.log(`✓ 卡片库已同步:${count} 种,无待补`);
  process.exit(0);
}

if (check) {
  if (next !== md) console.error(`✗ 卡片库与 registry.ts 不一致,请跑 npm run sync:cards`);
  if (todos.length) console.error(`✗ ${todos.length} 张卡缺「触发条件」:${todos.join(", ")}`);
  process.exit(1);
}

fs.writeFileSync(SKILL, next);
console.log(`✓ 已写入 SKILL.md:${count} 种卡`);
if (todos.length) console.log(`\n⬜ 这 ${todos.length} 张卡还缺「触发条件」,需要人工补一句:\n   ${todos.join("\n   ")}`);
