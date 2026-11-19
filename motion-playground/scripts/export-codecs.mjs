/** Identical codec parameters for PNG files and the PNG stdin transport. */
export function videoOutputArgs(format, file, audioFile) {
  if (format === "mov") return [
    // Preserve the published PCM-in-MOV compatibility choice; do not truncate its tail with -shortest.
    ...(audioFile ? ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "pcm_s16le"] : []),
    // 预乘 alpha(定案,勿再删)。剪映按**预乘**合成 ProRes 4444:
    // 它算的是 dst*(1-a) + c,而不是 dst*(1-a) + c*a。所以必须先把 RGB 乘上 alpha。
    //
    // 8/27 曾以"预乘会把半透明压暗一倍"为由删掉这行 —— 那次测法是错的:
    // 拿 MOV 的 RGB 通道直接叠黑底比亮度(120 vs 58),那测的是文件里的裸颜色,
    // 不是剪映合出来的画面;预乘后 RGB 本来就该变暗,合成时 alpha 不再乘第二遍才对得上。
    //
    // 8/28 用真成片回归验证(45s 整帧、按 alpha 分档比对预测值与实际像素):
    //   alpha 档     直通模型误差 / 预乘模型误差
    //   ≈全透明        16.58 / 1.78
    //   很淡           78.11 / 2.28
    //   半透明(玻璃)     8.08 / 0.90
    //   较实            4.93 / 2.97
    // 每一档都是预乘模型胜。不预乘的后果:全透明区的 RGB 是近白垃圾值,
    // 会被直接加进画面，导致羽化边缘出现白环。
    "-vf", "premultiply=inplace=1",
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0",
    // 色彩空间标记:不写的话 ffprobe 三项都是 unknown,剪映只能猜,
    // 猜错就整条偏色(实测:导进剪映后整条颜色不对)。原片是 bt709,对齐它。
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", file];
  if (format === "webm") return [
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32",
    "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0", file];
  throw new Error(`Unknown video format: ${format}`);
}

/** Audio belongs only to MOV; WebM keeps its existing video-only contract. */
export function videoAudioInputArgs(format, audioFile) {
  return format === "mov" && audioFile ? ["-i", audioFile] : [];
}
