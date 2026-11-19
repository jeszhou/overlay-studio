import fs from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { captureExportFrame } from "./capture-export-frame.mjs";

/** Unknown PNG layouts fail closed. Only Chromium's 8-bit non-interlaced RGBA is accepted. */
export function isTransparentPng(bytes) {
  try {
    const png = Buffer.from(bytes);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
    let width, height;
    const parts = [];
    for (let at = 8; at + 12 <= png.length;) {
      const size = png.readUInt32BE(at), type = png.toString("ascii", at + 4, at + 8);
      if (at + 12 + size > png.length) return false;
      if (type === "IHDR") {
        width = png.readUInt32BE(at + 8); height = png.readUInt32BE(at + 12);
        if (size !== 13 || png[at + 16] !== 8 || png[at + 17] !== 6 ||
            png[at + 18] || png[at + 19] || png[at + 20]) return false;
      }
      if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + size));
      at += size + 12;
    }
    if (!width || !height || width * height > 4096 * 4096) return false;
    const stride = width * 4, expected = (stride + 1) * height;
    const raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
    if (raw.length !== expected) return false;
    // Each PNG filter predicts alpha from earlier alpha bytes only. If every
    // earlier alpha is zero, its prediction is zero too; a nonzero residual is
    // therefore the first visible pixel. RGB does not need to be decoded.
    for (let y = 0; y < height; y++) {
      const offset = y * (stride + 1);
      if (raw[offset] > 4) return false;
      for (let x = 0; x < width; x++) if (raw[offset + 4 + x * 4]) return false;
    }
    return true;
  } catch { return false; }
}

/** Same conservative scene capability as direct rendering, regardless of worker count. */
export function blankFrameCandidate(job) {
  const cards = job.doc?.cards;
  if (job.mode !== "timeline" || !Array.isArray(cards) || cards.some(c =>
    !["caption-track", "chapter-bar"].includes(c.kind) || c.seg || Number(c.params?.dimAt) > 0 ||
    !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end < c.start)) return () => false;
  return t => !cards.some(c => t >= c.start - 0.05 && t < c.end);
}

/** Per page, per contiguous empty interval; never bypass frame commits or animation stepping. */
export function createBlankFrameCapture({ page, fastPng, candidate, stats }) {
  let blank;
  return async (file, time) => {
    const empty = candidate(time) && await page.evaluate(t => {
      const stage = document.querySelector('[data-export-empty="true"]');
      return stage?.getAttribute("data-export-time") === String(t) &&
        stage.childNodes.length === 0 && document.getAnimations().length === 0;
    }, time);
    if (!empty) blank = undefined;
    if (empty && blank) {
      if (file) await fs.writeFile(file, blank);
      stats.reused++;
      return blank;
    }
    const png = await captureExportFrame(page, file, fastPng);
    stats.captured++;
    if (empty && isTransparentPng(png)) blank = png;
    return png;
  };
}
