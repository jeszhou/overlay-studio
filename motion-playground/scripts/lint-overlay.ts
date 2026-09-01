#!/usr/bin/env npx tsx
/**
 * overlay JSON 检查器 · CLI
 * 用法: npm run -s lint:overlay -- <overlay.json> [--duration 秒]
 * 规则: lint-rules.default.json(公共)+ lint-rules.local.json(个人,可缺省)
 * 退出码: 有 error 时非零(warn 不影响退出码,人判优先)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintOverlayText, type LintConfig } from "../src/overlay/lint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const durIdx = args.indexOf("--duration");
const duration = durIdx >= 0 ? Number(args[durIdx + 1]) : undefined;

if (!file) {
  console.error("用法: npm run -s lint:overlay -- <overlay.json> [--duration 秒]");
  process.exit(2);
}

function readJson(p: string): Partial<LintConfig> | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const config = {
  ...readJson(path.join(ROOT, "lint-rules.default.json")),
  ...readJson(path.join(ROOT, "lint-rules.local.json")),
};

const text = fs.readFileSync(path.resolve(file), "utf8");
const { doc, issues } = lintOverlayText(text, config, { duration });

const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");

console.log(`\n🔍 overlay 检查:${path.basename(file)}${doc ? ` · ${doc.cards.length} 张卡` : ""}`);
if (!issues.length) {
  console.log("✅ 没有发现问题\n");
} else {
  for (const i of errors) console.log(`  ❌ [${i.rule}] ${i.message}`);
  for (const i of warns) console.log(`  ⚠️  [${i.rule}] ${i.message}`);
  console.log(
    `\n共 ${errors.length} 个 error(必须修)、${warns.length} 个 warn(人判优先;确认没问题就在那张卡加 "lintOff": ["规则名"])\n`,
  );
}

process.exit(errors.length ? 1 : 0);
