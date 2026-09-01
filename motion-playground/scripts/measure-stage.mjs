#!/usr/bin/env node
/**
 * 画幅量尺 · 一张卡在某个画幅里到底占了多大地方
 *
 * 干三件事:
 *   1. 量:把卡真正会画东西的元素并集成一个包围盒(bbox)
 *   2. 判:竖版下反推该用哪一档人像让位(still / half / full),跟卡里写的对一下
 *   3. 出图:截一张带让位参考线的 PNG,给人眼看
 *
 * 具体的 CSS 覆盖怎么写是审美,机器不猜 —— 这里只负责把数字和图摆出来。
 *
 * 用法: node scripts/measure-stage.mjs <effectId> [--ratio v|h] [--json]
 * 前提: Studio 开发服务在 5177 跑着(npm run dev)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = { h: { w: 1920, h: 1080 }, v: { w: 1080, h: 1920 } };

/* 采样时刻(ms):进场动画在这个库里普遍 600~900ms,所以从 1.2s 起采,
   避开「元素还在半空飞」被误判成越界。多采几次取并集 = 这张卡曾经占到过哪。 */
const SAMPLES = [1200, 2000, 2800, 3600];

/* 越界容差:小于这个数不报,抗抗亚像素和阴影外扩 */
const TOL = 8;

/**
 * ⚠️ 下面两个数是初版提案,还没拿真人素材复核过 —— 和 hud.css 里那几个让位像素同一批。
 * 你自己的画面里人站得偏上偏下,这两条线就该跟着挪。
 *
 * 人像满屏(still)时,画面分三段:上安全带 / 人脸身体 / 下安全带。
 * 卡只要整个待在某一条安全带里,人就不用动 —— 章节条、贴底小药丸都是这么用的。
 * 伸进中间那段才要让位。
 */
const BAND_TOP = 380;      // 上安全带下界:再往下就压到脸
const BAND_BOTTOM = 1620;  // 下安全带上界:再往上就压到身子

/* ---------------- 浏览器里跑的量法 ---------------- */
/* 只统计「真的会画出东西」的元素:有文字、有底色、有边框、有阴影、是图/画布。
   纯布局用的透明 div 不算 —— 它们经常整屏铺满,算进去 bbox 就永远是满屏。 */
