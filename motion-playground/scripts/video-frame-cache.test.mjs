import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupVideoFrameCache, prepareVideoFrameCache, readVideoFrameCache } from "./video-frame-cache.mjs";

function temporaryCache(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-cache-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function completeCache(root, name, metadata = { count: 2, fps: 30, dur: 1 }) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(metadata));
  for (let frame = 1; frame <= metadata.count; frame++)
    fs.writeFileSync(path.join(dir, `f_${String(frame).padStart(5, "0")}.jpg`), "synthetic frame");
  return dir;
}

test("extending a camera consumer within the same ceil bucket cannot reuse a shorter legacy cache", (t) => {
  const cacheRoot = temporaryCache(t);
  // A ends at 7.51s; the old exporter extracted 8.01s including its 0.5s margin.
  const cameraDir = completeCache(cacheRoot, "camera-30fps-v1-9s", { count: 241, fps: 30, dur: 20 });
  assert.equal(readVideoFrameCache(cameraDir, { fps: 30, durationSec: 8.01 }), 241);
  // B ends at 8.49s, but shares the same 9s key. Its 8.99s need must miss.
  assert.equal(readVideoFrameCache(cameraDir, { fps: 30, durationSec: 8.99 }), 0);
});

test("rebuilding the same key removes stale frames before the next extraction", (t) => {
  const cacheRoot = temporaryCache(t);
  const cameraDir = completeCache(cacheRoot, "camera-30fps-v1-9s", { count: 241, fps: 30, dur: 20 });
  fs.writeFileSync(path.join(cameraDir, "f_00999.jpg"), "orphan from an interrupted extraction");
  assert.equal(prepareVideoFrameCache(cameraDir, { fps: 30, durationSec: 8.99 }), 0);
  assert.equal(fs.readdirSync(cameraDir).length, 0, "stale JPEGs must not inflate the next extraction's count");
});

test("shortening a consumer in the same bucket reuses the longer legacy cache unchanged", (t) => {
  const cacheRoot = temporaryCache(t);
  const cameraDir = completeCache(cacheRoot, "camera-30fps-v1-9s", { count: 270, fps: 30, dur: 20 });
  const before = fs.readFileSync(path.join(cameraDir, "manifest.json"), "utf8");
  assert.equal(prepareVideoFrameCache(cameraDir, { fps: 30, durationSec: 8.99 }), 270);
  assert.equal(prepareVideoFrameCache(cameraDir, { fps: 30, durationSec: 8.01 }), 270);
  assert.equal(fs.readFileSync(path.join(cameraDir, "manifest.json"), "utf8"), before);
});

test("legacy coverage uses its frame count and exact FPS, not its full source duration", (t) => {
  const cacheRoot = temporaryCache(t);
  const cameraDir = completeCache(cacheRoot, "camera-60fps-v1-2s", { count: 84, fps: 60, dur: 2.6 });
  assert.equal(readVideoFrameCache(cameraDir, { fps: 60, durationSec: 1.4 }), 84);
  assert.equal(readVideoFrameCache(cameraDir, { fps: 60, durationSec: 1.5 }), 0);
  assert.equal(readVideoFrameCache(cameraDir, { fps: 30, durationSec: 1 }), 0);
  const ntsc = 30000 / 1001;
  const ntscDir = completeCache(cacheRoot, "camera-29.97fps-v1-11s", { count: 300, fps: ntsc, dur: 20 });
  assert.equal(readVideoFrameCache(ntscDir, { fps: ntsc, durationSec: 10.009 }), 300);
  assert.equal(readVideoFrameCache(ntscDir, { fps: ntsc, durationSec: 10.011 }), 0);
});

