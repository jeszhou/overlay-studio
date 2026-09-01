#!/usr/bin/env node
/**
 * 卡片库同步:registry.ts(唯一事实来源) → SKILL.md 的「卡片库」一节
 *
 *   npm run sync:cards          写入 SKILL.md
 *   npm run sync:cards -- --check   只检查,有差异就非 0 退出(收工自检用)
 *
 * 自动来自源码:分组、kind、竖版让位档(vTier)、用途(description)、关键 params(controls)
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
const STK_BEGIN = "<!-- STICK:AUTO-BEGIN";
const STK_END = "<!-- STICK:AUTO-END -->";
const STICK_POSES = path.join(FX_DIR, "hud/stickPoses.ts");
const STICK_PROPS = path.join(FX_DIR, "hud/stickProps.tsx");

/** 竖版让位档 → 表里怎么写。前缀保留英文档名,parseExisting 靠它认列 */
const VTIER_ZH = {
  still: "still 不让",
  half: "half 人下沉",
  full: "full 人缩小窗",
};

/** 每组的编排提示:影响 AI 选卡优先级,人工维护 */
const GROUP_NOTES = {
  "常驻层": "每期必配,画面没有一帧「没人管」",
  "证据实证": "语义可视化核心,优先选用",
  "数据指标": "有具体数字时用,别拿它讲概念",
  "对比取舍": "两个东西对撞/否定一个立一个",
  "金句观点": "口播最常用,一句话一张",
  "步骤流程": "有先后顺序的过程",
  "信息结构": "一个概念的完整版式/多要点并列",
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
      // 竖版让位档:没写 = 缺省 still(类型上可选,新卡由 check:vtier 强制)
      const vTier = (body.match(/\bvTier:\s*"(still|half|full)"/) || [])[1] || "still";
      const ci = body.indexOf("controls:");
      const seg = ci < 0 ? "" : body.slice(ci);
      const params = [...seg.matchAll(/key:\s*"(\w+)"[^}]*?label:\s*"([^"]*)"/g)]
        .map((x) => `\`${x[1]}\`(${x[2].replace(/\|/g, "/")})`);
      byVar.set(m[1], { id, desc, params, vTier, file: path.basename(f) });
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


/** 只取卡片库那一段 —— 文档别处的表格(如火柴人动作表)不该被当成卡片表读 */
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
  const ghosts = new Set(); // 禁用区(2 列表格)里的 kind,必须跨次保留
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
    if (bars.length === 3) { ghosts.add(kind); continue; } // 禁用区那张 2 列表
    const last = bars[bars.length - 1];
    // 2026-09-01 加了「竖版」列(在 kind 之后)。旧表没有这一列,靠内容认:
    // 第二格是 still/half/full 就是新表,否则按旧表的列序读。
    // 竖版列是从源码生成的,不需要保留人工值 —— 这里只为把后面几列对上。
    const shift = /^(still|half|full)\b/.test(cut(bars[1], bars[2])) ? 1 : 0;
    rows.set(kind, {
      use: cut(bars[1 + shift], bars[2 + shift]),
      when: cut(bars[2 + shift], bars[3 + shift]),
      // params 一路取到行尾:少数人工行的 params 里有没转义的 |(如 info-board)
      params: bars.length > 4 + shift ? cut(bars[3 + shift], last) : "",
    });
  }
  return { rows, ghosts };
}

function buildSection(groups, old, knownGhosts) {
  const seen = new Set();
  const out = [];
  let n = 0;
  for (const g of groups) {
    if (!g.cards.length) continue;
    const note = GROUP_NOTES[g.title];
    out.push(`### ${g.title}${note ? `(${note})` : ""}`);
    out.push("| kind | 竖版 | 用途 | 触发条件 | 关键 params |");
    out.push("|---|---|---|---|---|");
    for (const c of g.cards) {
      seen.add(c.id);
      n++;
      const prev = old.get(c.id);
      // 已有行:用途/触发条件/params 全部保留人工版本
      // 新卡:用途取 description,触发条件留待补,params 自动列出
      const use = prev?.use || c.desc.replace(/\|/g, "/");
      const when = prev?.when || TODO;
      const params = prev?.params || (c.params.length ? c.params.join("、") : "—");
      out.push(`| \`${c.id}\` | ${VTIER_ZH[c.vTier]} | ${use} | ${when} | ${params} |`);
    }
    out.push("");
  }
  // 表里有、源码没有的:禁用区(如 title-lock)
  const ghosts = [...new Set([...old.keys(), ...knownGhosts])].filter((k) => !seen.has(k));
  if (ghosts.length) {
    out.push("### ⚠️ 已下架/未实现(禁止使用)");
    out.push("| kind | 说明 |");
    out.push("|---|---|");
    for (const k of ghosts) out.push(`| \`${k}\` | 卡片库里已无此卡,生成时禁止使用 |`);
    out.push("");
  }
  return { body: out.join("\n"), count: n, ghosts };
}

const byVar = scanEffects();
const groups = scanGroups(byVar);
const md = fs.readFileSync(SKILL, "utf8");
const { rows: old, ghosts: knownGhosts } = parseExisting(cardsRegion(md));