function browserMeasure() {
  const stage = document.querySelector(".stage");
  if (!stage) return null;

  const boxes = [];
  const isClip = (v) => v !== "visible";
  const alpha = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return c && c !== "transparent" ? 1 : 0;
    const p = m[1].split(",").map((s) => parseFloat(s));
    return p.length > 3 ? p[3] : 1;
  };

  const paints = (el, cs) => {
    const tag = el.tagName.toLowerCase();
    if (["img", "svg", "canvas", "video"].includes(tag)) return true;
    if (alpha(cs.backgroundColor) > 0) return true;
    if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    if (cs.backdropFilter && cs.backdropFilter !== "none") return true;
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none") return true;
    for (const s of ["Top", "Right", "Bottom", "Left"])
      if (parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none") return true;
    return false;
  };

  const push = (r, clip) => {
    const l = Math.max(r.left, clip.l);
    const t = Math.max(r.top, clip.t);
    const rr = Math.min(r.right, clip.r);
    const b = Math.min(r.bottom, clip.b);
    if (rr - l > 0.5 && b - t > 0.5) boxes.push([l, t, rr, b]);
  };

  const walk = (el, clip) => {
    const cs = getComputedStyle(el);
    /* 整棵子树都看不见的,直接砍掉 */
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return;

    const rect = el.getBoundingClientRect();

    /* 元素自己画的底/框/图 */
    if (rect.width > 0 && rect.height > 0 && paints(el, cs)) push(rect, clip);

    /* 文字单独用 Range 量 —— 块级元素的 rect 常常比字宽得多,
       拿它当占位会把 bbox 撑成整行,判让位档就全错了 */
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) push(r, clip);
    }

    /* overflow 不是 visible 的,子孙被它裁掉 —— 传下去的裁剪框要收窄。
       没这一步,「轨道里滑动、露头就被切」的卡会被误报成越界 */
    let next = clip;
    if (isClip(cs.overflowX) || isClip(cs.overflowY))
      next = {
        l: Math.max(clip.l, rect.left),
        t: Math.max(clip.t, rect.top),
        r: Math.min(clip.r, rect.right),
        b: Math.min(clip.b, rect.bottom),
      };

    for (const c of el.children) walk(c, next);
  };

  const sr = stage.getBoundingClientRect();
  /* 起始裁剪框放宽到画布外一大圈:越界要能量出来,不能一开始就被裁掉 */
  const room = 4000;
  for (const c of stage.children)
    walk(c, { l: sr.left - room, t: sr.top - room, r: sr.right + room, b: sr.bottom + room });

  if (!boxes.length) return { empty: true };
  const bbox = boxes.reduce(
    (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  /* 换算成画布坐标(stage 是 fixed 在 0,0,理论上等值,但别假设) */
  return {
    empty: false,
    count: boxes.length,
    bbox: [bbox[0] - sr.left, bbox[1] - sr.top, bbox[2] - sr.left, bbox[3] - sr.top],
  };
}

/* 竖版让位参考线:截图上画出「人像会占哪」,不然光看图判不出压没压到人 */
function browserGuides(vars) {
  const el = document.createElement("div");
  el.id = "__vguides";
  el.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
  el.innerHTML = `
    <div style="position:absolute;left:0;right:0;top:${vars.halfTop}px;bottom:0;
      border-top:3px dashed rgba(255,64,129,.9);background:rgba(255,64,129,.10)"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:${vars.bandTop}px;
      border-bottom:3px dashed rgba(0,200,255,.9);background:rgba(0,200,255,.07)"></div>
    <div style="position:absolute;left:0;right:0;top:${vars.bandBottom}px;bottom:0;
      border-top:3px dashed rgba(0,200,255,.9);background:rgba(0,200,255,.07)"></div>
    <div style="position:absolute;right:${vars.pipRight}px;bottom:${vars.pipBottom}px;
      width:${vars.pipW}px;height:${vars.pipH}px;border:3px dashed rgba(255,214,0,.95);
      border-radius:24px;background:rgba(255,214,0,.10)"></div>`;
  document.body.appendChild(el);
}

function browserVars() {
  const cs = getComputedStyle(document.querySelector(".stage"));
  const n = (k, d) => parseFloat(cs.getPropertyValue(k)) || d;
  return {
    halfTop: n("--vhalf-top", 700),
    pipW: n("--vfull-w", 360),
    pipH: n("--vfull-h", 480),
    pipRight: n("--vfull-right", 48),
    pipBottom: n("--vfull-bottom", 80),
  };
}

/* ---------------- 主流程 ---------------- */
const LAUNCH_OPTS = {
  headless: "new",
  args: ["--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-lcd-text"],
};

export async function launchBrowser() {
  try {
    return await puppeteer.launch(LAUNCH_OPTS);
  } catch (err) {
    // 捆绑 Chromium 没下载时退回本机 Chrome(和 export-frames.mjs 同一套兜底)。
    // 量尺不吃虚拟时间,所以这里退回是安全的 —— 导出那边不是。
    if (!/executablePath|Could not find/i.test(String(err?.message))) throw err;
    return await puppeteer.launch({ ...LAUNCH_OPTS, channel: "chrome" });
  }
}

export async function measureStage({
  effectId,
  ratio = "h",
  base = "http://localhost:5177",
  shotDir = path.join(ROOT, "exports", "_verify"),
  browser: given,
}) {
  const size = STAGE[ratio === "v" ? "v" : "h"];
  const browser = given ?? (await launchBrowser());
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));

    const url = `${base}/?export=1&ratio=${ratio}&effect=${encodeURIComponent(effectId)}`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    await page
      .waitForFunction("typeof window.__startExport === 'function'", { timeout: 15000 })
      .catch(async () => {
        const hint = await page.evaluate(() => (document.body.innerText || "").trim().slice(0, 120));
        throw new Error(hint || `导出页面未就绪(${errors[0] ?? "页面白屏"})`);
      });
    /* 不下发 __fxExportMs:让卡按真实时间正常播,量的就是它自然的样子 */
    await page.evaluate(() => window.__startExport());

    const vars = await page.evaluate(browserVars);
    const samples = [];
    let prev = 0;
    for (const at of SAMPLES) {
      await new Promise((r) => setTimeout(r, at - prev));
      prev = at;
      samples.push(await page.evaluate(browserMeasure));
    }

    const live = samples.filter((s) => s && !s.empty);
    if (!live.length) {
      await page.close();
      return { ratio, empty: true, errors };
    }

    const bbox = live
      .map((s) => s.bbox)
      .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

    /* 越界:每个采样各判一次。次次都越 = 静态越界(布局问题,必须改);
       只有某几次越 = 动画途中飞出去(可能是故意的),交给人眼定 */
    const over = (b) => ({
      left: Math.max(0, 0 - b[0]),
      top: Math.max(0, 0 - b[1]),
      right: Math.max(0, b[2] - size.w),
      bottom: Math.max(0, b[3] - size.h),
    });
    const overs = live.map((s) => over(s.bbox));
    const beyond = (o) => Object.values(o).some((v) => v > TOL);
    const overflow = {
      ...over(bbox),
      always: overs.every(beyond),
      sometimes: overs.some(beyond),
    };

    /* 竖版:反推让位档 */
    let tier = null;
    if (ratio === "v") {
      const [x0, y0, x1, y1] = bbox;
      const pip = {
        l: size.w - vars.pipRight - vars.pipW,
        t: size.h - vars.pipBottom - vars.pipH,
        r: size.w - vars.pipRight,
        b: size.h - vars.pipBottom,
      };
      const hitsPip = x0 < pip.r && x1 > pip.l && y0 < pip.b && y1 > pip.t;
      /* 铺满整屏 = 底噪/常驻层那类躺在人背后的层,不是挡在人前面的大卡。
         几何上分不出前景后景,所以这里只给建议 + 一句提醒,由人定。 */
      const fullBleed = x1 - x0 >= size.w * 0.95 && y1 - y0 >= size.h * 0.95;

      let suggest, why;
      if (fullBleed) {
        suggest = "still";
        why = `内容铺满整屏 —— 当成躺在人背后的底噪层。若它其实是挡在人前面的大卡,改判 full`;
      } else if (y1 <= BAND_TOP + TOL) {
        suggest = "still";
        why = `内容只到 y=${Math.round(y1)},整个待在上安全带(0–${BAND_TOP})里,人不用动`;
      } else if (y0 >= BAND_BOTTOM - TOL) {
        suggest = "still";
        why = `内容从 y=${Math.round(y0)} 起,整个待在下安全带(${BAND_BOTTOM}–${size.h})里,人不用动`;
      } else if (y1 <= vars.halfTop + TOL) {
        suggest = "half";
        why = `内容占到 y=${Math.round(y1)},压进人脸身体那段但没过半让线 ${vars.halfTop} —— 人下沉就够`;
      } else {
        suggest = "full";
        why = `内容伸到 y=${Math.round(y1)},越过半让线 ${vars.halfTop} —— 那块地半让之后是人的`;
      }
      tier = { suggest, why, hitsPip, fullBleed, bandTop: BAND_TOP, bandBottom: BAND_BOTTOM, halfTop: vars.halfTop };
    }

    /* 出图:竖版带让位参考线 */
    fs.mkdirSync(shotDir, { recursive: true });
    if (ratio === "v") await page.evaluate(browserGuides, { ...vars, bandTop: BAND_TOP, bandBottom: BAND_BOTTOM });
    const shot = path.join(shotDir, `${effectId}-${ratio}.png`);
    await page.screenshot({ path: shot, omitBackground: true });
    await page.close();

    return {
      ratio,
      empty: false,
      size,
      bbox: bbox.map((v) => Math.round(v)),
      w: Math.round(bbox[2] - bbox[0]),
      h: Math.round(bbox[3] - bbox[1]),
      overflow,
      tier,
      shot,
      errors,
    };
  } finally {
    if (!given) await browser.close();
  }
}

