import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/** Cache boundary shared by consecutive exports. Zero means extraction is required. */
export function readVideoFrameCache(dir, required) {
  const manifestFile = path.join(dir, "manifest.json");
  try {
    const metadata = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const count = metadata?.count;
    if (!Number.isSafeInteger(count) || count <= 0) return 0;
    if (required) {
      const { fps, durationSec } = required;
      if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationSec) || durationSec <= 0 ||
          metadata.fps !== fps || !Number.isFinite(metadata.dur) || metadata.dur < durationSec) return 0;
      // Legacy manifests only store the source duration. Their frame count must prove coverage.
      // New manifests record the completed extraction request, including a legitimate early EOF.
      const coveredSec = metadata.extractedSec ?? count / fps;
      if (!Number.isFinite(coveredSec) ||
          (metadata.extractedSec !== undefined && coveredSec > metadata.dur) ||
          coveredSec + 1e-9 < durationSec) return 0;
    }
    // Detect interrupted/truncated extractions without stat-ing every frame of a long video.
    const first = path.join(dir, "f_00001.jpg");
    const last = path.join(dir, `f_${String(count).padStart(5, "0")}.jpg`);
    return fs.existsSync(first) && fs.existsSync(last) ? count : 0;
  } catch (error) {
    if (error instanceof SyntaxError || ["ENOENT", "ENOTDIR"].includes(error?.code)) return 0;
    throw error;
  }
}

/** Return a reusable count, or prepare an empty directory for a new extraction. */
export function prepareVideoFrameCache(dir, required) {
  const count = readVideoFrameCache(dir, required);
  if (!count) {
    // A shorter/invalid same-key extraction can leave JPEGs beyond the new output's EOF.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  return count;
}

/** Keep valid unused caches for cross-job reuse; retain the existing seven-day expiry. */
export function cleanupVideoFrameCache(cacheRoot, vidFrames = {}, now = Date.now()) {
  const used = new Set(Object.values(vidFrames).map((manifest) => path.basename(manifest.dir)));
  let removed = 0;
  if (fs.existsSync(cacheRoot))
    for (const name of fs.readdirSync(cacheRoot))
      if (!used.has(name) && (
        now - fs.statSync(path.join(cacheRoot, name)).mtimeMs > 7 * 864e5 ||
        readVideoFrameCache(path.join(cacheRoot, name)) === 0
      )) {
        fs.rmSync(path.join(cacheRoot, name), { recursive: true, force: true });
        removed++;
      }
  return removed;
}

/** A source revision, independent of the requested duration. No full video read is needed. */
export function videoFrameCachePrefix(file, fps) {
  const resolved = fs.realpathSync(file);
  const stat = fs.statSync(resolved, { bigint: true });
  // ctime also changes when a same-size replacement restores the original mtime.
  const identity = [resolved, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), fps, "jpeg-q4-v2"];
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
  return `${path.basename(file).replace(/[^\w.-]+/g, "_")}-${fps}fps-v2-${digest}-`;
}

/** Choose the smallest existing range that proves coverage for this exact source revision. */
export function findVideoFrameCache(cacheRoot, prefix, required) {
  if (!fs.existsSync(cacheRoot)) return null;
  const candidates = fs.readdirSync(cacheRoot)
    .filter((key) => key.startsWith(prefix) && /^\d+s$/.test(key.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length, -1)) - Number(b.slice(prefix.length, -1)));
  for (const key of candidates) {
    const count = readVideoFrameCache(path.join(cacheRoot, key), required);
    if (count) return { key, count };
  }
  return null;
}
