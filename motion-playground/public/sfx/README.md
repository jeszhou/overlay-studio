# 音效库（导出时自动混入 MOV 音轨）

**本仓库不附带音效文件**——免费音效通常允许你用在视频作品里，但不允许把音频文件
本身当素材库再分发。所以请自己下载几个放进这个文件夹。

## 怎么加

1. 到任意免费音效站下载 mp3（推荐 [Mixkit](https://mixkit.co/free-sound-effects/)、
   [Freesound](https://freesound.org/)），下载前确认许可允许你的用途
2. 把 mp3 放进本文件夹，**文件名就是 Studio 右栏「音效」下拉里的选项值**
3. 在 `src/components/ParamsPanel.tsx` 的 `SFX_OPTIONS` 里加一行，下拉里就能选到

特效类型 → 默认音效的对应关系写在 `scripts/export-frames.mjs` 的 `KIND_SFX`。

## 不放也能用

这个文件夹为空不影响任何功能：导出时找不到音效文件会自动跳过，
成片照常输出，只是没有音轨。想要音效随时再加。

## 建议准备的名字

`pop-light` `pop` `pop-cluster` `click` `type` `ding` `chime` `sparkle`
`rise` `whoosh` `whoosh-soft` `hit-soft` `impact` `glitch` `shutter`

按这些名字命名，`KIND_SFX` 的默认配对就能直接生效。
