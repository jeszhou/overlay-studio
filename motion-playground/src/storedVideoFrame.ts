/** Map an absolute source frame to its compact JPEG sequence without changing time. */
export function storedVideoFrame(index: number, ranges?: { start: number; end: number; offset: number }[]) {
  if (!ranges) return index;
  const range = ranges.find(r => index >= r.start && index <= r.end);
  if (!range) throw new Error(`视频抽帧缓存未覆盖源帧 ${index}`);
  return range.offset + index - range.start;
}
