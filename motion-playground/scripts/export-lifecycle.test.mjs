import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { closeBrowser } from "./export-lifecycle.mjs";

test("successful browser close lets the exporter process exit without the fallback delay", async () => {
  const moduleUrl = new URL("./export-lifecycle.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { closeBrowser } from ${JSON.stringify(moduleUrl)};
     await closeBrowser({ close: async () => {}, process: () => null }, { timeoutMs: 10_000 });`],
  { stdio: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  try {
    const [code, signal] = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (...result) => resolve(result));
    });
    assert.equal(signal, null, "a cleared fallback timer must not keep Node alive");
    assert.equal(code, 0);
  } finally { clearTimeout(timer); }
});

test("hung or rejected browser close still kills Chromium", async () => {
  for (const close of [() => new Promise(() => {}), async () => { throw new Error("disconnected"); }]) {
    const signals = [];
    await closeBrowser({ close, process: () => ({ kill: (signal) => signals.push(signal) }) }, { timeoutMs: 20 });
    assert.deepEqual(signals, ["SIGKILL"]);
  }
});
