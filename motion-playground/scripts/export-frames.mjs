#!/usr/bin/env node
import {stageSize} from '../src/overlay/stage-size.mjs';
import { blankFrameCandidate, createBlankFrameCapture } from "./blank-frame-cache.mjs";
import { frameProgressReporter } from "./export-progress.mjs";
/**
 * 导出透明动效层 · PNG 序列
 * 原理:无头 Chrome + CDP 虚拟时间(Emulation.setVirtualTimePolicy),
 * 时钟完全由脚本控制,每帧精确推进 1000/fps 毫秒再截图(omitBackground → 透明)。
 * 用法: node scripts/export-frames.mjs <job.json>
 * job: { effectId, params, fps, duration, base, outputs?, fastPng?, compatibilityMode? }
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { exportBrowserOptions, exportBrowserDiagnostics } from "./export-browser.mjs";
import { cameraSeekStart } from "./video-frame-seek.mjs";
import { cameraFrameRanges, rangeCacheSuffix, rangeFilter } from "./video-frame-ranges.mjs";
import { closeBrowser } from "./export-lifecycle.mjs";
import { resolveExportOutputs, resolveFastPng, resolveExportMode, resolveCompatibilityMode } from "./export-options.mjs";
import { prepareSfxMix, recordBakedSfx } from "./export-sfx.mjs";
import { videoAudioInputArgs, videoOutputArgs } from "./export-codecs.mjs";
import { createPngStream } from "./png-stream.mjs";
import { selectFrameConcurrency, createDirectFrameRenderer, orderedFrames } from "./parallel-frames.mjs";
import { createExportFrameRenderer, exportFrameClock } from "./export-frame-renderer.mjs";
import { tsImport } from "tsx/esm/api";
import { cleanupVideoFrameCache, readVideoFrameCache, prepareVideoFrameCache, videoFrameCachePrefix, findVideoFrameCache } from "./video-frame-cache.mjs";
import { runFfmpeg, emitProgress, nextOperation, ffmpegFailure } from "./ffmpeg-process.mjs";
import { assertProbeCompleted, exportFailurePayload } from "./export-failure.mjs";
import { resolveExportFolder } from "./export-folder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const jobFile = process.argv[2];
if (!jobFile) {
  console.error("usage: node export-frames.mjs <job.json>");
  process.exit(1);
}
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
job.mode ??= job.doc ? "timeline" : "single";
let outputs;
let fastPng;
let compatibilityMode;
let exportMode;
let renderConcurrency;
try {
  renderConcurrency = selectFrameConcurrency(job);
  outputs = resolveExportOutputs(job.outputs);
  fastPng = resolveFastPng(job.fastPng);
  compatibilityMode = resolveCompatibilityMode(job.compatibilityMode);
  exportMode = resolveExportMode(job.exportMode, job.keepFrames);
  if (!["single", "timeline"].includes(job.mode) ||
    (job.mode === "single" && !/^[a-z0-9][a-z0-9-]*$/.test(job.effectId ?? "")))
  throw Error("无效的导出模式或卡片 ID");
} catch (error) {
  console.error(`【导出失败原因】${error.message}`);
  process.exit(1);
}
const {
  mode = "single", // single | timeline
  effectId,
  params = {},
  doc = null, // timeline 模式:整份 overlay JSON
  scale = 1,
  speed = 1, // 动画速度倍率(与 Studio「动画速度」滑杆一致)
  fps = 30,
  duration = 6,
  base = "http://localhost:5177",
  keepFrames = false, // true = 保留 PNG 中间目录(verify-effect 逐帧比对要用)
  ratio: jobRatio = "h",
} = job;

// 画幅:timeline 以编排里的 doc.ratio 为准,single 看 job.ratio
const requestedRatio = mode === "timeline" ? doc?.ratio : jobRatio;
const RATIO = requestedRatio === "v" || requestedRatio === "4:3" ? requestedRatio : "h";
const STAGE = stageSize(RATIO);
// NTSC 29.97 的真身是 30000/1001(=29.970029970…),写成小数会有微小误差:
// 帧号/时钟用精确值算,传给 ffmpeg 的帧率用分数字符串,避免它按 2997/100 编码
const frameClock = exportFrameClock(fps);
const FPS = frameClock.rate;
const FPS_ARG = frameClock.argument;
const totalFrames = Math.max(1, Math.round(duration * FPS));

// 开工前先看磁盘够不够:PNG 序列约 14MB/s、ProRes 4444 约 29MB/s,再留 2GB 余量。
// 中途写满会得到一个"没有 moov 索引"的半截 MOV —— 剪映只会说"文件损坏",查不出原因。
// fs.statfsSync 三平台通用(旧实现用 df,Windows 上没这命令,静默返回 Infinity
// 等于保护失效)。查不到就放行,不为了一个预检卡住导出。
function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return Infinity;
  }
}
// 14/29 是 30fps 的经验值,50/60 帧的 PNG 和 ProRes 都按帧数等比放大
const needBytes = duration * (14 + 29) * (FPS / 30) * 1024 * 1024 + 2 * 1024 ** 3;
const gb = (n) => (n / 1024 ** 3).toFixed(1);
// An occupied file on Windows must not replace the original export failure.
function cleanupPartial(target, recursive = false) {
  try { fs.rmSync(target, { recursive, force: true }); return true; }
  catch (error) { console.error(`临时产物清理失败 ${target}: ${error.message}`); return false; }
}

// 工作目录 exports/<名称>-<时间戳>/(PNG 序列等中间产物)
// 成品目录:用户所选文件夹；未选择时仍是 exports/output/。
const stamp = /^[a-f0-9-]{36}$/.test(job.runId ?? "") ? job.runId : new Date().toISOString().replace(/[-:T.Z]/g, "") + "-" + process.pid;
const name = mode === "timeline" ? "timeline" : effectId;
const outDir = path.join(ROOT, "exports", `${name}-${stamp}`);
let finalDir;
try { finalDir = resolveExportFolder(ROOT, job.outputDir); }
catch (error) {
  console.error(`【导出失败原因】${error.message}`);
  process.exit(1);
}


// ---- 卡内视频预抽帧 ----
// 虚拟时钟下 Chrome 媒体管线完全冻结:<video> 的加载和 seek 永远不完成,
// 每帧干等超时(导出极慢)且画面为空。先用 ffmpeg 把用到的视频按导出帧率
// 抽成 JPEG 序列放进 public/_fxframes/,页面在导出模式用 <img> 逐帧换图。
// 读取真实卡片控件及默认参数，不维护第二份可能过期的运镜卡白名单。
// tsx 已是项目依赖；显式使用应用 JSX 配置，避免 Node 导入 registry 时误用 classic JSX。
const { collectVideoUses, collectCameraIntervals } = await tsImport("./collect-video-uses.ts", {
  parentURL: import.meta.url,
  tsconfig: path.join(ROOT, "tsconfig.app.json"),
});

const cacheRoot = path.join(ROOT, "public", "_fxframes");

async function extractVideoFrames(need, allowRanges = true, allowSeek = true) {
  const manifest = {};
  if (!need.size) return manifest;
  // 抽帧要 ffmpeg 和 ffprobe 两个命令,**分别探**。
  // 以前只探 ffmpeg:装法不同的机器(Windows 上分开装、或只装了其中一个)ffprobe 会缺,
  // 于是每张卡都走到下面「读不到时长」那条 continue,导出照跑,成片里视频窗全是空的
  // —— 而且没有任何一句是红色的,客户拿到坏成片多半不会来问,只会觉得这软件不行。
  //
  // 编排里根本没有视频卡时这段不会执行(上面 need.size 为 0 就返回了),
  // 所以纯图文的片子不装 ffmpeg 照样导得出来,这里不会误伤。
  for (const [bin, what] of [["ffmpeg", "抽帧"], ["ffprobe", "读视频时长"]]) {
    if (spawnSync(bin, ["-version"], { stdio: "ignore", timeout: 10_000, windowsHide: true }).status !== 0) {
      console.error(
        `\n【导出失败原因】这条编排里有卡要放视频,需要 ${bin}(用来${what}),但本机没装或不在 PATH 里。\n` +
          `装好之后重新导出即可:\n` +
          `  macOS:   brew install ffmpeg\n` +
          `  Windows: winget install --id Gyan.FFmpeg -e\n` +
          `(ffmpeg 和 ffprobe 通常一起装上;只装了一个的话把另一个补齐。装完要重开终端。)`,
      );
      process.exit(1);
    }
  }
  // 保留可复用缓存，只清理过期或不完整的抽帧结果。
  cleanupVideoFrameCache(cacheRoot);
  for (const [src, needSec] of need) {
    const rel = "/" + decodeURIComponent(src.split("?")[0]).replace(/^\/+/, "");
    const publicDir = path.resolve(ROOT, "public");
    const file = path.resolve(publicDir, "." + rel);
    if (!/^\/(?:demo|_media|_projects|logos)\//.test(rel) || !file.startsWith(publicDir + path.sep)
        || (fs.existsSync(file) && !fs.realpathSync(file).startsWith(fs.realpathSync(publicDir) + path.sep)))
      throw Error("视频素材路径不属于当前工程");
    if (!fs.existsSync(file)) {
      console.log(`vid-frames: 找不到 ${rel},该视频窗将为空`);
      continue;
    }
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration,format_name,start_time:stream=codec_type,codec_name,start_time",
        "-of", "json", file],
      { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assertProbeCompleted(probe, rel, 30_000);
    const sourceInfo = JSON.parse(probe.stdout);
    const dur = Number(sourceInfo.format?.duration) || 0;
    if (!dur) {
      console.log(`vid-frames: 读不到时长 ${rel},该视频窗将为空`);
      continue;
    }
    const useSec = Math.min(dur, needSec + 0.5);
    // The key groups fractional requests in one-second buckets. Fill that bucket once,
    // but never extract beyond the source duration. Legacy shorter caches are checked below.
    const extractSec = Math.min(dur, Math.ceil(useSec));
    const prefix = videoFrameCachePrefix(file, FPS);
    const required = { fps: FPS, durationSec: useSec };
    const reusable = findVideoFrameCache(cacheRoot, prefix, required);
    const ranges = !reusable && allowRanges ? cameraFrameRanges(cameraIntervals.get(src), FPS, extractSec, dur) : null;
    const seekSec = ranges && allowSeek ? cameraSeekStart(ranges, FPS, sourceInfo) : 0;
    const rangeKey = ranges ? `${prefix}${rangeCacheSuffix(ranges)}` : null;
    const existingRange = rangeKey && readVideoFrameCache(path.join(cacheRoot, rangeKey), required);
    const key = reusable?.key ?? (ranges ? (existingRange || !seekSec ? rangeKey : `${rangeKey}-seek-v1`) : `${prefix}${Math.ceil(useSec)}s`);
    const dir = path.join(cacheRoot, key);
    const manifestFile = path.join(dir, "manifest.json");
    let count = reusable?.count ?? prepareVideoFrameCache(dir, required);
    if (!count) {
      console.log(`extracting video frames: ${rel} (${extractSec.toFixed(1)}s @ ${fps}fps)...`);
      if (seekSec) console.log(`video seek: skipping prefix before ${seekSec}s: ${rel}`);
      // Bound input too: select may otherwise discard all later frames without reaching output -t.
      const r = await runFfmpeg(
        ["-y", ...(seekSec ? ["-copyts", "-start_at_zero", "-ss", String(seekSec)] : []),
          ...(ranges ? ["-t", String(extractSec - seekSec)] : []), "-i", file, "-t", String(extractSec), "-vf", ranges ? rangeFilter(FPS_ARG, ranges, seekSec > 0) : `fps=${FPS_ARG}`, "-q:v", "4",
          ...(ranges ? ["-fps_mode", "passthrough"] : []),
          path.join(dir, "f_%05d.jpg")],
        { stage: "extract", durationSec: extractSec, total: Math.ceil(extractSec * FPS) },
      );
      count = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).length
        : 0;
      if (seekSec && (r.status !== 0 || count !== ranges.reduce((sum, r) => sum + r.end - r.start + 1, 0))) {
        cleanupPartial(dir, true);
        console.log(`video seek failed or incomplete; decoding from start: ${rel}`);
        Object.assign(manifest, await extractVideoFrames(new Map([[src, needSec]]), true, false));
        continue;
      }
      if (r.status !== 0 || (!count && !ranges)) {
        cleanupPartial(dir, true);
        throw ffmpegFailure(r, `视频抽帧失败 ${rel}`);
      }
      fs.writeFileSync(manifestFile, JSON.stringify({ count, fps: FPS, dur, extractedSec: extractSec, ...(ranges ? { ranges, seekSec } : {}) }));
    }
    if (ranges && count !== ranges.reduce((sum, r) => sum + r.end - r.start + 1, 0)) {
      cleanupPartial(dir, true);
      console.log(`video range coverage incomplete; using full extraction: ${rel}`);
      Object.assign(manifest, await extractVideoFrames(new Map([[src, needSec]]), false));
      continue;
    }
    manifest[src] = { ...(ranges ? { ranges, storedCount: count } : {}), dir: `/_fxframes/${key}`, fps: FPS, count: ranges ? Math.ceil(extractSec * FPS) : count, dur };
  }
  return manifest;
}

// ---- 磁盘预检:放在抽帧清单算出来之后 ----
// 以前只算 PNG 序列 + ProRes 成片,**卡内视频抽的 JPEG 不在账里** —— 全局口播是按整条时长抽的,
// 20 分钟的口播在 30fps 下就是三万多张 JPEG(几个 GB),预检说「够」,抽到一半盘满了。
// 按每帧 200KB 估(1080p、-q:v 4 的实测量级),宁可高估。
const videoUses = collectVideoUses(job);
const cameraIntervals = collectCameraIntervals(job);
const frameBytes = [...videoUses.values()].reduce((a, sec) => a + sec * FPS * 200 * 1024, 0);
const needTotal = needBytes + frameBytes;
const freeNow = freeBytes(ROOT);
if (freeNow < needTotal) {
  console.error(
    `\n【导出失败原因】磁盘空间不够:还剩 ${gb(freeNow)}GB,这条 ${Math.round(duration)}s 的片子` +
      `大约需要 ${gb(needTotal)}GB(PNG 序列 + ProRes 成片` +
      (frameBytes ? ` + 卡内视频抽帧 ${gb(frameBytes)}GB` : "") +
      ` + 余量)。\n` +
      `先腾地方再导 —— exports/ 里除 output 外的目录都是 PNG 中间产物,成片出来后可以整个删;` +
      `public/_fxframes/ 是视频抽帧缓存,也可以整个删。`,
  );
  process.exit(1);
}
// 用户可能把成品放到另一个盘；项目盘空间足够不代表目标盘也足够。
const finalNeed = duration * 29 * (FPS / 30) * 1024 * 1024 + 1024 ** 3;
if (freeBytes(finalDir) < finalNeed) {
  console.error(`\n【导出失败原因】所选文件夹空间不够：${finalDir}。至少需要约 ${gb(finalNeed)}GB。`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(finalDir, { recursive: true });

emitProgress({ stage: "prep", operation: nextOperation("prep"), state: "start" });
let vidFrames;
try {
  vidFrames = await extractVideoFrames(videoUses);
} catch (error) {
  // No browser or render frames exist yet. Report the probe/extraction failure explicitly.
  cleanupPartial(outDir, true);
  console.error(String(error?.stack ?? error));
  console.log(JSON.stringify(exportFailurePayload(error)));
  process.exit(1);
}

// timeline 的整份编排不放 URL:中文转码后网址会超过服务器 16KB 上限(HTTP 431),
// 改在 page.goto 前用 evaluateOnNewDocument 注入 window.__EXPORT_DOC
const url =
  mode === "timeline"
    ? `${base}/?export=1&mode=timeline&fx=${scale}&spd=${speed}`
    : `${base}/?export=1&spd=${speed}&ratio=${RATIO}&duration=${duration}&fx=${scale}&effect=${encodeURIComponent(effectId)}&p=${encodeURIComponent(
        JSON.stringify(params),
      )}`;

// 等「虚拟时钟推进完毕」这个事件,**带超时**。以前是裸等:渲染器假死(没崩、只是不再响应)
// 事件永远不来,这个进程就永远挂着 —— 服务端的导出锁也就永远解不开,用户之后每次点导出
// 都是「已有导出任务在进行中」,只能重启 npm run dev。一帧的虚拟时间几十毫秒就该推完,
// 30 秒没动静一定是出事了,与其干等不如报错退出,让人重来。
const LAUNCH_OPTS = exportBrowserOptions(process.platform, compatibilityMode);

// puppeteer 捆绑的 Chromium 没下载时(~/.cache/puppeteer 为空,npm 安装时跳过了
// 下载步骤),launch 会报「must specify executablePath」。
//
// 以前这里退回本机 Google Chrome 继续跑。**改成直接停下**,因为那条退路
// 产出的是坏成片:实测 Chrome 151 在无头+虚拟时间下不推进 CSS 动画时间线,靠
// transition/animation 淡入的卡会整张停在 opacity:0(踩过,字幕和大半动效
// 全不见)。原来只 console.warn 一句 —— 它混在几百行导出日志里,界面上是绿色的
// 「导出完成」,用户拿到一条缺了一半动效的片子,还以为是自己编排没做好。
//
// 一条命令就能装好,报错停下比默默交坏片强得多。
let browser;
// 渲染循环跑完才置 true:catch 里靠它区分「渲染到一半崩了」(PNG 是半成品,删)
// 和「渲染完了、合成失败」(PNG 是几分钟的成果,留着可手动重合成)。
let framesDone = false;
let result;
let pngStream;
let preparedSfx;
const streaming = exportMode === "stream";
try {
  browser = await puppeteer.launch(LAUNCH_OPTS);
} catch (err) {
  if (!/executablePath|Could not find/i.test(String(err?.message))) throw err;
  console.error(
    "\n【导出失败原因】渲染器(Chromium)没装好,导不了。\n" +
      "在项目文件夹里运行这一条,然后重新导出:\n" +
      "  npx puppeteer browsers install chrome\n" +
      "(以前这里会退回用你电脑上的 Chrome 硬跑,但那样导出的片子会缺掉大半动效,\n" +
      " 所以现在宁可停下来告诉你,也不给你一条坏片。)",
  );
  process.exit(1);
}

try {
  const renderer = await exportBrowserDiagnostics(browser, compatibilityMode);
  console.log(JSON.stringify({ event: "export-browser", ...renderer }));
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 10_000, windowsHide: true }).status === 0;
  if (streaming && !hasFfmpeg) throw new Error("流式导出需要 FFmpeg，请安装后重试，或关闭流式导出以保留 PNG 序列");
  result = { ok: true, dir: streaming ? null : outDir, frames: totalFrames, fps, outputs, fastPng, renderer, exportMode, renderConcurrency, mov: null, webm: null };
  const soundCards = mode === 'timeline'
    ? (doc?.cards??[]).filter(c=>doc.captionsVisible!==false || c.kind!=='caption-track')
    : [{kind:effectId,start:0,end:duration,params}];
  if(hasFfmpeg && soundCards.length)preparedSfx=await prepareSfxMix(soundCards,duration,outDir,path.join(ROOT,'public','sfx'),{breath:doc?.breath===true});

  async function openRenderPage() {
    // Separate contexts avoid a shared screenshot lock between workers.
    const page = renderConcurrency.effective > 1
      ? await (await browser.createBrowserContext()).newPage()
      : await browser.newPage();
    if (renderConcurrency.effective > 1) await page.evaluateOnNewDocument((rate) => { window.__DIRECT_FRAME = true; window.__DIRECT_FRAME_FPS = rate; }, FPS);

    // ⚠️ 钉死 CSS 动画钟校正系数(勿删)。
    // ExportView 会在开跑瞬间实测一个 __fxClockRate,再每帧把所有动画的 playbackRate
    // 乘上它。实测这个值在不同运行里会落在 1~5.5 之间;一旦落到 5 附近,
    // 进场过渡就整个卡死在第一帧 —— 卡片挂上了、is-in 也加了,但内层 opacity 恒为 0,
    // 短卡(<2s)从头到尾看不见,长卡晚好几秒才出现。
    // 这就是"同一份编排、同一份代码,有的导出好有的丢卡"的真正原因(排查见 8/28 记录)。
    // 实测 forced=1 时 126.7s 空镜卡内层 opacity 0→0.92、133s VERDICT 0→0.64,进场恢复正常。
    await page.evaluateOnNewDocument(() => {
      let _r = 1;
      Object.defineProperty(window, "__fxClockRate", {
        get: () => _r,
        set: () => {},           // 屏蔽实测值写入
        configurable: true,
      });
      void _r;
    });
    await page.setViewport({ width: STAGE.w, height: STAGE.h, deviceScaleFactor: 1 });
    const client = await page.createCDPSession();

    // 记录页面里的 JS 报错,失败时给出人话原因
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));

    // 页面底色透明(截图 omitBackground 的前提)
    await client.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });

    // 整份编排在页面脚本运行前注入(见上面 url 处注释)
    if (mode === "timeline") {
      await page.evaluateOnNewDocument((s) => {
        window.__EXPORT_DOC = s;
      }, JSON.stringify(doc));
    }
    // 视频帧序列清单:页面 __seekVideos 按它逐帧换 img.src
    await page.evaluateOnNewDocument((m) => {
      window.__VID_FRAMES = m;
    }, vidFrames);

    // 正常时间加载页面(动效被 __startExport 闸住,不会提前播)
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 }).catch((e) => {
      throw new Error(
        `导出页面加载超时(30s)。常见原因:某张卡引用的录屏/图片文件已被删除,或素材过大。原始错误:${String(e).split("\n")[0]}`,
      );
    });

    // 就绪检测:TimelineExport 挂载后才有 __startExport;
    // 没有 = 编排解析失败(页面上会显示红字原因)或页面 JS 崩溃
    await page
      .waitForFunction("typeof window.__startExport === 'function'", { timeout: 15000 })
      .catch(async () => {
        const hint = await page
          .evaluate(() => (document.body.innerText || "").trim().slice(0, 200))
          .catch(() => "");
        throw new Error(
          `导出页面未就绪:${hint || pageErrors[0] || "页面白屏(JS 报错)"}`,
        );
      });

    // 自定义字体加载完再开闸,避免前几帧渲染成回退字体
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    // 冻结时钟 → 开闸 → 从 t=0 逐帧推进
    await client.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    await page.evaluate(() => window.__startExport());
    return { page, client };
  }
  const workers = await Promise.all(Array.from({ length: renderConcurrency.effective }, () => openRenderPage()));
  const { page } = workers[0];
  console.log(renderConcurrency.reason);

  // 逐帧渲染真正开跑的时刻。进度浮窗的「预计还需」要从这里起算 ——
  // 从任务启动起算的话,前面抽帧/启浏览器那几分钟会被摊进「每帧耗时」,
  // 开头能报出好几十分钟然后一路往下掉(客户看到的「50 分钟」就是这么来的)。
  console.log(`rendering frames: ${totalFrames}`);

  // 每帧三步各花多少毫秒(推帧渲染 / 动画步进 / 截图写盘),随 progress 打出来。
  // 客户说「导出慢」时不用再猜:哪一步大,问题就在哪一层
  //(推帧大 = 卡太重;截图大 = 截图/写盘/杀毒;动画大 = 页面动画对象太多)。
  const frameOperation = nextOperation("frames");
  const reportFrame = frameProgressReporter(emitProgress);
  reportFrame({ stage: "frames", operation: frameOperation, state: "start", frame: 0, total: totalFrames, workers: renderConcurrency.effective });
  let feeding = true;
  let submitted = 0;
  let encodeOperation;
  const encoderMetrics = new Map();
  if (streaming) {
    result.streamStats = { firstEncodedAtFrame: null };
    console.log("streaming PNG frames to video encoders...");
    pngStream = createPngStream({
      files: Object.fromEntries(outputs.map((format) => [format, path.join(finalDir, `${name}-${stamp}.${format}`)])),
      fps: FPS_ARG, durationSec: duration, totalFrames, audioFile: preparedSfx?.mixFile,
      onProgress(format, event) {
        if (result.streamStats.firstEncodedAtFrame === null && event.frame > 0)
          result.streamStats.firstEncodedAtFrame = submitted;
        encoderMetrics.set(format, { ...encoderMetrics.get(format), ...event });
        const totalSize = [...encoderMetrics.values()].reduce((sum, row) => sum + (row.totalSize ?? 0), 0);
        const outTimeSec = Math.min(...outputs.map((key) => encoderMetrics.get(key)?.outTimeSec ?? 0));
        // One public operation while rendering, then one combined encoding tail.
        if (event.state === "advance") emitProgress({
          stage: feeding ? "frames" : "encode", operation: feeding ? frameOperation : encodeOperation,
          state: "advance", frame: feeding ? submitted : 0, total: totalFrames, totalSize, outTimeSec,
          durationSec: duration,
        });
      },
    });
  }
  const acc = { render: 0, anim: 0, shot: 0, feed: 0 };

  result.screenshotStats = { captured: 0, reused: 0 };
  const candidate = blankFrameCandidate({ mode, doc });
  const renderers = workers.map(worker => {
    const captureFrame = createBlankFrameCapture({ page: worker.page, fastPng, candidate, stats: result.screenshotStats });
    return renderConcurrency.effective > 1
      ? createDirectFrameRenderer({ ...worker, fps, fastPng, captureFrame })
      : createExportFrameRenderer({ ...worker, fps, fastPng, captureFrame });
  });
  for await (const { png, timing, frameIndex } of orderedFrames(renderers, totalFrames,
    index => streaming ? undefined : path.join(outDir, `frame_${String(index + 1).padStart(6, "0")}.png`))) {
    const i = frameIndex + 1;
    const tD = performance.now();
    if (pngStream) await pngStream.write(png);
    submitted = i;
    acc.feed += performance.now() - tD;
    acc.render += timing.render;
    acc.anim += timing.anim;
    acc.shot += timing.shot;
    const avg = (v) => Math.round(v / i);
    // Only completed work can renew the watchdog. Fast machines report at most twice
    // per second; a slow completed frame and the final frame are reported promptly.
    if (reportFrame({ stage: "frames", operation: frameOperation,
      state: i === totalFrames ? "end" : "advance", frame: i, total: totalFrames,
      perFrame: { render: avg(acc.render), anim: avg(acc.anim), shot: avg(acc.shot), feed: avg(acc.feed) } })) {
      console.log(
        `progress ${i}/${totalFrames} · 每帧 推帧 ${avg(acc.render)}ms · 动画 ${avg(acc.anim)}ms · 截图 ${avg(acc.shot)}ms`,
      );
    }
  }

  framesDone = true;
  feeding = false;
  if (pngStream) {
    encodeOperation = nextOperation("encode");
    emitProgress({ stage: "encode", operation: encodeOperation, state: "start", durationSec: duration });
  }

  // 烤入人物的时间段(导出页按「卡有没有 camSrc 控件」算好挂在 window 上)。
  // 趁浏览器还开着取出来,后面写进「合成说明」。
  const camSegs = await page.evaluate(() => window.__CAM_SEGMENTS ?? []).catch(() => []);

  // No page data is needed after this point; release Chromium before encoding/muxing.
  await closeBrowser(browser);
  browser = undefined;

  // ---- PNG 序列 → 自动合成透明视频(需要本机 ffmpeg;没有则跳过,只留 PNG) ----
  if (pngStream) {
    Object.assign(result, await pngStream.finish());
    emitProgress({ stage: "encode", operation: encodeOperation, state: "end", durationSec: duration, outTimeSec: duration });
  } else if (hasFfmpeg) {
    const seq = path.join(outDir, "frame_%06d.png");
    // 1) 剪映友好:ProRes 4444 透明 MOV(编码快,文件较大)→ 成品放 exports/output/
    console.log("composing MOV (ProRes 4444 alpha)...");
    const mov = path.join(finalDir, `${name}-${stamp}.mov`);
    const r1 = await runFfmpeg(
      ["-y", "-framerate", FPS_ARG, "-i", seq,
        ...videoAudioInputArgs("mov", preparedSfx?.mixFile),
        ...videoOutputArgs("mov", mov, preparedSfx?.mixFile)],
      { stage: "mov", durationSec: duration, total: totalFrames },
    );
    if (r1.status === 0 && fs.existsSync(mov)) {
      result.mov = mov;
    } else {
      // 编码/设备/写盘错误都保留真实 stderr,不再把所有失败归因于空间不足。
      cleanupPartial(mov);
      throw ffmpegFailure(r1, `MOV 合成失败(磁盘还剩 ${gb(freeBytes(ROOT))}GB)`);
    }
    // WebM 是可选的第二种成品，仅在显式请求或旧 CLI 默认下编码。
    if (outputs.includes("webm")) {
      console.log("composing WebM (VP9 alpha)...");
      const webm = path.join(finalDir, `${name}-${stamp}.webm`);
      const r2 = await runFfmpeg(
        ["-y", "-framerate", FPS_ARG, "-i", seq,
          ...videoOutputArgs("webm", webm)],
        { stage: "webm", durationSec: duration, total: totalFrames },
      );
      if (r2.status === 0 && fs.existsSync(webm)) result.webm = webm;
      else {
        cleanupPartial(webm);
        throw ffmpegFailure(r2, `WebM 合成失败；MOV 和 PNG 序列已保留在 ${finalDir} 和 ${outDir}`);
      }
    }
  } else {
    console.log("ffmpeg not found — skip video composing, PNG sequence only");
  }

  recordBakedSfx(result, preparedSfx, finalDir, name, stamp);

  // ---- 合成说明:只在真的烤了人物时才生成 ----
  // 这几段的透明层里已经有一份人物画面,剪映里必须把原始口播轨盖住,
  // 否则会看到两层人。说明放在成品旁边,而不是 README —— 用户打开
  // exports/output/ 拿 MOV 的那一刻,正好是他要去剪映的前一秒。
  if (camSegs.length && result.mov) {
    const fmt2 = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
    const note = [
      `合成说明 · ${name}-${stamp}`,
      "",
      "这条动效层里有 " + camSegs.length + " 段把口播人物烤了进去(运镜/取景类卡片)。",
      "剪映里这几段要把【原始口播轨盖住】,否则会看到两层人:",
      "",
      ...camSegs.map((s) => `  ${fmt2(s.start)} — ${fmt2(s.end)}   ${s.kind}`),
      "",
      "做法:把 MOV 放在最上层轨道,上面这几个时间段把下面的原始口播轨切开、静音或删掉画面",
      "(声音要留)。其余时间段照常,MOV 盖在原片上即可。",
    ].join("\n");
    const notePath = path.join(finalDir, `${name}-${stamp}-合成说明.txt`);
    fs.writeFileSync(notePath, note, "utf8");
    result.camNote = notePath;
  }

  // ---- 清理 PNG 中间目录:成片(MOV)到手后这几 GB 就没用了,默认删掉 ----
  // 合成失败或没装 ffmpeg 时保留:PNG 是几分钟渲染的成果,留着可手动重合成。
  if (result.ok && result.mov && !keepFrames) {
    fs.rmSync(outDir, { recursive: true, force: true });
    result.dir = null;
    console.log(streaming ? "cleaned streaming workspace" : "cleaned PNG frames dir");
  }

  // ---- 抽帧缓存:本次没用到不等于失效 ----
  // A 用口播 → B 纯文字或使用其他视频 → A 再导，仍应命中有效缓存。
  // 七天过期/损坏缓存可清理；本次使用的结果保留，避免清理干扰已生成的清单。
  {
    const n = cleanupVideoFrameCache(cacheRoot, vidFrames);
    if (n) console.log(`cleaned ${n} expired or invalid video-frame cache dir(s)`);
  }

  console.log(JSON.stringify(result));
} catch (caught) {
  let e = caught;
  if (pngStream) {
    await pngStream.abort(String(e?.message ?? e));
    Object.assign(result, pngStream.outputs);
  }
  // A failed optional encoder can still leave a fully encoded, audible MOV.
  try { recordBakedSfx(result, preparedSfx, finalDir, name, stamp); }
  catch (metadataError) { console.error(`音效清单写入失败: ${metadataError.message}`); }
  if (streaming) {
    e = new Error(`流式导出失败，未保留完整 PNG 序列；请关闭「边渲染边编码」后重试。${String(caught?.message ?? caught).split("\n")[0]}`);
    e.stderr = caught?.stderr ?? caught?.stack;
  }
  // 渲染到一半崩了:半成品 PNG 没用,别留几个 G 在 exports/ 里(界面上只会说「导出失败」,
  // 用户不知道还有这么一堆)。渲染完了才崩(合成阶段)的 PNG 是完整的,照旧保留。
  if ((streaming || (!framesDone && !keepFrames)) && fs.existsSync(outDir)) {
    if (cleanupPartial(outDir, true)) {
      if (result) result.dir = null;
      console.error(streaming ? "已清掉流式任务临时目录" : "渲染没做完,已清掉半成品 PNG 目录");
    }
  }
  // 人话原因放在 stderr 结尾(接口取尾部展示给用户)
  console.error(String(e?.stack ?? e));
  console.error(`\n【导出失败原因】${String(e?.message ?? e).split("\n")[0]}`);
  console.log(JSON.stringify(exportFailurePayload(e, result)));
  process.exitCode = 1;
} finally {
  // 假死的渲染器连 close 都可能不回:给 10 秒,不回就直接杀进程,别让「收尾」再挂一次。
  await closeBrowser(browser);
}
