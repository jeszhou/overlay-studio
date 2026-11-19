import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const inputs = JSON.parse(fs.readFileSync(path.join(root, 'scripts/build-inputs.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function copyInput(name, expected, destination) {
  if (name.includes('\\') || name.includes(':') || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error(`构建清单中的路径无效：${name}`);
  }
  const source = path.join(root, name);
  if (fs.realpathSync(source) !== source || !fs.statSync(source).isFile()) throw Error(`构建输入必须是普通文件：${name}`);
  let bytes = fs.readFileSync(source);
  if (sha(bytes) !== expected && /\.(?:[cm]?[jt]sx?|mts|json|css|html|svg|srt|txt|md)$/.test(name)) {
    // Git for Windows can check out text with CRLF. Build from the recorded canonical bytes.
    bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
  }
  if (sha(bytes) !== expected) throw Error(`构建输入与发行清单不符：${name}。请使用干净源码；维护者可核对暂存改动后更新构建清单。`);
  const target = path.join(destination, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function installDist(built) {
  const dist = path.join(root, 'dist');
  // Stage on the output filesystem, including when the OS temp directory is on another drive.
  const staging = fs.mkdtempSync(path.join(root, '.dist-stage-'));
  const next = path.join(staging, 'next'), old = path.join(staging, 'previous');
  const lock = path.join(root, '.dist-publish-lock');
  let locked = false;
  try {
    fs.cpSync(built, next, { recursive: true });
    fs.mkdirSync(lock);
    locked = true;
    if (fs.existsSync(dist)) {
      if (!fs.lstatSync(dist).isDirectory()) throw Error('dist 不是普通目录');
      fs.renameSync(dist, old);
    }
    try { fs.renameSync(next, dist); }
    catch (error) { if (fs.existsSync(old)) fs.renameSync(old, dist); throw error; }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    if (locked) fs.rmdirSync(lock);
    if (!fs.existsSync(old)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-free-build-'));
try {
  for (const [name, hash] of Object.entries(inputs)) copyInput(name, hash, clean);
  const run = args => execFileSync(process.execPath, args, { cwd: clean, stdio: 'inherit' });
  if (!process.env.npm_execpath) throw Error('请运行 npm run build');
  run([process.env.npm_execpath, 'ci', '--include=dev', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund']);
  run(['node_modules/typescript/bin/tsc', '-b']);
  run(['node_modules/vite/bin/vite.js', 'build']);
  installDist(path.join(clean, 'dist'));
  console.log(`已用 ${Object.keys(inputs).length} 个校验过的源码文件构建 dist`);
} finally { fs.rmSync(clean, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