test("legacy short-source caches can cover fractional endpoints without treating dur as coverage", (t) => {
  const cacheRoot = temporaryCache(t);
  const roundedUpDir = completeCache(cacheRoot, "rounded-up", { count: 11, fps: 30, dur: 0.35 });
  assert.equal(readVideoFrameCache(roundedUpDir, { fps: 30, durationSec: 0.35 }), 11);
  const roundedDownDir = completeCache(cacheRoot, "rounded-down", { count: 10, fps: 30, dur: 0.35 });
  assert.equal(readVideoFrameCache(roundedDownDir, { fps: 30, durationSec: 0.3 }), 10);
  assert.equal(readVideoFrameCache(roundedDownDir, { fps: 30, durationSec: 0.35 }), 0, "legacy metadata cannot prove EOF; rebuild it once");
});

test("completed extraction metadata permits repeated short-source EOF reuse but not a longer request", (t) => {
  const cacheRoot = temporaryCache(t);
  const shortDir = completeCache(cacheRoot, "short", { count: 10, fps: 30, dur: 0.35, extractedSec: 0.35 });
  assert.equal(prepareVideoFrameCache(shortDir, { fps: 30, durationSec: 0.35 }), 10);
  assert.equal(prepareVideoFrameCache(shortDir, { fps: 30, durationSec: 0.35 }), 10);
  const earlyEofDir = completeCache(cacheRoot, "early-eof", { count: 10, fps: 30, dur: 2.6, extractedSec: 2 });
  assert.equal(readVideoFrameCache(earlyEofDir, { fps: 30, durationSec: 1.8 }), 10);
  assert.equal(readVideoFrameCache(earlyEofDir, { fps: 30, durationSec: 2.1 }), 0);
});

test("A camera export remains reusable after B exports without any video", (t) => {
  const cacheRoot = temporaryCache(t);
  const cameraDir = completeCache(cacheRoot, "camera-30fps-v1-1s");
  cleanupVideoFrameCache(cacheRoot, { "/camera.mp4": { dir: "/_fxframes/camera-30fps-v1-1s" } });
  assert.equal(readVideoFrameCache(cameraDir), 2, "A initially hits its cache");
  cleanupVideoFrameCache(cacheRoot, {});
  assert.equal(readVideoFrameCache(cameraDir), 2, "A still hits after B, avoiding re-extraction");
});

test("A camera export remains reusable after B exports a different video", (t) => {
  const cacheRoot = temporaryCache(t);
  const cameraDir = completeCache(cacheRoot, "camera-30fps-v1-1s");
  const demoDir = completeCache(cacheRoot, "demo-30fps-v1-1s");
  cleanupVideoFrameCache(cacheRoot, { "/camera.mp4": { dir: "/_fxframes/camera-30fps-v1-1s" } });
  cleanupVideoFrameCache(cacheRoot, { "/demo.mp4": { dir: "/_fxframes/demo-30fps-v1-1s" } });
  assert.equal(readVideoFrameCache(cameraDir), 2, "A reuses its cache even though B had a nonempty manifest");
  assert.equal(readVideoFrameCache(demoDir), 2);
});

test("expired unused caches are removed without removing a current export's cache", (t) => {
  const cacheRoot = temporaryCache(t);
  const expiredDir = completeCache(cacheRoot, "expired-30fps-v1-1s");
  const activeDir = completeCache(cacheRoot, "active-30fps-v1-1s");
  const now = Date.now();
  const old = new Date(now - 8 * 864e5);
  fs.utimesSync(expiredDir, old, old);
  fs.utimesSync(activeDir, old, old);
  cleanupVideoFrameCache(cacheRoot, { "/active.mp4": { dir: "/_fxframes/active-30fps-v1-1s" } }, now);
  assert.equal(readVideoFrameCache(expiredDir), 0);
  assert.equal(readVideoFrameCache(activeDir), 2);
});

test("invalid cache metadata is a recoverable miss and can be cleaned", (t) => {
  const cacheRoot = temporaryCache(t);
  const invalidDir = completeCache(cacheRoot, "invalid-30fps-v1-1s");
  fs.writeFileSync(path.join(invalidDir, "manifest.json"), "{broken");
  assert.equal(readVideoFrameCache(invalidDir), 0);
  cleanupVideoFrameCache(cacheRoot, {});
  assert.equal(fs.existsSync(invalidDir), false);
});

