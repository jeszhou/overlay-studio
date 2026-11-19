/**
 * 编排文件:编辑台和 AI 助手交接用的固定位置。
 *
 * exports/ 下三样东西:
 *   当前编排.json  ——  工作文件。用户点「同步」就覆盖它;AI 重做一段也写它。
 *   INI.json       ——  本期初版。**只写一次**,之后谁都不许动,复盘时拿它当基准。
 *   归档/<日期>-<名字>/  ——  上面两份搬进去,给下一期腾地方(界面上叫「完成本期」)。
 *                          搬之前顺手把「INI vs 当前编排」写进 review-logs/,给「学一下」读。
 *
 * INI「只写一次」这条规矩封在这里,不放调用方。放调用方的话,将来任何一条新的
 * 导入路径(载入示例、拖拽、AI 直接写文件)都得各自记得留一份 —— 迟早漏掉一条,
 * 而漏掉的症状是「复盘时初版不见了」,等发现已经是几期之后。
 *
 * 规矩的具体说法是:**只要磁盘上有当前编排而没有初版,就地把当前编排固化成初版**
 * (见 ensureInitial)。不能写成「首次 POST 时把 POST 的内容当初版」—— AI 是用命令行
 * 直接写文件的,根本不经过这个接口。那样写的话,第一次 POST 来自用户点「同步」,
 * 而那时他往往已经调过参数了,INI 记下的就是「用户改过的版本」,复盘基准从一开始就是错的。
 */
import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

const CURRENT = "当前编排.json";
const SUBTITLE = "当前字幕.srt";
const INITIAL = "INI.json";
const ARCHIVE = "归档";

