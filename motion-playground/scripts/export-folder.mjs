import fs from "node:fs";
import path from "node:path";

/** Only finished exports use this folder; temporary frames remain in exports/. */
export function resolveExportFolder(root, requested) {
  const fallback = path.join(root, "exports", "output");
  if (requested == null || requested === "") return fallback;
  if (typeof requested !== "string") throw new Error("导出文件夹必须是本机路径");
  const raw = requested.trim().replace(/^"(.*)"$/, "$1");
  if (!raw || !path.isAbsolute(raw)) throw new Error("请填写导出文件夹的完整路径");
  const folder = path.resolve(raw);
  let stat;
  try {
    stat = fs.statSync(folder);
  } catch {
    throw new Error(`导出文件夹不存在：${folder}`);
  }
  if (!stat.isDirectory()) throw new Error(`导出位置不是文件夹：${folder}`);
  try {
    fs.accessSync(folder, fs.constants.W_OK);
  } catch {
    throw new Error(`无法写入导出文件夹：${folder}`);
  }
  return folder;
}

export function isFolderPickerCancellation(platform, code, stderr = "") {
  return (
    code === 0 ||
    (platform === "darwin" && code === 1 && /\(-128\)/.test(stderr)) ||
    (platform !== "win32" && code === 1 && !stderr.trim())
  );
}
