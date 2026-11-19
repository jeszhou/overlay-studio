import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveProject, projectSaveDirectory } from "./project-save.mjs";
import { unpackProject } from "./project-bundle.mjs";

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-save-test-"));
  try {
    fs.mkdirSync(path.join(root, "public"));
    fs.mkdirSync(path.join(root, "用户工程"));
    await run(root, path.join(root, "用户工程"));
  } finally {
    if (root.startsWith(path.join(os.tmpdir(), "overlay-save-test-")))
      fs.rmSync(root, { recursive: true, force: true });
  }
}
const doc = {
  version: 1,
  projectId: "test-project",
  projectName: "CON/测试:工程",
  cards: [],
  srt: [{ start: 0, end: 2, text: "第一行\n第二行" }],
};
test("JSON saves to the selected Unicode folder with unique safe filenames", () =>
  fixture(async (root, dir) => {
    const [a, b] = await Promise.all([
      saveProject(root, "json", dir, doc),
      saveProject(root, "json", dir, doc),
    ]);
    assert.notEqual(a, b);
    assert.equal(path.dirname(a), dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(a)), doc);
    assert(!/[<>:"/\\|?*]/.test(path.basename(a)));
  }));
test("disk autosave serializes changes, keeps one previous backup, and separates projects", () =>
  fixture(async (root, dir) => {
    const a = await saveProject(root, "autosave", dir, doc);
    await Promise.all([
      saveProject(root, "autosave", dir, { ...doc, projectName: "second" }),
      saveProject(root, "autosave", dir, { ...doc, projectName: "third" }),
    ]);
    await saveProject(root, "autosave", dir, { ...doc, projectName: "third" }); // Closing or reloading with no changes keeps the backup.
    assert.equal(JSON.parse(fs.readFileSync(a)).projectName, "third");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(path.dirname(a), "上一份备份.overlay.json"))).projectName,
      "second",
    );
    assert.notEqual(await saveProject(root, "autosave", dir, { ...doc, projectId: "other" }), a);
  }));
test("engineering bundle is saved into the selected directory and can reopen", () =>
  fixture(async (root, dir) => {
    const p = await saveProject(root, "pack", dir, doc);
    assert.equal(path.dirname(p), dir);
    const restored = await unpackProject(root, fs.createReadStream(p));
    assert.deepEqual(restored.srt, doc.srt);
  }));
test("invalid or missing destinations do not fall back to an unrelated folder", () =>
  fixture(async (root, dir) => {
    assert.throws(() => projectSaveDirectory("relative"));
    assert.throws(() => projectSaveDirectory(path.join(root, "missing")));
    await assert.rejects(saveProject(root, "unknown", dir, doc));
    await assert.rejects(saveProject(root, "autosave", dir, { version: 1, cards: [] }));
    assert.equal(fs.readdirSync(dir).length, 0);
  }));
test("failed bundles leave no partial finished file", () =>
  fixture(async (root, dir) => {
    await assert.rejects(saveProject(root, "pack", dir, { ...doc, previewVideo: "/_media/missing.mp4" }));
    assert.equal(fs.readdirSync(dir).length, 0);
  }));

test("failed bundle waits for a delayed file open to close before cleaning up", (t) =>
  fixture(async (root, dir) => {
    const original = fs.createWriteStream;
    let stream;
    t.mock.method(fs, "createWriteStream", (file, options) => {
      stream = original(file, {
        ...options,
        fs: {
          open(file, flags, mode, callback) {
            setTimeout(() => fs.open(file, flags, mode, callback), 25);
          },
          close: fs.close,
          write: fs.write,
          writev: fs.writev,
        },
      });
      return stream;
    });
    try {
      await assert.rejects(
        saveProject(root, "pack", dir, { ...doc, previewVideo: "/_media/missing.mp4" }),
        /素材缺失/,
      );
      assert.equal(stream.closed, true, "failure must wait for the pending output handle to close");
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      if (stream && !stream.closed)
        await new Promise((resolve) => {
          stream.on("error", () => {});
          stream.once("close", resolve);
          stream.destroy();
        });
    }
  }));
