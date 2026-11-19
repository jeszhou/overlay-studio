import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { isFolderPickerCancellation, resolveExportFolder } from "./scripts/export-folder.mjs";

/** Use the visible Windows common Save dialog to pick its containing folder. The explicit owner matters:
 * a dialog without one can stay hidden while the HTTP request waits forever. */
function chooseExportFolder(initial: string): Promise<string | null> {
  let command: string;
  let args: string[];
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Windows.Forms",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$owner = New-Object System.Windows.Forms.Form",
      "$owner.Text = 'Overlay Studio · 选择保存文件夹'",
      "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
      "$owner.Size = New-Object System.Drawing.Size(320, 90)",
      "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog",
      "$owner.MaximizeBox = $false",
      "$owner.MinimizeBox = $false",
      "$owner.ShowInTaskbar = $true",
      "$owner.TopMost = $true",
      "$owner.Show()",
      "[void]$owner.Activate()",
      "$dialog = New-Object System.Windows.Forms.SaveFileDialog",
      "$dialog.Title = '选择保存文件夹（不会创建文件）'",
      "$dialog.FileName = '选定此文件夹'",
      "$dialog.Filter = '所有文件 (*.*)|*.*'",
      "$dialog.InitialDirectory = $env:OVERLAY_STUDIO_EXPORT_DIR",
      "$dialog.AddExtension = $false",
      "$dialog.CheckFileExists = $false",
      "$dialog.CheckPathExists = $true",
      "$dialog.OverwritePrompt = $false",
      "try { if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine([System.IO.Path]::GetDirectoryName($dialog.FileName)) } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }",
    ].join("; ");
    command = "powershell.exe";
    args = ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  } else if (process.platform === "darwin") {
    command = "osascript";
    args = ["-e", 'POSIX path of (choose folder with prompt "Choose a folder for Overlay Studio exports")'];
  } else {
    command = "zenity";
    args = [
      "--file-selection",
      "--directory",
      "--title=Choose a folder for Overlay Studio exports",
      `--filename=${initial}${path.sep}`,
    ];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: false,
      env: { ...process.env, OVERLAY_STUDIO_EXPORT_DIR: initial },
    });
    let output = "";
    let error = "";
    let settled = false;
    const finish = (value: string | null | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value instanceof Error) reject(value);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("系统文件夹窗口没有响应，请在上方直接粘贴完整路径"));
    }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-8192);
    });
    child.stderr.on("data", (chunk) => {
      error = (error + chunk).slice(-8192);
    });
    child.once("error", (cause) => finish(cause));
    child.once("close", (code) => {
      const chosen = output.trim().replace(/^\uFEFF/, "");
      if (chosen) finish(chosen);
      else if (isFolderPickerCancellation(process.platform, code, error)) finish(null);
      else finish(new Error(error.trim() || "无法打开系统文件夹窗口，请在上方直接粘贴完整路径"));
    });
  });
}

export function projectFolderPlugin(): Plugin {
  return {
    name: "project-folders",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          !/^\/api\/(project(?:-save)?\/|project-folder(?:$|\?)|overlay(?:$|\?|-(?:archive|status)(?:$|\?)))/.test(
            req.url || "",
          )
        )
          return next();
        const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "");
        if (
          !loopback ||
          (req.headers.origin &&
            req.headers.origin !== "http://" + req.headers.host &&
            req.headers.origin !== "https://" + req.headers.host)
        ) {
          res.statusCode = 403;
          res.end("仅限本地编辑器");
          return;
        }
        next();
      });
      server.middlewares.use("/api/project-folder", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const fallback = path.join(server.config.root, "exports", "projects");
        try {
          if (req.method === "GET") {
            res.end(JSON.stringify({ dir: fallback }));
            return;
          }
          if (req.method !== "POST") throw Error("仅支持选择保存文件夹");
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 16384) throw Error("路径过长");
          }
          const { dir, browse } = JSON.parse(body);
          const request = browse ? await chooseExportFolder(dir || fallback) : dir;
          if (request === null) {
            res.end(JSON.stringify({ cancelled: true }));
            return;
          }
          if (!request) throw Error("请输入保存文件夹");
          if (request === fallback) fs.mkdirSync(fallback, { recursive: true });
          res.end(JSON.stringify({ dir: resolveExportFolder(server.config.root, request) }));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}
