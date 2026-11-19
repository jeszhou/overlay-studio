/** Only enable the timestamp-preserving seek path for the verified input contract. */
export function cameraSeekStart(ranges, fps, probe) {
  if (!ranges?.length || !Number.isFinite(fps) || fps <= 0) return 0;
  const videos = probe?.streams?.filter(stream => stream.codec_type === "video") ?? [];
  const format = probe?.format;
  if (videos[0]?.start_time == null || format?.start_time == null ||
      videos[0].start_time === "" || format.start_time === "") return 0;
  const videoStart = Number(videos[0]?.start_time), formatStart = Number(format?.start_time);
  if (videos.length !== 1 || videos[0].codec_name !== "h264" ||
      !format?.format_name?.split(",").includes("mov") ||
      !Number.isFinite(videoStart) || !Number.isFinite(formatStart) ||
      videoStart < 0 || formatStart < 0 || Math.abs(videoStart - formatStart) > 1e-6) return 0;
  // Accurate seek still decodes from the previous keyframe. Leave extra pre-roll
  // for fps rounding/held frames, and avoid startup overhead for small skips.
  const seconds = Math.floor(ranges[0].start / fps) - 2;
  return Number.isSafeInteger(seconds) && seconds >= 5 ? seconds : 0;
}
