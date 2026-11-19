import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { packProject } from "./project-bundle.mjs";

export function projectSaveDirectory(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new Error("请先选择工程保存文件夹");
  const target = path.resolve(dir);
  if (!fs.statSync(target).isDirectory()) throw new Error("保存位置不是文件夹");
  fs.accessSync(target, fs.constants.W_OK);
  return target;
}
function projectName(doc) {
  const clean = Array.from(String(doc.projectName || "未命名工程"), (c) =>
    c.charCodeAt(0) < 32 ? "_" : c,
  ).join("");
  const text = clean
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return "工程-" + (text || "未命名工程");
}
// Serialize each autosave file so slow requests cannot overwrite a newer snapshot.
const pending = new Map();
async function queued(key, action) {
  const previous = pending.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  pending.set(key, next);
  try {
    return await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}
export async function saveProject(root, kind, dir, doc) {
  const folder = projectSaveDirectory(dir);
  if (!doc || !Array.isArray(doc.cards)) throw new Error("工程数据无效");
  if (!["json", "pack", "autosave"].includes(kind)) throw new Error("保存类型无效");
  if (kind === "autosave") {
    if (typeof doc.projectId !== "string" || !doc.projectId) throw new Error("自动保存缺少工程编号");
    const id = createHash("sha256").update(doc.projectId).digest("hex").slice(0, 24);
    const autoDir = path.join(folder, "工程自动保存", id);
    fs.mkdirSync(autoDir, { recursive: true });
    const file = path.join(autoDir, "当前工程.overlay.json");
    return queued(file, async () => {
      const content = JSON.stringify(doc, null, 2);
      const previous = await fs.promises.readFile(file, "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (previous === content) return file;
      const tmp = path.join(autoDir, randomUUID() + ".tmp");
      const backupTmp = tmp + ".backup";
      try {
        await fs.promises.writeFile(tmp, content, { flag: "wx" });
        if (previous !== null) {
          await fs.promises.writeFile(backupTmp, previous, { flag: "wx" });
          await fs.promises.rename(backupTmp, path.join(autoDir, "上一份备份.overlay.json"));
        }
        await fs.promises.rename(tmp, file);
        return file;
      } finally {
        await Promise.all([tmp, backupTmp].map((f) => fs.promises.rm(f, { force: true })));
      }
    });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    folder,
    projectName(doc) +
      "-" +
      stamp +
      "-" +
      randomUUID().slice(0, 8) +
      (kind === "pack" ? ".overlaypack" : ".overlay.json"),
  );
  const tmp = file + ".partial";
  let destination;
  try {
    if (kind === "json") await fs.promises.writeFile(tmp, JSON.stringify(doc, null, 2), { flag: "wx" });
    else {
      destination = fs.createWriteStream(tmp, { flags: "wx" });
      await packProject(root, doc, destination);
    }
    await fs.promises.rename(tmp, file);
  } catch (error) {
    // Preflight may reject before packProject attaches its pipeline. Close even a
    // still-opening output before removing it, or the async open can recreate it.
    if (destination && !destination.closed)
      await new Promise((resolve) => {
        destination.on("error", () => {});
        destination.once("close", resolve);
        destination.destroy();
      });
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return file;
}
export function projectSavePlugin() {
  return {
    name: "project-save",
    configureServer(server) {
      server.middlewares.use("/api/project-save/", (req, res) => {
        void (async () => {
          try {
            res.setHeader("Content-Type", "application/json");
            if (req.method !== "POST") throw new Error("只支持 POST");
            if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
              throw new Error("只允许从本地编辑台保存");
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 32 * 1024 * 1024) throw new Error("工程数据超过 32 MB");
              chunks.push(chunk);
            }
            const { dir, doc } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const file = await saveProject(server.config.root, (req.url || "").slice(1), dir, doc);
            res.end(JSON.stringify({ ok: true, file }));
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(error) }));
          }
        })();
      });
    },
  };
}
