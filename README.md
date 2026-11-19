# Overlay Studio

**免费版 · 源码公开**

[English](README.en.md) · [项目首页](https://jeszhou.github.io/overlay-studio/) · [版本与下载](https://github.com/jeszhou/overlay-studio/releases)

![透明动效卡叠放在剪辑时间轴上](docs/hero.webp)

把带时间码的字幕变成可编辑的动效编排。在本地编辑台调整 20 张内置动效卡，导出透明 MOV 或 WebM，再叠到剪映等剪辑软件的原片上。

## 快速开始

### 让 AI 帮你安装

在能读取文件和运行终端的 AI 工具里打开整个仓库根目录。还没下载时，打开准备存放项目的目录，再把下面这段发给 AI。

```text
请在这台电脑上安装并启动 Overlay Studio 免费版。优先使用当前目录已有的源码。
如果还没下载，请从 https://github.com/jeszhou/overlay-studio 获取源码并放进新目录。
检查 Node.js（至少 22.12）、npm、FFmpeg 和 ffprobe；缺什么就用本机适用的官方安装方式。
进入 motion-playground，按 package-lock.json 执行 npm ci，然后运行 npm run dev。
确认 http://localhost:5177 能打开并保持服务运行。告诉我装在哪、怎么重启，以及如何点「示例」导出透明 MOV。
```

### 手动安装

1. [下载源码 ZIP](https://github.com/jeszhou/overlay-studio/releases/latest) 并解压，或运行 `git clone https://github.com/jeszhou/overlay-studio.git`。
2. 安装 [Node.js](https://nodejs.org/) 22.12 或更高版本，以及 FFmpeg 和 ffprobe。Windows 可在 PowerShell 执行 `winget install --id Gyan.FFmpeg -e`，macOS 可用 Homebrew 执行 `brew install ffmpeg`。完成后重开终端。
3. 打开源码里的 `motion-playground`。Windows 可以双击 `start-overlay-studio.bat`，也可以在 PowerShell 运行 `npm.cmd ci` 和 `npm.cmd run dev`。macOS 在终端运行 `npm ci` 和 `npm run dev`。
4. 保持终端运行，打开 [localhost:5177](http://localhost:5177/)。点顶栏「示例」，播放内置编排，再点「导出透明 MOV」生成第一条样片。导出需要 FFmpeg，首次安装还会下载渲染用的 Chromium。

下载、路径和启动报错见 [完整安装指南](安装指南.md)。

## 用自己的字幕做动效

1. 从剪辑软件导出带时间码的 `.srt` 字幕。
2. 把整个 Overlay Studio 仓库根目录交给 AI 工具，附上 SRT 并说「用仓库里的 `overlay-fx-generator` Skill，根据这份 SRT 生成动效编排 JSON」。
3. 在编辑台导入 JSON 和视频，可以逐卡调整、保存工程，最后导出单卡或整条时间轴。

仓库内置面向 Codex、Claude Code、CodeBuddy 和 WorkBuddy 的项目级 Skill 入口。[操作指南](操作指南.md) · [详细使用指南](motion-playground/使用指南.md)

## 版本与维护

- [更新日志](CHANGELOG.md) · [更新指南](更新指南.md) · [候选发布说明](https://jeszhou.github.io/overlay-studio/releases.html)
- [版本比较](https://jeszhou.github.io/overlay-studio/versions.html) · [官网购买 Pro](https://www.overlaystudio.cn/purchase/#checkout)
- 发行维护者在仓库根目录运行 `python3 scripts/package-release.py --ref HEAD --output ../overlay-free-release`。源码 ZIP 用于本地安装和导出，dist ZIP 用于静态前端预览。修改构建输入后，先暂存准备发行的源码，再在 `motion-playground` 运行 `npm run build:manifest`，核对清单后随源码一起提交。

## 授权与致谢

免费使用，禁止转售。成品视频可商用。完整条款见 [LICENSE](LICENSE) 与 [LICENSE-EN](LICENSE-EN)。默认音效的来源和授权见 [音效说明](motion-playground/public/sfx-default/来源与授权.txt)。

作者是一页枝鸥。最初的思路受茂茂AI的公开分享启发。
