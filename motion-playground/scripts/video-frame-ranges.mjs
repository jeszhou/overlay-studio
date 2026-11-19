import { createHash } from "node:crypto";

/** Inclusive source-frame ranges, padded for mount/commit boundary seeks. */
export function cameraFrameRanges(intervals, fps, extractSec, sourceSec) {
  // Keep the old EOF/count clamping semantics until separately adapted.
  if (!intervals?.length || extractSec >= sourceSec - 1) return null;
  const limit = Math.ceil(extractSec * fps);
  const ranges = intervals.map(([start, end]) => ({
    start: Math.max(0, Math.floor(start * fps) - 2),
    end: Math.min(limit - 1, Math.ceil(end * fps) + 2),
  })).filter(r => r.end >= r.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  let count = 0;
  for (const range of merged) { range.offset = count; count += range.end - range.start + 1; }
  // Avoid a different cache/command for negligible savings or very fragmented jobs.
  return count > 0 && count < limit * 0.8 && merged.length <= 64 ? merged : null;
}
export function rangeCacheSuffix(ranges) {
  return `ranges-v1-${createHash("sha256").update(JSON.stringify(ranges)).digest("hex").slice(0, 24)}`;
}
export function rangeFilter(fps, ranges, timestamps = false) {
  return `fps=${fps},select='${ranges.map(r => `between(${timestamps ? "pts" : "n"},${r.start},${r.end})`).join("+")}'`;
}
