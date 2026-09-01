#!/usr/bin/env node
/**
 * 动效缓动检查 · 迪士尼十二原则里唯一能机器判的那条
 *
 *   npm run check:motion              检查(收工/构建前跑)
 *   npm run check:motion -- --accept  人工确认后登记
 *
 * 只管一条:第 6 条「缓入缓出」+ 第 9 条「时间与间距」。
 * 手绘里是两条,写成代码是同一件事 —— 缓动曲线。
 * 有起点有终点的动作用 linear,就是匀速,而匀速运动在现实里几乎不存在,
 * 看着就假。这条是原片作者点名「先练这个」的两条之一,也是唯一能自动扫的。
 *
 * 天然豁免(不算违规,不进台账):
 *  - infinite 循环 —— 转圈、星轨这类持续运动,匀速本来就是对的
 *  - linear-gradient / <linearGradient> —— 是渐变,不是缓动
 *
 * 剩下的要人眼看一遍:是「进度条按时间线性推进」这种成立的用法(登记豁免),
 * 还是随手写的匀速动画(改掉)?
 * 只管新写的 —— 登记过的不再打扰,老卡不返工。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const LEDGER = path.join(ROOT, "scripts/motion-reviewed.json");
const ACCEPT = process.argv.includes("--accept");

/** 只有出现在这些属性里的 linear 才是缓动;别处的 linear 与动画无关 */
const EASING_PROP = /\b(transition|animation)(-timing-function|-duration|Property|TimingFunction)?\s*[:=]/;

/** 收集所有源码行 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

/**
 * 往上找这一行属于谁 —— CSS 找最近的选择器,TSX 找最近的组件名。
 * 指纹必须带上归属:hud.css 是全部卡片共用的一个文件,只按行内容做指纹的话,
 * 老卡登记过「transition: width 300ms linear」之后,新卡照抄同一行就会静默放行。
 * 不用行号:行号会随上方的任何改动漂移,一漂移就重新报一遍,等于天天误报。
 */
function ownerOf(lines, i, isCss) {
  for (let j = i; j >= 0 && i - j < 400; j--) {
    const t = lines[j].trim();
    if (isCss) {
      // 单行规则 `.foo { ... }`:选择器就在本行,取 { 之前的部分
      const one = t.match(/^([^@{}][^{}]*)\{/);
      if (one) return norm(one[1]);
    } else {
      const m = t.match(/export (?:const|function) (\w+)/);
      if (m) return m[1];
    }
  }
  return "?";
}

/** 扫出所有「有起止却用匀速」的可疑行 */
function scan() {
  const hits = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file);
    const isCss = file.endsWith(".css");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, i) => {
      // 先摘掉渐变:linear-gradient(...) 和 SVG 的 <linearGradient>
      const line = raw.replace(/linear-?[Gg]radient/g, "«渐变»");
      if (!/\blinear\b/.test(line)) return;
      if (!EASING_PROP.test(line)) return;
      if (/\binfinite\b/.test(line)) return; // 持续循环,匀速是对的
      const text = norm(raw);
      const owner = ownerOf(lines, i, isCss);
      hits.push({ file: rel, line: i + 1, text, owner, id: `${rel}#${hash(owner + "|" + text)}` });
    });
  }
  return hits;
}

const hits = scan();
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : {};

if (ACCEPT) {
  const next = {};
  for (const h of hits) next[h.id] = { file: h.file, owner: h.owner, text: h.text, why: ledger[h.id]?.why ?? "" };
  fs.writeFileSync(LEDGER, JSON.stringify(next, null, 2) + "\n");
  const added = hits.filter((h) => !ledger[h.id]).length;
  const uniq = Object.keys(next).length;
  console.log(`✓ 已登记 ${uniq} 处匀速豁免${added ? `(其中 ${added} 处是新的)` : ""}`);
  console.log(`  建议在 ${path.relative(ROOT, LEDGER)} 里给每条补一句 why,写明为什么这里该匀速`);
  process.exit(0);
}

const pending = hits.filter((h) => !ledger[h.id]);

if (pending.length) {
  console.error(`\n✗ ${pending.length} 处匀速动画没登记(第 6 条:缓入缓出):`);
  for (const h of pending) console.error(`\n── ${h.file}:${h.line}  〔${h.owner}〕\n   ${h.text}`);
  console.error(
    "\n判断标准:这个动作有没有明确的起点和终点?\n" +
    "  有(进场、位移、展开、数值滚动) → 必须用缓动曲线,改掉 linear。\n" +
    "    卡片库通用曲线:cubic-bezier(0.22, 1, 0.36, 1)(克制、无回弹,69 处在用)\n" +
    "  没有(进度条按时间推进、持续循环) → 匀速成立,登记豁免:\n" +
    "    npm run check:motion -- --accept\n",
  );
  process.exit(1);
}

console.log(`✓ 缓动检查通过(${hits.length} 处匀速都已登记为合理豁免)`);
