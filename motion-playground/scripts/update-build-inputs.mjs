// Maintain the release list from the Git index; never enumerate the working directory.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const inputs = {};
for (const entry of git(['ls-files','-s','-z','--','.']).toString().split('\0').filter(Boolean)) {
  const [header,name] = entry.split('\t');
  if (!/^(?:src\/|public\/|vite-plugins\/|scripts\/.+\.(?:mjs|ts|mts)$|(?:index\.html|lint-rules\.default\.json|package(?:-lock)?\.json|project-folder\.ts|tsconfig(?:\.(?:node|app))?\.json|vite\.config\.ts)$)/.test(name)) continue;
  if (/\.test\.mjs$|^scripts\/(?:update-build-inputs|clean-build)\.mjs$/.test(name)) continue;
  if (/^public\/(?:_[^/]+|fonts)(?:\/|$)/.test(name) || /^public\/sfx\/(?!README\.md$)/.test(name)) {
    throw Error(`本机素材目录不能加入发行清单：${name}`);
  }
  const [mode,oid,stage] = header.split(' ');
  if (!['100644','100755'].includes(mode) || stage !== '0') throw Error(`无法纳入发行清单：${name}`);
  inputs[name] = createHash('sha256').update(git(['cat-file','blob',oid])).digest('hex');
}
fs.writeFileSync(path.join(root,'scripts/build-inputs.json'), JSON.stringify(inputs,null,2)+'\n');
console.log(`构建清单包含 ${Object.keys(inputs).length} 个暂存文件，请核对清单差异后提交。`);
