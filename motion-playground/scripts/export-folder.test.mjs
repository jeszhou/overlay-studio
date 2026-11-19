import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveExportFolder } from "./export-folder.mjs";

test("default exports remain in project output folder", () => {
  const root = path.join(os.tmpdir(), "overlay-project");
  assert.equal(resolveExportFolder(root, ""), path.join(root, "exports", "output"));
});

test("a chosen existing folder is used without changing or creating it", () => {
  const chosen = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-export-folder-"));
  try {
    assert.equal(resolveExportFolder(os.tmpdir(), chosen), chosen);
    assert.equal(resolveExportFolder(os.tmpdir(), `"${chosen}"`), chosen);
  } finally {
    fs.rmdirSync(chosen);
  }
});

test("invalid destinations fail before rendering begins", () => {
  const root = os.tmpdir();
  assert.throws(() => resolveExportFolder(root, "relative/path"), /完整路径/);
  assert.throws(() => resolveExportFolder(root, path.join(root, "missing-overlay-export-folder")), /不存在/);
  assert.throws(() => resolveExportFolder(root, process.execPath), /不是文件夹/);
});

 test('folder picker distinguishes cancellation from permission failures', async () => {
 const {isFolderPickerCancellation: cancel} = await import('./export-folder.mjs');
 assert.equal(cancel('darwin',1,'execution error: User canceled. (-128)'),true);
 assert.equal(cancel('darwin',1,'Not authorized (-1743)'),false);
 assert.equal(cancel('win32',0,''),true);
 assert.equal(cancel('linux',1,''),true);
 });
