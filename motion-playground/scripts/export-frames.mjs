#!/usr/bin/env node
/**
 * 导出透明动效层 · PNG 序列
 * 原理:无头 Chrome + CDP 虚拟时间(Emulation.setVirtualTimePolicy),
 * 时钟完全由脚本控制,每帧精确推进 1000/fps 毫秒再截图(omitBackground → 透明)。
 * 用法: node scripts/export-frames.mjs <job.json>
 * job: { doc, fps, duration, base }
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const jobFile = process.argv[2];
if (!jobFile) {
  console.error("usage: node export-frames.mjs <job.json>");
  process.exit(1);
}
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const {
  doc = null, // 整份 overlay JSON
  scale = 1,
  speed = 1, // 动画速度倍率(与 Studio「动画速度」滑杆一致)
  fps = 30,
  duration = 6,
  base = "http://localhost:5177",
  keepFrames = false, // true = 保留 PNG 中间目录
} = job;

const STAGE = { w: 1920, h: 1080 };

// NTSC 29.97 的真身是 30000/1001(=29.970029970…),写成小数会有微小误差:
// 帧号/时钟用精确值算,传给 ffmpeg 的帧率用分数字符串,避免它按 2997/100 编码
const isNTSC = Math.abs(fps - 29.97) < 0.01;
const FPS = isNTSC ? 30000 / 1001 : fps;
const FPS_ARG = isNTSC ? "30000/1001" : String(fps);

const totalFrames = Math.max(1, Math.round(duration * FPS));
const intervalMs = 1000 / FPS;

// 开工前先看磁盘够不够:按 PNG 序列 + ProRes 成片的体积估,再留余量。
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
const needBytes = duration * (14 + 29) * 1024 * 1024 + 2 * 1024 ** 3;
const gb = (n) => (n / 1024 ** 3).toFixed(1);

// 工作目录 exports/<名称>-<时间戳>/(PNG 序列等中间产物)
// 成品目录 exports/output/(给剪映用的 MOV/WebM 全部只放这里)
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const name = "timeline";
const outDir = path.join(ROOT, "exports", `${name}-${stamp}`);
const finalDir = path.join(ROOT, "exports", "output");


// ---- 卡内视频预抽帧 ----
// 虚拟时钟下 Chrome 媒体管线完全冻结:<video> 的加载和 seek 永远不完成,
// 每帧干等超时(导出极慢)且画面为空。先用 ffmpeg 把用到的视频按导出帧率
// 抽成 JPEG 序列放进 public/_fxframes/,页面在导出模式用 <img> 逐帧换图。
const VIDEO_RE = /\.(mp4|mov|webm|m4v)(\?|$)/i;

function collectVideoUses() {
  // { src → 需要抽的秒数 }:口播视频(camSrc / 全局 doc.cam)从时间轴 0 起播,
  // 所以要抽到卡片结束的绝对秒;全局口播抽到整条时长
  const need = new Map();
  const add = (src, sec) => {
    if (typeof src === "string" && VIDEO_RE.test(src))
      need.set(src, Math.max(need.get(src) ?? 0, sec));
  };
  if (doc?.cards) {
    for (const c of doc.cards) add(c.params?.camSrc, c.end ?? duration);
    if (doc?.cam) add(doc.cam, duration);
  }
  return need;
}

const cacheRoot = path.join(ROOT, "public", "_fxframes");

function extractVideoFrames(need = collectVideoUses()) {
  const manifest = {};
  if (!need.size) return manifest;
  // 抽帧要 ffmpeg 和 ffprobe 两个命令,**分别探**。
  // 以前只探 ffmpeg:装法不同的机器(Windows 上分开装、或只装了其中一个)ffprobe 会缺,
  // 于是每张卡都走到下面「读不到时长」那条 continue,导出照跑,成片里视频窗全是空的
  // —— 而且没有任何一句是红色的,用户拿到坏成片多半不会来问,只会觉得这软件不行。
  //
  // 编排里根本没有视频卡时这段不会执行(上面 need.size 为 0 就返回了),
  // 所以纯图文的片子不装 ffmpeg 照样导得出来,这里不会误伤。
  for (const [bin, what] of [["ffmpeg", "抽帧"], ["ffprobe", "读视频时长"]]) {
    if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status !== 0) {
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
  // 清理 7 天前的旧缓存
  if (fs.existsSync(cacheRoot)) {
    for (const d of fs.readdirSync(cacheRoot)) {
      const p = path.join(cacheRoot, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5)
        fs.rmSync(p, { recursive: true, force: true });
    }
  }
  for (const [src, needSec] of need) {
    const rel = decodeURIComponent(src.split("?")[0]);
    const file = path.join(ROOT, "public", rel.replace(/^\//, ""));
    if (!fs.existsSync(file)) {
      console.log(`vid-frames: 找不到 ${rel},该视频窗将为空`);
      continue;
    }
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file],
      { encoding: "utf8" },
    );
    const dur = parseFloat(probe.stdout) || 0;
    if (!dur) {
      console.log(`vid-frames: 读不到时长 ${rel},该视频窗将为空`);
      continue;
    }
    const useSec = Math.min(dur, needSec + 0.5);
    const mtime = Math.floor(fs.statSync(file).mtimeMs / 1000);
    const key = `${path.basename(file).replace(/[^\w.-]+/g, "_")}-${fps}fps-${mtime}-${Math.ceil(useSec)}s`;
    const dir = path.join(cacheRoot, key);
    const manifestFile = path.join(dir, "manifest.json");
    let count = 0;
    if (fs.existsSync(manifestFile)) {
      count = JSON.parse(fs.readFileSync(manifestFile, "utf8")).count; // 命中缓存,免重抽
    } else {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`extracting video frames: ${rel} (${useSec.toFixed(1)}s @ ${fps}fps)...`);
      const r = spawnSync(
        "ffmpeg",
        ["-y", "-i", file, "-t", String(useSec), "-vf", `fps=${FPS_ARG}`, "-q:v", "4",
          path.join(dir, "f_%05d.jpg")],
        { stdio: "ignore" },
      );
      count = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).length
        : 0;
      if (r.status !== 0 || !count) {
        console.log(`vid-frames: 抽帧失败 ${rel},该视频窗将为空`);
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      fs.writeFileSync(manifestFile, JSON.stringify({ count, fps: FPS, dur }));
    }
    manifest[src] = { dir: `/_fxframes/${key}`, fps: FPS, count, dur };
  }
  return manifest;
}

// ---- 磁盘预检:放在抽帧清单算出来之后 ----
// 以前只算 PNG 序列 + ProRes 成片,**卡内视频抽的 JPEG 不在账里** —— 全局口播是按整条时长抽的,
// 20 分钟的口播在 30fps 下就是三万多张 JPEG(几个 GB),预检说「够」,抽到一半盘满了。
// 按每帧 200KB 估(1080p、-q:v 4 的典型量级),宁可高估。
const videoUses = collectVideoUses();
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

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(finalDir, { recursive: true });

const vidFrames = extractVideoFrames(videoUses);

// 整份编排不放 URL:中文转码后网址会超过服务器 16KB 上限(HTTP 431),
// 改在 page.goto 前用 evaluateOnNewDocument 注入 window.__EXPORT_DOC
const url = `${base}/?export=1&fx=${scale}&spd=${speed}`;

// 等「虚拟时钟推进完毕」这个事件,**带超时**。以前是裸等:渲染器假死(没崩、只是不再响应)
// 事件永远不来,这个进程就永远挂着 —— 服务端的导出锁也就永远解不开,用户之后每次点导出
// 都是「已有导出任务在进行中」,只能重启 npm run dev。一帧的虚拟时间几十毫秒就该推完,
// 30 秒没动静一定是出事了,与其干等不如报错退出,让人重来。
function waitBudgetExpired(client, ms = 30_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `渲染器 ${ms / 1000} 秒没有推进(多半是假死了)。重新导出一次;还不行就重启 npm run dev`,
          ),
        ),
      ms,
    );
    client.once("Emulation.virtualTimeBudgetExpired", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const LAUNCH_OPTS = {
  headless: "new",
  args: [
    "--force-color-profile=srgb",
    "--disable-background-timer-throttling",
    "--run-all-compositor-stages-before-draw",
    "--disable-lcd-text",
  ],
};

// puppeteer 捆绑的 Chromium 没下载时(~/.cache/puppeteer 为空,npm 安装时跳过了
// 下载步骤),launch 会报「must specify executablePath」。
//
// 以前这里退回本机 Google Chrome 继续跑。**改成直接停下**,因为那条退路
// 产出的是坏成片:Chrome 151 在无头+虚拟时间下不推进 CSS 动画时间线,靠
// transition/animation 淡入的卡会整张停在 opacity:0(踩过,字幕和大半动效
// 全不见)。原来只 console.warn 一句 —— 它混在几百行导出日志里,界面上是绿色的
// 「导出完成」,用户拿到一条缺了一半动效的片子,还以为是自己编排没做好。
//
// 一条命令就能装好,报错停下比默默交坏片强得多。
let browser;
// 渲染循环跑完才置 true:catch 里靠它区分「渲染到一半崩了」(PNG 是半成品,删)
// 和「渲染完了、合成失败」(PNG 是几分钟的成果,留着可手动重合成)。
let framesDone = false;
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
  const page = await browser.newPage();

  // ⚠️ 钉死 CSS 动画钟校正系数(勿删)。
  // ExportView 会在开跑瞬间量一个 __fxClockRate,再每帧把所有动画的 playbackRate
  // 乘上它。这个值在不同运行里会落在 1~5.5 之间;一旦落到 5 附近,
  // 进场过渡就整个卡死在第一帧 —— 卡片挂上了、is-in 也加了,但内层 opacity 恒为 0,
  // 短卡(<2s)从头到尾看不见,长卡晚好几秒才出现。
  // 这就是"同一份编排、同一份代码,有的导出好有的丢卡"的真正原因。
  // 钉死为 1 之后,进场恢复正常。
  await page.evaluateOnNewDocument(() => {
    let _r = 1;
    Object.defineProperty(window, "__fxClockRate", {
      get: () => _r,
      set: () => {},           // 屏蔽页面量到的值写入
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
  await page.evaluateOnNewDocument((s) => {
    window.__EXPORT_DOC = s;
  }, JSON.stringify(doc));
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

  // 逐帧渲染真正开跑的时刻。进度浮窗的「预计还需」要从这里起算 ——
  // 从任务启动起算的话,前面抽帧/启浏览器那几分钟会被摊进「每帧耗时」,
  // 开头能报出好几十分钟然后一路往下掉(用户看到的「50 分钟」就是这么来的)。
  console.log(`rendering frames: ${totalFrames}`);

  for (let i = 1; i <= totalFrames; i++) {
    // 先下发本帧精确时间(卡片挂载/节拍全跟它走)+ 换视频帧图,再推时钟:
    // 推进期间页面完成渲染与绘制,截图即为 t=(i-1)/fps 的画面。
    // 帧覆盖的是 [0, duration) 而不是 (0, duration]:以前从 1/fps 起步,开头丢了
    // t=0 那一帧、结尾多出 t=duration 那一帧 —— 而卡片可见区间是左闭右开
    // (t < end),末帧正好踩在 end 上,于是成片最后一帧是全空的。
    await page
      .evaluate((t) => {
        if (window.__setExportT) window.__setExportT(t);
        if (window.__seekVideos) window.__seekVideos(t);
      }, (i - 1) / fps)
      .catch(() => {});
    // 换 src 后帧图在真实时间里加载(本地静态文件,通常几毫秒):就绪再推帧
    for (let k = 0; k < 20; k++) {
      const pending = await page
        .evaluate(() => (window.__pendingVidFrames ? window.__pendingVidFrames() : 0))
        .catch(() => 0);
      if (!pending) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const p = waitBudgetExpired(client);
    await client.send("Emulation.setVirtualTimePolicy", {
      policy: "advance",
      budget: intervalMs,
    });
    await p;
    // ⚠️ 确定性动画步进(勿删)。CSS 过渡/动画的钟在无头虚拟时间下
    // 快慢不定(同一台机器不同一次运行,偏差 1x~5.4x;偏差大时进场过渡
    // 整个卡死在第一帧,短卡全程隐形 —— 就是"同一编排有的导出好有的丢卡"的根源)。
    // 从本版起不再信任任何钟:每推进一帧虚拟时间,就把页面里所有动画显式
    // 暂停并手动 +intervalMs。动画进度与时间轴逐帧锁死,与机器负载无关。
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) {
        try {
          if (a.playState !== "paused") a.pause();
          a.currentTime = Number(a.currentTime ?? 0) + ms;
        } catch { /* 已结束/已移除的动画,跳过 */ }
      }
    }, intervalMs);
    await page.screenshot({
      path: path.join(outDir, `frame_${String(i).padStart(6, "0")}.png`),
      omitBackground: true,
    });
    if (i % 30 === 0 || i === totalFrames) {
      console.log(`progress ${i}/${totalFrames}`);
    }
  }

  framesDone = true;

  // 烤入人物的时间段(导出页按「卡有没有 camSrc 控件」算好挂在 window 上)。
  // 趁浏览器还开着取出来,后面写进「合成说明」。
  const camSegs = await page.evaluate(() => window.__CAM_SEGMENTS ?? []).catch(() => []);

  // ---- PNG 序列 → 自动合成透明视频(需要本机 ffmpeg;没有则跳过,只留 PNG) ----
  const result = { ok: true, dir: outDir, frames: totalFrames, fps, mov: null, webm: null };
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  if (hasFfmpeg) {
    const seq = path.join(outDir, "frame_%06d.png");
    // 1) 剪映友好:ProRes 4444 透明 MOV(编码快,文件较大)→ 成品放 exports/output/
    console.log("composing MOV (ProRes 4444 alpha)...");
    const mov = path.join(finalDir, `${name}-${stamp}.mov`);
    const r1 = spawnSync(
      "ffmpeg",
      ["-y", "-framerate", FPS_ARG, "-i", seq,
        // 预乘 alpha(定案,勿再删)。剪映按**预乘**合成 ProRes 4444:
        // 它算的是 dst*(1-a) + c,而不是 dst*(1-a) + c*a。所以必须先把 RGB 乘上 alpha。
        //
        // 曾以"预乘会把半透明压暗一倍"为由去掉这行 —— 那次测法是错的:
        // 拿 MOV 的 RGB 通道直接叠黑底比亮度(120 vs 58),那测的是文件里的裸颜色,
        // 不是剪映合出来的画面;预乘后 RGB 本来就该变暗,合成时 alpha 不再乘第二遍才对得上。
        //
        // 用真成片回归验证(45s 整帧、按 alpha 分档比对预测值与实际像素):
        //   alpha 档     直通模型误差 / 预乘模型误差
        //   ≈全透明        16.58 / 1.78
        //   很淡           78.11 / 2.28
        //   半透明(玻璃)     8.08 / 0.90
        //   较实            4.93 / 2.97
        // 每一档都是预乘模型胜。不预乘的后果:全透明区的 RGB 是近白垃圾值,
        // 会被直接加进画面 —— 半透明羽化区因此会在成片里烧成一圈白边。
        "-vf", "premultiply=inplace=1",
        "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0",
        // 色彩空间标记:不写的话 ffprobe 三项都是 unknown,剪映只能猜,
        // 猜错就整条偏色(导进剪映后整条颜色不对)。原片是 bt709,对齐它。
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", mov],
      { stdio: "ignore" },
    );
    if (r1.status === 0 && fs.existsSync(mov)) {
      result.mov = mov;
    } else {
      // 失败多半是写到一半磁盘满了:半截 MOV 没有 moov 索引,留着只会被误当成成片
      fs.rmSync(mov, { force: true });
      result.ok = false;
      result.error = `MOV 合成失败(磁盘还剩 ${gb(freeBytes(ROOT))}GB),半截文件已删除`;
      console.error(`\n【导出失败原因】${result.error}`);
    }
    // 2) 小体积:VP9 透明 WebM(编码稍慢;剪映不认 WebM 透明,给网页/达芬奇用)
    console.log("composing WebM (VP9 alpha)...");
    const webm = path.join(finalDir, `${name}-${stamp}.webm`);
    const r2 = spawnSync(
      "ffmpeg",
      ["-y", "-framerate", FPS_ARG, "-i", seq,
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32",
        "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0", webm],
      { stdio: "ignore" },
    );
    if (r2.status === 0 && fs.existsSync(webm)) result.webm = webm;
    else fs.rmSync(webm, { force: true });
  } else {
    console.log("ffmpeg not found — skip video composing, PNG sequence only");
  }

  // ---- 音效烤入:按每张卡的出现时刻把音效混成音轨,直接封进 MOV ----
  // 每卡可用参数 sfx 覆盖:留空 = 按类型自动;"none" = 静音;其余 = public/sfx/<名>.mp3
  if (doc?.cards?.length && result.mov && hasFfmpeg) {
    const SFX_DIR = path.join(ROOT, "public", "sfx");
    const KIND_SFX = {
      // 计数/数据 → 数字上升
      "stat-proof": "rise", odometer: "rise", "ring-metric": "rise", "rank-bars": "rise",
      "growth-curve": "rise",
      // 对撞 → 重击
      "versus-card": "impact",
      // 满屏运镜 → 嗖
      "focus-card": "whoosh",
      // 截图标注 → 快门
      "ui-callout": "shutter",
      // 打字/代码
      "terminal-3d": "type", "type-shift": "type",
      // 结构/步骤/清单/名牌
      "chapter-bar": "chime", checklist: "ding", "step-timeline": "click", "entity-chips": "click",
      // 常驻字幕层不配音效
      "caption-track": null,
    };
    const DEFAULT_SFX = "pop-light";
    const points = doc.cards
      .map((c) => {
        const chosen = c.params?.sfx === "none"
          ? null
          : (c.params?.sfx || (c.kind in KIND_SFX ? KIND_SFX[c.kind] : DEFAULT_SFX));
        if (!chosen) return null;
        const file = path.join(SFX_DIR, `${chosen}.mp3`);
        if (!fs.existsSync(file)) return null;
        return { t: c.start, file, sfx: chosen, kind: c.kind };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    if (points.length) {
      console.log(`baking ${points.length} sfx into MOV...`);
      // 1) 静音底轨(定全长)+ 每个音效裁 3.2s 渐出、延迟到卡片出现时刻,混成一条音轨
      const mixFile = path.join(outDir, "sfx-mix.m4a");
      const args = ["-y", "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
      for (const p of points) args.push("-i", p.file);
      const ms = (t) => Math.max(0, Math.round(t * 1000));
      const chains = points.map(
        (p, i) =>
          `[${i + 1}]atrim=0:3.2,afade=t=out:st=2.7:d=0.5,volume=0.8,adelay=${ms(p.t)}|${ms(p.t)}[s${i}]`,
      );
      const mixIn = points.map((_, i) => `[s${i}]`).join("");
      args.push(
        "-filter_complex",
        `${chains.join(";")};[0]${mixIn}amix=inputs=${points.length + 1}:duration=first:normalize=0[out]`,
        "-map", "[out]", "-c:a", "aac", "-b:a", "192k", mixFile,
      );
      const rMix = spawnSync("ffmpeg", args, { stdio: "ignore" });
      // 2) 音轨封进 MOV(视频流原样拷贝,不重编码)
      if (rMix.status === 0 && fs.existsSync(mixFile)) {
        const tmp = result.mov.replace(/\.mov$/, "-audio.mov");
        const rMux = spawnSync(
          "ffmpeg",
          ["-y", "-i", result.mov, "-i", mixFile,
            // 音轨转 PCM 再封进 MOV。剪映读 .mov 里的 AAC 不稳:有一次导出
            // 音轨齐全(40 个点、max 0dB)但剪映里就是没声音,转成 pcm_s16le 后立刻正常。
            // AAC 也不是每次都出问题,
            // 所以这不是必现问题 —— 但 PCM 是 MOV 的通用选择,只多约 30MB,直接默认给它。
            "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "pcm_s16le", tmp],
          { stdio: "ignore" },
        );
        if (rMux.status === 0 && fs.existsSync(tmp)) {
          fs.renameSync(tmp, result.mov);
          result.sfxBaked = points.length;
          console.log(`sfx baked: ${points.length} points`);
        }
      }
      // 3) 清单:记录烤了什么(想换音效:选中卡片 → 「音效」下拉 → 重导)
      const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
      const sheet = [
        `音效清单 · ${name}-${stamp}(已直接混入 MOV,无需手动加)`,
        "想调整:回 Studio 选中卡片 → 节奏组「音效」下拉换一个(选中即试听)或选「无音效」,重新导出。",
        "整条音效轨的音量在剪映里对 MOV 轨道统一调(建议比人声低,约 -12~-18dB)。",
        "",
        ...points.map((p) => `${fmt(p.t)}  ${p.kind.padEnd(14)}  ${p.sfx}`),
      ].join("\n");
      const sheetPath = path.join(finalDir, `${name}-${stamp}-音效清单.txt`);
      fs.writeFileSync(sheetPath, sheet, "utf8");
      result.sfxSheet = sheetPath;
    }
  }

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
      "做法:把 MOV 放在最上层轨道,上面这几个时间段把下面的原始口播轨切开、静音或删除画面",
      "(声音要留)。其余时间段照常,MOV 盖在原片上即可。",
    ].join("\n");
    const notePath = path.join(finalDir, `${name}-${stamp}-合成说明.txt`);
    fs.writeFileSync(notePath, note, "utf8");
    result.camNote = notePath;
  }

  // ---- 清理 PNG 中间目录:成片(MOV)到手后这几 GB 就没用了,默认删除 ----
  // 合成失败或没装 ffmpeg 时保留:PNG 是几分钟渲染的成果,留着可手动重合成。
  if (result.mov && !keepFrames) {
    fs.rmSync(outDir, { recursive: true, force: true });
    result.dir = null;
    console.log("cleaned PNG frames dir");
  }

  // ---- 抽帧缓存:只留这次用到的 ----
  // 缓存键带着视频的 mtime,同一段口播换一版原片就再抽一份,旧的没人清(7 天那条只在
  // 下次导出时才跑)。用户盘满时翻不到这个目录 —— 它在 public/ 下面,名字还带下划线。
  // 换视频重导要多等一次抽帧(几分钟),换来的是磁盘不会悄悄长几个 G;对用户,盘更稀缺。
  {
    const used = new Set(Object.values(vidFrames).map((m) => path.basename(m.dir)));
    let n = 0;
    if (fs.existsSync(cacheRoot))
      for (const d of fs.readdirSync(cacheRoot))
        if (!used.has(d)) {
          fs.rmSync(path.join(cacheRoot, d), { recursive: true, force: true });
          n++;
        }
    if (n) console.log(`cleaned ${n} unused video-frame cache dir(s)`);
  }

  console.log(JSON.stringify(result));
} catch (e) {
  // 渲染到一半崩了:半成品 PNG 没用,别留几个 G 在 exports/ 里(界面上只会说「导出失败」,
  // 用户不知道还有这么一堆)。渲染完了才崩(合成阶段)的 PNG 是完整的,照旧保留。
  if (!framesDone && !keepFrames && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.error("渲染没做完,已清掉半成品 PNG 目录");
  }
  // 人话原因放在 stderr 结尾(接口取尾部展示给用户)
  console.error(String(e?.stack ?? e));
  console.error(`\n【导出失败原因】${String(e?.message ?? e).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  // 假死的渲染器连 close 都可能不回:给 10 秒,不回就直接杀进程,别让「收尾」再挂一次。
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  try { browser.process()?.kill("SIGKILL"); } catch { /* 已经退出了 */ }
}