// 文件存在性和内容解析必须分开:AI 写到一半时也不能被当作空交接区覆盖。
function readJson(file: string): { doc?: unknown; mtime: number; error?: string } | null {
  let mtime: number;
  try {
    mtime = Math.floor(fs.statSync(file).mtimeMs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { mtime: 0, error: "无法读取交接文件，请检查文件权限后重试" };
  }
  try {
    return { doc: JSON.parse(fs.readFileSync(file, "utf8")), mtime };
  } catch {
    return { mtime, error: "交接文件无法解析，AI 可能还在写入，请等它完成或修复文件后重试" };
  }
}

/**
 * 有当前编排、没有初版 → 就地固化。
 * 在读和写两条路上都调一次:AI 写完文件后,用户无论是先「取回」还是先「同步」,
 * 被固化下来的都是 AI 那一版,而不是之后被改过的样子。
 */
function ensureInitial(cur: string, ini: string): boolean {
  if (fs.existsSync(ini) || !fs.existsSync(cur)) return false;
  const first = readJson(cur)?.doc as { cards?: unknown[] } | undefined;
  // 导入字幕会先生成空工程;它不是 AI 的第一版编排,不能占住学习基准。
  if (!Array.isArray(first?.cards) || first.cards.length === 0) return false;
  try {
    // wx:只有真的不存在才写。existsSync 和 copyFile 之间这一瞬也可能被别人抢先,
    // 而初版一旦被错的内容占掉就再也回不来了。
    fs.writeFileSync(ini, JSON.stringify(first, null, 2), { flag: "wx" });
    return true;
  } catch {
    /* 已经有了,或者读不出来 —— 都不该打断正在进行的读写 */
    return false;
  }
}

export function overlayFile(): Plugin {
  return {
    name: "overlay-file",
    configureServer(server) {
      const dir = path.join(server.config.root, "exports");
      const cur = path.join(dir, CURRENT);
      const ini = path.join(dir, INITIAL);
      const srtFile = path.join(dir, SUBTITLE);

      const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      };

      /** 两份文件各自在不在、多新。前端靠 current.mtime 判断 AI 有没有动过它。 */
      server.middlewares.use("/api/overlay-status", (_req, res) => {
        const c = readJson(cur);
        const i = readJson(ini);
        json(res, 200, {
          ok: true,
          current: c ? { exists: true, mtime: c.mtime } : { exists: false },
          initial: i ? { exists: true, mtime: i.mtime } : { exists: false },
          // 前端拿它判断「交接区还是上一期的」,好在同步前就地给收尾,而不是撞上 409 才说
          projectId:
            (c?.doc as { projectId?: string })?.projectId || (i?.doc as { projectId?: string })?.projectId,
          dir,
        });
      });

      /** 归档(完成本期):两份搬进 归档/<日期>-<名字>/,给下一期腾地方。
       *  不带 projectId 调用 = 收尾磁盘上那一期,不管编辑台里是哪个工程(同步撞上「上一期还没收尾」时用)。 */
      server.middlewares.use("/api/overlay-archive", (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { name, expectedMtime, projectId } = JSON.parse(body || "{}");
            const current = readJson(cur);
            const initial = readJson(ini);
            if (current?.error || initial?.error)
              return json(res, 409, { ok: false, error: current?.error || initial?.error });
            if (
              (expectedMtime ?? null) !== (current?.mtime ?? null) ||
              (projectId && projectId !== (current?.doc as { projectId?: string })?.projectId)
            )
              return json(res, 409, { ok: false, error: "磁盘编排已变化，请先取回并确认后重新归档" });
            if (!fs.existsSync(cur) && !fs.existsSync(ini) && !fs.existsSync(srtFile))
              return json(res, 400, { ok: false, error: "还没有可归档的编排" });

            const stamp = new Date().toISOString().slice(0, 10);
            const safe = String(name ?? "")
              .replace(/[^\w.\-一-鿿]/g, "_")
              .slice(0, 40);
            const base = path.join(dir, ARCHIVE, safe ? `${stamp}-${safe}` : stamp);
            // 同一天归档两次不许互相覆盖 —— 归档是用来「留住」的,覆盖是它唯一不能做的事。
            // 每次都从 base 起算:在 dest 上反复改后缀的话,没填名字时 `2026-09-11` 结尾的
            // `-11` 会被当成序号啃掉,变成 `2026-09-2`。
            let dest = base;
            for (let n = 2; fs.existsSync(dest); n++) dest = `${base}-${n}`;
            fs.mkdirSync(dest, { recursive: true });

            // 先搬 INI:它是不可再生的那一份。万一搬完第一个就出错,宁可丢掉可以重新导出的
            // 当前编排,也不能把初版留在原地被下一期覆盖。
            // 「学一下」读 review-logs/ 里最新的一份。以前只有导出时才写,没导出过的一期就学不到;
            // 而且导出时记的「AI 初选」是编辑台内存里的快照,刷新、取回都可能让它漂。
            // INI 是磁盘上 AI 第一版的原样,拿它当基准最准。两份一样(用户一点没改)就不写,免得学到空气。
            ensureInitial(cur, ini);
            const origin = readJson(ini);
            let learnLog = false;
            if (origin && current && JSON.stringify(origin.doc) !== JSON.stringify(current.doc)) {
              const logDir = path.join(dir, "review-logs");
              fs.mkdirSync(logDir, { recursive: true });
              const at = new Date().toISOString();
              fs.writeFileSync(
                path.join(logDir, `${at.replace(/[:.]/g, "-")}-finish-review-log.json`),
                JSON.stringify({
                  savedAt: at,
                  source: "finish-episode",
                  origin: origin.doc,
                  final: current.doc,
                }),
              );
              learnLog = true;
            }

            const moved: string[] = [];
            for (const [src, fileName] of [
              [ini, INITIAL],
              [cur, CURRENT],
              [srtFile, SUBTITLE],
            ] as const) {
              if (!fs.existsSync(src)) continue;
              fs.renameSync(src, path.join(dest, fileName));
              moved.push(fileName);
            }
            json(res, 200, { ok: true, dest, moved, learnLog });
          } catch (e) {
            json(res, 500, { ok: false, error: `归档失败:${e}` });
          }
        });
      });

      server.middlewares.use("/api/overlay", (req, res) => {
        // 读:AI 改过之后前端取回来
        if (req.method === "GET") {
          ensureInitial(cur, ini);
          const c = readJson(cur);
          if (!c) return json(res, 404, { ok: false, error: "还没有当前编排", empty: true });
          if (c.error) return json(res, 409, { ok: false, error: c.error });
          return json(res, 200, { ok: true, doc: c.doc, mtime: c.mtime });
        }
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "GET/POST only" });

        // 写:覆盖当前编排;顺带在 INI 还不存在时留下初版
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            // body 是 { doc, srt }:两样都可以缺。字幕自动转写出来之后原文件并不存在,
            // 不一起写出去,AI 就只能对着一份空编排干瞪眼 —— 而「从字幕生成编排」
            // 恰恰是整条流水线的第一步。
            const payload = JSON.parse(body || "null");
            const doc = payload && typeof payload === "object" ? payload.doc : null;
            const srt = payload && typeof payload === "object" ? payload.srt : null;
            if (!doc && typeof srt !== "string")
              return json(res, 400, { ok: false, error: "既没有编排也没有字幕,没什么可同步的" });

            const current = readJson(cur);
            const initial = readJson(ini);
            if (current?.error || initial?.error)
              return json(res, 409, { ok: false, error: current?.error || initial?.error });
            if ((payload.expectedMtime ?? null) !== (current?.mtime ?? null))
              return json(res, 409, { ok: false, error: "磁盘编排在同步期间发生变化，请取回后再试" });
            const otherId =
              (current?.doc as { projectId?: string })?.projectId ||
              (initial?.doc as { projectId?: string })?.projectId;
            if (otherId && otherId !== doc?.projectId)
              return json(res, 409, {
                ok: false,
                error: "上一期还没收尾:交接区里是另一个工程,请先点「完成本期」",
              });
            fs.mkdirSync(dir, { recursive: true });
            let savedSrt = false;
            if (typeof srt === "string" && srt.trim()) {
              const st = `${srtFile}.${process.pid}-${Date.now()}.part`;
              fs.writeFileSync(st, srt);
              fs.renameSync(st, srtFile);
              savedSrt = true;
            }
            if (srt === null && fs.existsSync(srtFile)) fs.unlinkSync(srtFile);
            if (!doc) {
              // 只有字幕、还没编排:这正是「让 AI 从零排一版」的起点,不该被当成错误
              return json(res, 200, { ok: true, savedSrt, srtOnly: true });
            }
            // 覆盖之前先固化:磁盘上那份可能是 AI 刚写的初版,一旦被这次同步盖掉就没了。
            ensureInitial(cur, ini);
            const text = JSON.stringify(doc, null, 2);
            // 先写临时文件再改名:AI 可能正好在读,直接覆写会让它读到半份。
            const tmp = `${cur}.${process.pid}-${Date.now()}.part`;
            fs.writeFileSync(tmp, text);
            fs.renameSync(tmp, cur);

            // 走到这儿还没初版,说明磁盘上本来就是空的(上面 ensureInitial 没东西可固化),
            // 那这一份就是本期第一份。wx 保证「只有不存在时才写」。
            const savedInitial = ensureInitial(cur, ini);
            json(res, 200, {
              ok: true,
              mtime: Math.floor(fs.statSync(cur).mtimeMs),
              savedInitial,
              savedSrt,
            });
          } catch (e) {
            json(res, 500, { ok: false, error: `写入失败:${e}` });
          }
        });
      });
    },
  };
}
