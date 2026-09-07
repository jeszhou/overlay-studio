#!/usr/bin/env node
/**
 * 把 Claude Code 目录里的 Skill 真源复制到其他 Agent 的项目级发现目录。
 *
 *   node scripts/sync-agent-skills.mjs [仓库根目录]
 *   node scripts/sync-agent-skills.mjs [仓库根目录] --check
 *
 * .claude 是唯一真源；另外三套是生成副本。个人偏好文件不复制，避免覆盖用户数据。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes("--check");
const rootArg = args.find((arg) => arg !== "--check");
const ROOT = path.resolve(rootArg ?? path.join(here, "..", ".."));
const SKILL_NAME = "overlay-fx-generator";
const SOURCE = path.join(ROOT, ".claude", "skills", SKILL_NAME);
const TARGETS = [
  ["Codex / 通用 Agent Skills", path.join(ROOT, ".agents", "skills", SKILL_NAME)],
  ["CodeBuddy / WorkBuddy Enterprise", path.join(ROOT, ".codebuddy", "skills", SKILL_NAME)],
  ["WorkBuddy 桌面版", path.join(ROOT, ".workbuddy", "skills", SKILL_NAME)],
];
const PERSONAL = new Set(["STATUS.md", "我的偏好.md", "经验规则.md", ".DS_Store"]);

if (!fs.existsSync(path.join(SOURCE, "SKILL.md"))) {
  console.error(`找不到 Skill 真源:${path.join(SOURCE, "SKILL.md")}`);
  process.exit(2);
}

const files = [];
function walk(dir, rel = "") {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PERSONAL.has(ent.name)) continue;
    const next = path.join(rel, ent.name);
    if (ent.isDirectory()) walk(path.join(dir, ent.name), next);
    else if (ent.isFile()) files.push(next);
  }
}
walk(SOURCE);

let failed = false;
for (const [label, target] of TARGETS) {
  for (const rel of files) {
    const src = path.join(SOURCE, rel);
    const dst = path.join(target, rel);
    if (check) {
      if (!fs.existsSync(dst)) {
        console.error(`${label} 缺文件:${path.relative(ROOT, dst)}`);
        failed = true;
      } else if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) {
        console.error(`${label} 已漂移:${path.relative(ROOT, dst)}`);
        failed = true;
      }
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  if (!check) console.log(`  ${label}:已同步 ${files.length} 个 Skill 文件`);
}

if (check && failed) process.exit(1);
if (check) console.log(`4 个 Agent 入口一致(${files.length} 个 Skill 文件)`);
