import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createTarPacker, createTarDecoder, createGzipEncoder, createGzipDecoder } from "modern-tar";
const MAX_BYTES = 20 * 1024 ** 3;
const publicPattern = /\/(?:_media|_projects|demo|logos|sfx-default|sfx)\/[^\s|;<>"']+/g;
export function assetReferences(doc) {
  const refs = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(publicPattern)) refs.add(match[0]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(doc);
  return [...refs];
}
function sourcePath(root, url) {
  const base = path.resolve(root, "public");
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  const first = clean.split("/")[1];
  if (!["_media", "_projects", "demo", "logos", "sfx", "sfx-default"].includes(first))
    throw new Error("素材目录无效");
  let file = path.resolve(base, "." + clean);
  if (!file.startsWith(path.join(base, first) + path.sep)) throw new Error("素材路径越界");
  if (first === "sfx" && !fs.existsSync(file) && /^\/sfx\/[^/]+\.mp3$/i.test(clean))
    file = path.join(base, "sfx-default", path.basename(file));
  if (!file.startsWith(base + path.sep)) throw new Error("素材路径越界");
  if (fs.existsSync(file) && !fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep))
    throw new Error("素材路径越界");
  return file;
}
function collectFonts(root, doc) {
  const names = new Set();
  const visit = (v) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "font" && typeof x === "string" && x) names.add(x);
      else if (typeof x === "object") visit(x);
    }
  };
  visit(doc);
  const dir = path.join(root, "src/assets/fonts");
  const installed = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];
  return installed
    .filter((f) => /\.(otf|ttf|woff2?)$/i.test(f))
    .flatMap((f) => {
      const stem = f.replace(/\.(otf|ttf|woff2?)$/i, "");
      const m = stem.match(/^(.+)-(\d{3})$/);
      const family = m?.[1] ?? stem;
      return names.has(family) ? [{ file: path.join(dir, f), family, weight: m?.[2] ?? "400" }] : [];
    });
}
export function inspectProjectAssets(root, doc) {
  return assetReferences(doc).filter((url) => {
    try {
      return !fs.statSync(sourcePath(root, url)).isFile();
    } catch {
      return true;
    }
  });
}
export async function packProject(root, doc, destination) {
  if (!doc || !Array.isArray(doc.cards)) throw new Error("缺少工程数据");
  const missing = inspectProjectAssets(root, doc);
  if (missing.length) throw new Error("素材缺失，请先重新定位：" + missing.join("、"));
  const assets = assetReferences(doc).map((url) => ({ url, file: sourcePath(root, url) }));
  const fonts = collectFonts(root, doc);
  for (const asset of [...assets, ...fonts])
    asset.entry = "assets/" + randomUUID() + path.extname(asset.file);
  const manifest = {
    format: "overlay-studio-project",
    version: 1,
    doc,
    assets: assets.map(({ url, entry }) => ({ url, entry })),
    fonts: fonts.map(({ family, weight, entry }) => ({ family, weight, entry })),
  };
  const body = Buffer.from(JSON.stringify(manifest));
  const { readable, controller } = createTarPacker();
  const output = pipeline(Readable.fromWeb(readable.pipeThrough(createGzipEncoder())), destination);
  try {
    await Readable.toWeb(Readable.from([body])).pipeTo(
      controller.add({ name: "project.json", size: body.length, type: "file" }),
    );
    for (const asset of [...assets, ...fonts])
      await Readable.toWeb(fs.createReadStream(asset.file)).pipeTo(
        controller.add({ name: asset.entry, size: fs.statSync(asset.file).size, type: "file" }),
      );
    controller.finalize();
    await output;
  } catch (e) {
    destination.destroy(e);
    await output.catch(() => {});
    throw e;
  }
}
export async function unpackProject(root, input) {
  const id = randomUUID(),
    dir = path.join(root, "public", "_projects", id);
  fs.mkdirSync(dir, { recursive: true });
  let manifest,
    total = 0,
    count = 0;
  const extracted = new Set();
  try {
    const stream = Readable.toWeb(input).pipeThrough(createGzipDecoder()).pipeThrough(createTarDecoder());
    for await (const entry of stream) {
      const name = entry.header.name;
      const size = entry.header.size;
      total += size;
      count++;
      if (
        entry.header.type !== "file" ||
        count > 10000 ||
        total > MAX_BYTES ||
        !(name === "project.json" || /^assets\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?$/.test(name))
      )
        throw new Error("工程包包含无效文件或超过 20 GB");
      if (extracted.has(name)) throw new Error("工程包包含重复文件");
      extracted.add(name);
      if (name === "project.json") {
        if (size > 32 * 1024 * 1024) throw new Error("工程数据超过 32 MB");
        manifest = JSON.parse(await new Response(entry.body).text());
      } else {
        fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
        await entry.body.pipeTo(Writable.toWeb(fs.createWriteStream(path.join(dir, name), { flags: "wx" })));
      }
    }
    if (
      manifest?.format !== "overlay-studio-project" ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.doc?.cards) ||
      !Array.isArray(manifest.assets)
    )
      throw new Error("工程包格式无效");
    const mapping = new Map();
    const urlFor = (entry) => {
      if (!extracted.has(entry) || !entry.startsWith("assets/")) throw new Error("工程包缺少素材：" + entry);
      return "/_projects/" + id + "/" + entry;
    };
    for (const a of manifest.assets) mapping.set(a.url, urlFor(a.entry));
    const orderedMapping = [...mapping].sort((a, b) => b[0].length - a[0].length);
    const rewrite = (v) => {
      if (typeof v === "string") {
        for (const [old, next] of orderedMapping) v = v.split(old).join(next);
        return v;
      }
      if (Array.isArray(v)) return v.map(rewrite);
      if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
      return v;
    };
    const doc = rewrite(manifest.doc);
    // 打开便携包创建独立工程，避免本机原工程与副本共用自动备份。
    doc.projectId = id;
    doc.fontAssets = [
      ...(doc.fontAssets ?? []),
      ...(manifest.fonts ?? []).map((f) => ({ family: f.family, weight: f.weight, url: urlFor(f.entry) })),
    ];
    return doc;
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
async function jsonBody(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 32 * 1024 * 1024) throw new Error("请求过大");
  }
  return JSON.parse(text || "{}");
}
export function projectBundlePlugin() {
  return {
    name: "project-bundle",
    configureServer(server) {
      // Uploaded and unpacked files must be available immediately, without waiting for Vite's watcher.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!/^\/(?:_media|_projects|demo)\//.test(url)) return next();
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        try {
          const file = sourcePath(server.config.root, url),
            stat = fs.statSync(file);
          if (!stat.isFile()) throw Error("not a file");
          const mime = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".woff2": "font/woff2",
            ".woff": "font/woff",
            ".ttf": "font/ttf",
            ".otf": "font/otf",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".json": "application/json",
            ".srt": "text/plain",
            ".txt": "text/plain",
          };
          res.setHeader("Content-Type", mime[path.extname(file).toLowerCase()] || "application/octet-stream");
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
          let start = 0,
            end = stat.size - 1;
          const range = req.headers.range;
          if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!m || (!m[1] && !m[2])) throw Error("range");
            if (m[1]) {
              start = Number(m[1]);
              if (m[2]) end = Math.min(Number(m[2]), end);
            } else start = Math.max(0, stat.size - Number(m[2]));
            if (start > end || start < 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
              res.statusCode = 416;
              res.setHeader("Content-Range", "bytes */" + stat.size);
              res.end();
              return;
            }
            res.statusCode = 206;
            res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + stat.size);
          }
          res.setHeader("Content-Length", Math.max(0, end - start + 1));
          if (req.method === "HEAD" || stat.size === 0) {
            res.end();
            return;
          }
          const stream = fs.createReadStream(file, { start, end });
          stream.on("error", () => res.destroy());
          res.on("close", () => stream.destroy());
          stream.pipe(res);
        } catch {
          res.statusCode = 404;
          res.end("素材不存在");
        }
      });
      server.middlewares.use("/api/project/", (req, res) => {
        void (async () => {
          try {
            res.setHeader("Content-Type", "application/json");
            if (req.method !== "POST") throw new Error("只支持 POST");
            if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
              throw new Error("只允许从本地编辑台使用");
            if (req.url === "/unpack") {
              const doc = await unpackProject(server.config.root, req);
              res.end(JSON.stringify({ ok: true, doc }));
              return;
            }
            const { doc } = await jsonBody(req);
            if (req.url === "/assets") {
              res.end(JSON.stringify({ ok: true, missing: inspectProjectAssets(server.config.root, doc) }));
              return;
            }
            if (req.url === "/pack") {
              const missing = inspectProjectAssets(server.config.root, doc);
              if (missing.length) throw new Error("请先重新定位缺失素材：" + missing.join("、"));
              res.setHeader("Content-Type", "application/gzip");
              res.setHeader("Content-Disposition", 'attachment; filename="project.overlaypack"');
              await packProject(server.config.root, doc, res);
              return;
            }
            throw new Error("未知项目操作");
          } catch (e) {
            if (!res.headersSent) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: String(e) }));
            } else res.destroy(e);
          }
        })();
      });
    },
  };
}
