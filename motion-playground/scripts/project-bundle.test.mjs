import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packProject, unpackProject, inspectProjectAssets } from "./project-bundle.mjs";
test("portable bundle restores media references including multiline fields and fonts into a unique folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-bundle-test-"));
  try {
    fs.mkdirSync(path.join(root, "public/_media"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/assets/fonts"), { recursive: true });
    fs.writeFileSync(path.join(root, "public/_media/test.png"), "image");
    fs.writeFileSync(path.join(root, "src/assets/fonts/Test-400.woff2"), "font");
    const doc = {
      version: 1,
      projectId: "original",
      font: "Test",
      cards: [
        { id: "a", kind: "quote-lockup", start: 0, end: 2, params: { quote: "图片|/_media/test.png?v=1" } },
      ],
      srt: [{ start: 0, end: 1, text: "中文\nEnglish" }],
    };
    const archive = path.join(root, "project.overlaypack");
    await packProject(root, doc, fs.createWriteStream(archive));
    const restored = await unpackProject(root, fs.createReadStream(archive));
    assert.match(restored.cards[0].params.quote, /图片\|\/_projects\//);
    assert.equal(restored.fontAssets[0].family, "Test");
    assert.deepEqual(restored.srt, doc.srt);
    assert.equal(inspectProjectAssets(root, restored).length, 0);
    const again = await unpackProject(root, fs.createReadStream(archive));
    assert.notEqual(restored.cards[0].params.quote, again.cards[0].params.quote);
    assert.notEqual(restored.projectId, doc.projectId);
    assert.notEqual(restored.projectId, again.projectId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