/** 道具表:从 stickProps.tsx 生成。道具不在这张表里,生成动效时就想不起来用它 */
function buildPropRows() {
  const src = fs.readFileSync(STICK_PROPS, "utf8");
  const ANCHOR_ZH = { hand: "手上", hands: "双手中间", head: "头顶", ground: "地面" };
  const rows = [];
  for (const m of src.matchAll(
    /^  (\w+): \{\s*\n\s*zh: "([^"]*)", says: "([^"]*)", anchor: "(\w+)"/gm,
  )) {
    rows.push(`| \`${m[1]}\` | ${m[2]} | ${m[3]} | ${ANCHOR_ZH[m[4]] ?? m[4]} |`);
  }
  return rows;
}

/** 火柴人动作表:从 stickPoses.ts 的 ACT_ZH / ACT_SAYS 生成 —— 加了新动作,skill 文档自动跟上 */
function buildStickSection() {
  const src = fs.readFileSync(STICK_POSES, "utf8");
  const grab = (name) => {
    const m = src.match(new RegExp(`export const ${name}[^=]*= \\{([^}]*)\\}`, "s"));
    const out = new Map();
    if (!m) return out;
    for (const kv of m[1].matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) out.set(kv[1], kv[2]);
    return out;
  };
  const zh = grab("ACT_ZH");
  const says = grab("ACT_SAYS");
  const loops = new Set(
    [...src.matchAll(/^\s{2}(\w+)A:\{/gm)].map((m) => m[1]),
  );
  const rows = [...zh.entries()].map(([en, cn]) =>
    `| \`${en}\` | ${cn} | ${says.get(en) ?? "—"} | ${loops.has(en) ? "循环" : ""} |`,
  );
  return (
    `## 火柴人动作表(\`stick-fall\` 专用)\n\n` +
    `${STK_BEGIN} 由 \`npm run sync:cards\` 从 stickPoses.ts 生成,别手改。 -->\n\n` +
    `\`stick-fall\` 不是固定的一出戏,是把下面的动作按时间串起来。\n` +
    `剧本写在 \`acts\` 参数里,**一行一拍**:\n\n` +
    "```\n0|举相机拍\n3|跪\n4.4|趴\n```\n\n" +
    `格式 \`秒|动作\`,秒是相对这张卡 start 的时间。要带道具写 \`秒|动作+道具\`,\n` +
    `举相机拍、坐、扛、推这四个不写也会自动配上道具,写 \`+无\` 可以去掉。\n` +
    `背景由 \`scene\` 定:素材堆(越堆越高)/ 赛道(地面往后滚)/ 无。\n\n` +
    `**选动作看「口播说法」那一列** —— 用户原话里出现类似的意思就用对应动作。\n` +
    `标了「循环」的会自己来回演(跑、走、鼓掌这些),适合放在一段话的持续状态上。\n\n` +
    `| 动作 | 中文名 | 口播说法 | |\n|---|---|---|---|\n` +
    rows.join("\n") + "\n\n" +
    `### 道具\n\n` +
    `同样**看「口播说法」选**。道具挂在身上跟着动作走,挂点是自动的。\n\n` +
    `| 道具 | 中文名 | 口播说法 | 挂在哪 |\n|---|---|---|---|\n` +
    buildPropRows().join("\n") + "\n\n" +
    `编剧本的三个例子:\n\n` +
    "```\n素材越堆越高最后累趴   scene=素材堆   0|举相机拍 / 3|跪 / 4.4|趴\n" +
    "让大模型无限跑到跑不动   scene=赛道     0|跑 / 4|走 / 5.6|趴\n" +
    "无语到直接躺平          scene=无       0|扶额 / 1.8|投降 / 3.4|躺平\n```\n\n" +
    STK_END
  );
}

const { body, count, ghosts } = buildSection(groups, old, knownGhosts);

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

// 火柴人动作表:接管 STICK 标记区(没有就插在卡片库之后)
// stickPoses.ts 在发行版里会被裁掉(stick-fall 不在发行档,构建也会删掉这一整节)。
// 以前这里直接读文件,公开版用户跑 `npm run sync:cards` 第一步就 ENOENT 崩 ——
// 而那条命令正是 SKILL.md 教他们「加了新卡就跑一次」的必经步骤(2026-09-01 查出来)。
// 裁卡没裁「引用卡的地方」的老毛病,这次的引用处是构建脚本本身。
if (fs.existsSync(STICK_POSES)) {
  const stick = buildStickSection();
  const b = next.indexOf(STK_BEGIN), e = next.indexOf(STK_END);
  if (b >= 0 && e > b) {
    const hStart = next.lastIndexOf("## 火柴人动作表", b);
    next = next.slice(0, hStart) + stick + next.slice(e + STK_END.length);
  } else {
    const after = next.indexOf(END) + END.length;
    next = next.slice(0, after) + "\n\n" + stick + next.slice(after);
  }
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
if (ghosts.length) console.log(`  下架卡(已移入禁用区):${ghosts.join(", ")}`);
if (todos.length) console.log(`\n⬜ 这 ${todos.length} 张卡还缺「触发条件」,需要人工补一句:\n   ${todos.join("\n   ")}`);
