#!/usr/bin/env node
/**
 * 卡片默认文案过审检查 · 防止「为某一期文案写死的内容」跟着卡片进仓库
 *
 *   npm run check:defaults            检查(收工/构建前跑)
 *   npm run check:defaults -- --accept  人工确认后登记
 *
 * 拦两类问题:
 *  1. 硬拦:默认值里出现个人标识 / 他人署名 / 具体日期期号 —— 直接不通过
 *  2. 软拦:新卡没过审、或老卡默认值被改动 —— 要求人眼看一遍再 --accept
 *
 * 为什么要人眼过一遍:「这段文案是通用示例还是那一期的内容」机器判断不了,
 * 但「有没有人看过」机器管得住。新卡漏审会在这里被卡住,不会溜进发行版。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX_DIR = path.join(ROOT, "src/effects");
const LEDGER = path.join(ROOT, "scripts/defaults-reviewed.json");
const ACCEPT = process.argv.includes("--accept");

/** 卡片默认值里不该出现的东西 —— 命中即不通过。
 *
 *  默认只拦「某一期专属」的痕迹(年月、期号)。**把你自己的账号名、常引用的人名
 *  加到下面**,就能拦住「为某一期写的文案不小心留在了默认值里」这类事:
 *
 *    [/你的账号名/, "个人账号名"],
 *
 *  为什么要拦:卡片的默认值是新用户第一眼看到的示例,该是「谁都看得懂怎么填」的
 *  通用样子,不是某一期口播的具体内容。 */
const BANNED = [
  [/\b20\d{2}[-年.]\s?\d{1,2}[-月]/, "具体年月(像是某一期的内容)"],
  [/第\s?\d+\s?期/, "期号"],
];

/** 源码里定位 defaults: { ... } 整块原文(跳过字符串内的花括号) */
function sliceDefaults(src, from) {
  const key = src.indexOf("defaults: {", from);
  if (key < 0) return null;
  let i = src.indexOf("{", key);
  const start = i;
  let depth = 0;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { text: src.slice(start, i + 1), end: i };
  }
  return null;
}

/** 扫出每张卡的 id + defaults 原文 */
function scanCards() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(p, "utf8");
        const re = /export const \w+Def\s*:\s*EffectDef<[^>]*>\s*=\s*\{/g;
        let m;
        while ((m = re.exec(src))) {
          const id = (src.slice(m.index, m.index + 400).match(/\bid:\s*"([a-z0-9-]+)"/) || [])[1];
          const blk = sliceDefaults(src, m.index);
          if (id && blk) out.push({ id, file: path.relative(ROOT, p), text: blk.text });
        }
      }
    }
  })(FX_DIR);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
const hash = (s) => crypto.createHash("sha256").update(norm(s)).digest("hex").slice(0, 12);

const cards = scanCards();
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : {};
const banned = [];
const unreviewed = [];
const changed = [];

for (const c of cards) {
  for (const [re, why] of BANNED) {
    const hit = c.text.match(re);
    if (hit) banned.push({ ...c, why, hit: hit[0] });
  }
  const h = hash(c.text);
  if (!ledger[c.id]) unreviewed.push({ ...c, h });
  else if (ledger[c.id].hash !== h) changed.push({ ...c, h });
}

if (ACCEPT) {
  if (banned.length) {
    console.error("✗ 有硬问题没解决,不能登记:");
    for (const b of banned) console.error(`   ${b.id}(${b.file}) — ${b.why}:「${b.hit}」`);
    process.exit(1);
  }
  const next = {};
  for (const c of cards) next[c.id] = { hash: hash(c.text), file: c.file };
  fs.writeFileSync(LEDGER, JSON.stringify(next, null, 2) + "\n");
  const n = unreviewed.length + changed.length;
  console.log(`✓ 已登记 ${cards.length} 张卡的默认文案${n ? `(其中 ${n} 张是新的或有改动)` : ""}`);
  process.exit(0);
}

let bad = false;

if (banned.length) {
  bad = true;
  console.error(`\n✗ ${banned.length} 处个人内容 / 署名 / 期号,必须改掉:`);
  for (const b of banned) console.error(`   ${b.id}(${b.file}) — ${b.why}:「${b.hit}」`);
}

const pending = [...unreviewed.map((c) => ({ ...c, tag: "新卡,没过审" })),
                 ...changed.map((c) => ({ ...c, tag: "默认值改过,要重新过审" }))];
if (pending.length) {
  bad = true;
  console.error(`\n✗ ${pending.length} 张卡等着人眼过一遍默认文案:`);
  for (const c of pending) {
    console.error(`\n── ${c.id} (${c.tag}) · ${c.file}`);
    console.error(c.text.split("\n").map((l) => "   " + l).join("\n"));
  }
  console.error(
    "\n看的是一件事:这些默认值是「谁都能看懂怎么填」的通用示例,\n" +
    "还是某一期口播里的具体内容?后者要改成通用示例。\n" +
    "确认没问题后运行:  npm run check:defaults -- --accept\n"
  );
}

if (!bad) console.log(`✓ ${cards.length} 张卡的默认文案都过审了,没有个人内容`);
process.exit(bad ? 1 : 0);
