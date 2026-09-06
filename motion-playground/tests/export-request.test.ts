import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { describe, it } from "node:test";
import type { spawn as nodeSpawn } from "node:child_process";

import { overlayExport } from "../vite.config";

type ResponseResult = {
  body: string;
  headers: Record<string, string>;
  spawned: number;
  statusCode: number;
};

async function postExport(payload: unknown): Promise<ResponseResult> {
  let spawned = 0;
  const spawnExport = ((_command: string, args: string[]) => {
    spawned += 1;
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(args[1], "utf8")));

    const child = new EventEmitter() as EventEmitter & {
      kill: () => boolean;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from('{"ok":true}\n'));
      child.emit("close", 0);
    });
    return child;
  }) as unknown as typeof nodeSpawn;

  const routes = new Map<string, (req: EventEmitter & { method?: string }, res: unknown) => void>();
  const plugin = overlayExport(spawnExport);
  const configureServer = plugin.configureServer as (server: unknown) => void;
  configureServer({
    config: { root: process.cwd(), server: { port: 5177 } },
    middlewares: {
      use(route: string, handler: (req: EventEmitter & { method?: string }, res: unknown) => void) {
        routes.set(route, handler);
      },
    },
  });

  const handler = routes.get("/api/export");
  assert.ok(handler);

  return new Promise((resolve) => {
    const req = new EventEmitter() as EventEmitter & { method: string };
    req.method = "POST";
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk = "") {
        resolve({ body: String(chunk), headers, spawned, statusCode: this.statusCode });
      },
    };

    handler(req, res);
    req.emit("data", JSON.stringify(payload));
    req.emit("end");
  });
}

describe("POST /api/export aspect preflight", () => {
  it("rejects an unsupported aspect before starting the export process", async () => {
    const result = await postExport({
      mode: "timeline",
      doc: { version: 1, aspect: "4000:1", cards: [] },
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.spawned, 0);
    assert.match(result.headers["content-type"] ?? "", /application\/json/);
    assert.match(JSON.parse(result.body).error, /画幅非法/);
  });

  it("keeps supported and legacy overlay aspects exportable", async () => {
    for (const aspect of [undefined, "16:9", "9:16"] as const) {
      const doc = { version: 1, cards: [], ...(aspect === undefined ? {} : { aspect }) };
      const result = await postExport({ mode: "timeline", doc });

      assert.equal(result.statusCode, 200, `aspect ${aspect ?? "legacy default"}`);
      assert.equal(result.spawned, 1, `aspect ${aspect ?? "legacy default"}`);
      assert.equal(JSON.parse(result.body).ok, true);
    }
  });
});
