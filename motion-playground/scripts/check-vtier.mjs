#!/usr/bin/env node
/**
 * 竖版让位档必填检查 · 「横竖版各自沉淀」的注册闸门
 *
 *   npm run check:vtier              检查(收工/构建前跑)
 *   npm run check:vtier -- --accept  把当前没写的老卡一次性登记成豁免
 *
 * 为什么要有这道门:vTier 在类型上是可选的,不写就默认 still(人不让位)。
 * 对小挂件这是对的,对大卡就是错的 —— 而「错」在横版预览里完全看不出来,
 * 只有切到竖版才会发现卡被人像盖掉一角。之前 103 张卡里只有 28 张真管过竖版,
 * 债就是这么欠下来的:没人强制,就没人写。
 *
 * 所以规则是:新卡必须显式写 vTier(哪怕写的就是 "still"),
 * 老卡进豁免名单不返工 —— 和 check:motion / check:defaults 一个套路,
 * 只堵新债,不翻旧账。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX_DIR = path.join(ROOT, "src/effects");
const LEDGER = path.join(ROOT, "scripts/vtier-grandfathered.json");
const ACCEPT = process.argv.includes("--accept");

/** 从 { 开始取出配平的整块原文(跳过字符串里的花括号) */
function sliceBlock(src, braceAt) {
  let depth = 0;
  let quote = null;
  for (let i = braceAt; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(braceAt, i + 1);
  }
  return src.slice(braceAt);
}

/** 扫出每张卡的 id + 有没有显式写 vTier */
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
          const brace = src.indexOf("{", m.index + m[0].length - 1);
          const blk = sliceBlock(src, brace);
          const id = (blk.match(/\bid:\s*"([a-z0-9-]+)"/) || [])[1];
          if (!id) continue;
          const tier = (blk.match(/\bvTier:\s*"(still|half|full)"/) || [])[1] ?? null;
          out.push({ id, file: path.relative(ROOT, p), tier });
        }
      }
    }
  })(FX_DIR);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const cards = scanCards();
const exempt = new Set(
  fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")).ids ?? [] : [],
);

const missing = cards.filter((c) => !c.tier && !exempt.has(c.id));
/* 老卡后来补上了 —— 可以从豁免名单里划掉,名单越短说明债还得越干净 */
const paidOff = cards.filter((c) => c.tier && exempt.has(c.id));

if (ACCEPT) {
  const ids = cards.filter((c) => !c.tier).map((c) => c.id);
  fs.writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        _: "没显式写 vTier 的老卡,豁免不返工。新卡必须写,不许往这加。补上 vTier 后跑 --accept 会自动划掉。",
        ids,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `✓ 已登记 ${ids.length} 张老卡豁免` +
      (paidOff.length ? `,顺带划掉 ${paidOff.length} 张已补齐的` : ""),
  );
  process.exit(0);
}

if (paidOff.length)
  console.log(
    `· ${paidOff.length} 张豁免老卡已经补上 vTier(${paidOff.map((c) => c.id).join(", ")})` +
      ` —— 跑 npm run check:vtier -- --accept 把它们从名单划掉`,
  );

if (missing.length) {
  console.error(`\n✗ ${missing.length} 张卡没写竖版让位档 vTier:`);
  for (const c of missing) console.error(`   ${c.id}  (${c.file})`);
  console.error(
    `\n一张卡要横竖两套形态才算沉淀完。vTier 说的是「这张卡在场时,口播人像该退到哪」:\n` +
      `   still 不让 —— 小挂件,整个待在上下安全带里,人不动\n` +
      `   half  半让 —— 中型卡,人下沉到下方,上半屏让给它\n` +
      `   full  全让 —— 大卡,人缩成右下小窗,特效近乎占满\n\n` +
      `不知道该写哪档就去量(要先 npm run dev):\n` +
      `   node scripts/measure-stage.mjs <effectId> --ratio v\n` +
      `它会量出这张卡在竖版里占多大、建议哪一档,并出一张带让位参考线的截图。\n`,
  );
  process.exit(1);
}

console.log(
  `✓ ${cards.length} 张卡的竖版让位档都有交代` +
    (exempt.size ? `(其中 ${exempt.size} 张是豁免的老卡)` : ""),
);