test("a cache with a missing final frame is not reused and can be cleaned", (t) => {
  const cacheRoot = temporaryCache(t);
  const incompleteDir = completeCache(cacheRoot, "incomplete-30fps-v1-1s");
  fs.rmSync(path.join(incompleteDir, "f_00002.jpg"));
  assert.equal(readVideoFrameCache(incompleteDir), 0);
  cleanupVideoFrameCache(cacheRoot, {});
  assert.equal(fs.existsSync(incompleteDir), false);
});

test("a changed source-version cache key misses while the earlier valid version can expire", (t) => {
  const cacheRoot = temporaryCache(t);
  const oldDir = completeCache(cacheRoot, "camera-30fps-v1-1s");
  assert.equal(readVideoFrameCache(path.join(cacheRoot, "camera-30fps-v2-1s")), 0);
  assert.equal(readVideoFrameCache(oldDir), 2);
  cleanupVideoFrameCache(cacheRoot, {}, Date.now() + 8 * 864e5);
  assert.equal(readVideoFrameCache(oldDir), 0);
});

test("a longer cache is reused across duration buckets without modifying its files", async (t) => {
  const { findVideoFrameCache } = await import('./video-frame-cache.mjs');
  const root = temporaryCache(t);
  const dir = completeCache(root, 'source-v2-3s', { count: 78, fps: 30, dur: 2.6, extractedSec: 2.6 });
  const before = fs.statSync(path.join(dir, 'manifest.json')).mtimeMs;
  assert.deepEqual(findVideoFrameCache(root, 'source-v2-', { fps: 30, durationSec: 1.01 }), { key: 'source-v2-3s', count: 78 });
  assert.equal(fs.statSync(path.join(dir, 'manifest.json')).mtimeMs, before);
  assert.deepEqual(fs.readdirSync(root), ['source-v2-3s']);
});

test("cross-bucket reuse excludes unrelated, short, malformed and wrong-FPS caches", async (t) => {
  const { findVideoFrameCache } = await import('./video-frame-cache.mjs');
  const root = temporaryCache(t);
  completeCache(root, 'other-v2-9s', { count: 270, fps: 30, dur: 9, extractedSec: 9 });
  completeCache(root, 'source-v2-1s', { count: 30, fps: 30, dur: 9, extractedSec: 1 });
  completeCache(root, 'source-v2-3s', { count: 180, fps: 60, dur: 9, extractedSec: 3 });
  fs.mkdirSync(path.join(root, 'source-v2-4s'));
  assert.equal(findVideoFrameCache(root, 'source-v2-', { fps: 30, durationSec: 2 }), null);
  completeCache(root, 'source-v2-5s', { count: 150, fps: 30, dur: 9, extractedSec: 5 });
  completeCache(root, 'source-v2-8s', { count: 240, fps: 30, dur: 9, extractedSec: 8 });
  assert.deepEqual(findVideoFrameCache(root, 'source-v2-', { fps: 30, durationSec: 2 }), { key: 'source-v2-5s', count: 150 });
});

test("cache identity distinguishes same-named sources, exact FPS and source revisions", async (t) => {
  const { videoFrameCachePrefix } = await import('./video-frame-cache.mjs');
  const root = temporaryCache(t);
  const files = ['a', 'b'].map(folder => {
    fs.mkdirSync(path.join(root, folder));
    const file = path.join(root, folder, 'same.mp4');
    fs.writeFileSync(file, 'video'); fs.utimesSync(file, 1000, 1000); return file;
  });
  const initial = videoFrameCachePrefix(files[0], 30);
  assert.equal(videoFrameCachePrefix(files[0], 30), initial);
  assert.notEqual(videoFrameCachePrefix(files[1], 30), initial);
  assert.notEqual(videoFrameCachePrefix(files[0], 30000 / 1001), initial);
  fs.writeFileSync(files[0], 'replacement'); fs.utimesSync(files[0], 1000, 1000);
  assert.notEqual(videoFrameCachePrefix(files[0], 30), initial);
});