/* ---------------- 命令行 ---------------- */
/* 路径里有中文:import.meta.url 会百分号转义,拼字符串比不出来,必须走 pathToFileURL */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const effectId = args.find((a) => !a.startsWith("--"));
  const i = args.indexOf("--ratio");
  const ratio = i >= 0 ? args[i + 1] : "h";
  if (!effectId) {
    console.error("usage: node scripts/measure-stage.mjs <effectId> [--ratio v|h] [--json]");
    process.exit(1);
  }
  const r = await measureStage({ effectId, ratio });
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.empty) {
    console.log(`${effectId} @ ${ratio}:画面上什么都没有 —— defaults 是空的,或动画没被触发`);
  } else {
    const o = r.overflow;
    console.log(
      `${effectId} @ ${ratio}(${r.size.w}×${r.size.h})\n` +
        `  占尺寸  ${r.w}×${r.h}  bbox=[${r.bbox.join(", ")}]\n` +
        `  越界    ${o.sometimes ? `左${Math.round(o.left)} 上${Math.round(o.top)} 右${Math.round(o.right)} 下${Math.round(o.bottom)}${o.always ? "(每次采样都越)" : "(只在动画途中越)"}` : "无"}\n` +
        (r.tier ? `  让位档  建议 ${r.tier.suggest} —— ${r.tier.why}${r.tier.hitsPip && r.tier.suggest === "full" && !r.tier.fullBleed ? "\n          ⚠️ 与全让时的人像小窗重叠,内容会被压住" : ""}\n` : "") +
        `  截图    ${path.relative(ROOT, r.shot)}`,
    );
  }
}
