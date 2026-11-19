import { cardSoundEvents } from "./card-sound-events.mjs";
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, ffmpegFailure } from "./ffmpeg-process.mjs";

export function collectSfxPoints(cards, sfxDir, opts = {}) {
 const standardDir=path.basename(sfxDir).toLowerCase()==='sfx';
 const publicRoot=standardDir?path.resolve(sfxDir,'..'):path.resolve(sfxDir);
 return cardSoundEvents(cards, opts).flatMap(p=>{
  try {
   const clean=decodeURIComponent(p.file.split(/[?#]/)[0]);
   const file=path.resolve(publicRoot,'.'+(standardDir?clean:clean.replace(/^\/sfx\//,'/')));
   if(!file.startsWith(publicRoot+path.sep)) return [];
   if(fs.existsSync(file)) return [{...p,file}];
   // public/sfx/ 里没放同名文件时,退回随仓库附带的 CC0 默认音效(public/sfx-default/)
   const fallback=/^\/sfx\/[^/]+$/.test(clean)?path.join(publicRoot,'sfx-default',path.basename(clean)):'';
   return fallback && fs.existsSync(fallback) ? [{...p,file:fallback}] : [];
  } catch { return []; }
 });
}

/** Keep the published AAC mix before decoding to PCM at the final MOV encoder. */
export async function prepareSfxMix(cards, duration, outDir, sfxDir, opts = {}) {
  const points = collectSfxPoints(cards, sfxDir, opts);
  if (!points.length) return null;
  const mixFile = path.join(outDir, "sfx-mix.m4a");
  const args = ["-y", "-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
  // A subtitle track can have hundreds of cues. Reuse each audio input and put
  // the filter graph in a file to stay below Windows' command-line limit.
  const captionMix = points.some(p => p.duration !== undefined);
  const files = captionMix ? [...new Set(points.map(p => p.file))] : points.map(p => p.file);
  for (const file of files) args.push("-i", file);
  const splits = captionMix ? files.map((file, i) => {
    const uses = points.flatMap((p, n) => p.file === file ? [`[input${n}]`] : []);
    return `[${i + 1}]asplit=${uses.length}${uses.join('')}`;
  }) : [];
  const input = i => captionMix ? `[input${i}]` : `[${i + 1}]`;
  const ms = (t) => Math.max(0, Math.round(t * 1000));
  const chains = points.map(
    (p, i) => p.duration === undefined
      ? `${input(i)}atrim=0:3.2,afade=t=out:st=2.7:d=0.5,volume=0.8,adelay=${ms(p.t)}|${ms(p.t)}[s${i}]`
      : `${input(i)}atrim=0:${Math.min(3.2, p.duration ?? 3.2)}` +
        `${p.fadeIn > 0 ? `,afade=t=in:st=0:d=${Math.min(p.fadeIn,p.duration)}` : ''}` +
        `${(p.fadeOut ?? .05) > 0 ? `,afade=t=out:st=${Math.max(0,Math.min(3.2,p.duration)-(p.fadeOut ?? .05))}:d=${Math.min(p.fadeOut ?? .05,p.duration)}` : ''}` +
        `,volume=${p.volume ?? 0.8},adelay=${ms(p.t)}|${ms(p.t)}[s${i}]`,
  );
  const mixIn = points.map((_, i) => `[s${i}]`).join("");
  const graph = `${[...splits, ...chains].join(";")};[0]${mixIn}amix=inputs=${points.length + 1}:duration=first:normalize=0[out]`;
  if (captionMix) {
    const graphFile = path.join(outDir, 'caption-audio-filter.txt');
    fs.writeFileSync(graphFile, graph);
    args.push('-/filter_complex', graphFile);
  } else args.push('-filter_complex', graph);
  args.push(
    "-map", "[out]", "-c:a", "aac", "-b:a", "192k", mixFile,
  );
  let rMix = await runFfmpeg(args, { stage: "sfx", durationSec: duration });
  // FFmpeg 9 removed filter_complex_script; older releases predate -/ options.
  if (captionMix && rMix.status !== 0 && /Unrecognized option ['"]\/filter_complex/.test(rMix.stderr || '')) {
    args[args.indexOf('-/filter_complex')] = '-filter_complex_script';
    rMix = await runFfmpeg(args, { stage: "sfx", durationSec: duration });
  }
  if (rMix.status !== 0 || !fs.existsSync(mixFile)) {
    try { fs.rmSync(mixFile, { force: true }); }
    catch (error) { console.error(`混音临时文件清理失败: ${error.message}`); }
    throw ffmpegFailure(rMix, "音效混音失败");
  }
  return { points, mixFile };
}

/** May also publish metadata for a completed MOV retained after WebM failure. */
export function recordBakedSfx(result, prepared, finalDir, name, stamp) {
  if (!result?.mov || !prepared || result.sfxSheet) return;
  const { points, mixFile } = prepared;
  result.sfxBaked = points.length;
  // 音轨再单独交付一份:MOV 自带的那条剪映常常调不动
  // (ProRes 4444 带 alpha 会被放进画中画/特效轨,里面的 pcm_s16le「sowt」
  //  剪映能解码播放,但不给独立音量条;换 AAC 又出过整条没声音的问题)。
  // 单独一个 .m4a 拖进去就是普通音频轨,音量/淡入淡出/静音全都能调。
  //
  // 复制失败(盘满、权限)不能咽掉:下面的清单会照着 result.sfxAudio 决定要不要写
  // 「同目录的 -音效轨.m4a」。以前这里是空 catch,失败时清单照写,用户拿到一张
  // 指着不存在文件的说明书 —— 而 MOV 里其实已经混好了,他只是不知道。
  const sfxOut = path.join(finalDir, `${name}-${stamp}-音效轨.m4a`);
  try {
    fs.copyFileSync(mixFile, sfxOut);
    result.sfxAudio = sfxOut;
  } catch (error) {
    console.error(
      `\n【提示】单独的音效轨没能生成(${error?.message ?? error})。\n` +
        `MOV 里的音效是好的,可以直接用;只是没法在剪映里单独调音效音量。\n` +
        `多半是磁盘满了或没有写入权限 —— 清点空间后重导一次即可。\n`,
    );
  }
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const sheet = [
    `音效清单 · ${name}-${stamp}`,
    // 第 ② 份只在真的落盘了才写。说明书点名一个不存在的文件,比少说一句糟得多
    ...(result.sfxAudio
      ? [
          "音效有两份,任选一份用:",
          "  ① MOV 里已经混好了 —— 直接用,不用管音频,但剪映里调不了它的音量。",
          "  ② 同目录的「-音效轨.m4a」—— 想调音量就用这个:",
          "     先把 MOV 轨道静音,再把 .m4a 拖到一条独立音频轨(从 0 秒对齐),",
          "     这样音量/淡入淡出/单独静音全都能调(建议比人声低,约 -12~-18dB)。",
        ]
      : [
          "音效已经混进 MOV 里了 —— 直接用,不用管音频。",
          "(这次单独的「-音效轨.m4a」没能生成,所以剪映里调不了音效音量。",
          " 想要那份的话,清一下磁盘空间重导一次。)",
        ]),
    "想换音效:回 Studio 选中卡片 → 节奏组「音效」下拉换一个(选中即试听)或选「无音效」,重新导出。",
    "",
    ...points.map((p) => `${fmt(p.t)}  ${p.kind.padEnd(14)}  ${p.sfx}`),
  ].join("\n");
  const sheetPath = path.join(finalDir, `${name}-${stamp}-音效清单.txt`);
  fs.writeFileSync(sheetPath, sheet, "utf8");
  result.sfxSheet = sheetPath;
}
