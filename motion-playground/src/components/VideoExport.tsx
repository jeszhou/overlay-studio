import { useEffect, useRef, useState } from "react";
import { ExportOptions } from "./ExportOptions";
import { exportProgressView, type ExportProgressState } from "../exportProgress";
import { exportFailureMessage } from "../exportFailure";
import type { OverlayDoc } from "../overlay/types";
import "./video-export.css";

type Job = {
  requestId: string;
  mode: "timeline";
  doc: OverlayDoc;
  duration: number;
  fps: number;
  scale: number;
  speed: number;
  outputDir: string;
  outputs: string[];
  fastPng: boolean;
  compatibilityMode: boolean;
  parallelFrames: boolean;
  exportMode: "stream" | "sequence";
};
type Result = {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  details?: string;
  mov?: string;
  webm?: string;
  dir?: string;
  sfxAudio?: string;
};
interface Props {
  open: boolean;
  close: () => void;
  library: boolean;
  title: string;
  projectDir: string;
  document: OverlayDoc | null;
  effectId: string;
  params: Record<string, unknown>;
  scale: number;
  speed: number;
  videoScale: number;
  onBusy: (busy: boolean) => void;
  onTimelineExport: () => void;
  onFps: (rate: number) => void;
  onConfigure: () => void;
}
function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session values still apply. */
  }
}
async function request<T>(route: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api/" + route,
    body === undefined
      ? { cache: "no-store" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.headers.get("content-type")?.includes("json"))
    throw Error("请在本机启动 Overlay Studio 后导出视频。");
  return (await r.json()) as T;
}

export function VideoExport(props: Props) {
  const { onBusy } = props;
  const [directory, setDirectory] = useState(() => stored("overlayStudioExportDir"));
  const [seconds, setSeconds] = useState(6);
  const [fps, setFps] = useState(props.document?.exportFps ?? 29.97);
  const [webm, setWebm] = useState(false),
    [fastPng, setFastPng] = useState(false);
  const [compat, setCompat] = useState(() => stored("overlayStudioExportCompatibilityMode") === "1");
  const [parallel, setParallel] = useState(false),
    [streaming, setStreaming] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false),
    [error, setError] = useState("");
  const [running, setRunning] = useState(false),
    [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ExportProgressState | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false),
    lastJob = useRef<Job | null>(null),
    restoreResult = useRef(false),
    observed = useRef(0);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("overlayStudioExportRetry");
      if (saved) {
        lastJob.current = JSON.parse(saved);
        restoreResult.current = true;
      }
    } catch {
      /* A manual export remains available if browser storage is full. */
    }
  }, []);
  useEffect(() => {
    onBusy(running);
  }, [running, onBusy]);
  useEffect(() => {
    if (!props.open) return;
    const el = dialog.current!;
    setError("");
    setFps(props.document?.exportFps ?? 29.97);
    el.showModal();
    let alive = true;
    if (!directory) {
      if (props.projectDir) setDirectory(props.projectDir);
      else
        request<{ dir: string }>("export-folder")
          .then((r) => {
            if (alive) setDirectory((old) => old || r.dir);
          })
          .catch((e) => {
            if (alive) setError(String(e));
          });
    }
    return () => {
      alive = false;
      el.close();
    };
    // The destination and FPS are initialized once whenever the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const s = await request<
          ExportProgressState & { running: boolean; requestId?: string; result?: Result }
        >("export-status");
        if (!alive) return;
        if (s.running) {
          if (!pending.current && lastJob.current?.requestId !== s.requestId) forgetJob();
          observed.current = s.startedAt;
          setRunning(true);
          setProgress(s);
        } else if (
          !pending.current &&
          s.result &&
          ((observed.current !== 0 && observed.current === s.startedAt) ||
            (restoreResult.current && s.requestId && lastJob.current?.requestId === s.requestId))
        ) {
          restoreResult.current = false;
          observed.current = 0;
          setRunning(false);
          setCancelling(false);
          setResult(s.result);
        } else if (!pending.current && observed.current && !s.running) {
          observed.current = 0;
          setRunning(false);
          setCancelling(false);
          setResult({ ok: false, error: "导出服务已重新启动，请重新导出。" });
        }
      } catch {
        /* Keep the last known progress during a transient disconnect. */
      }
    }
    void poll();
    const timer = setInterval(poll, running ? 450 : 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running]);
  function forgetJob() {
    restoreResult.current = false;
    lastJob.current = null;
    try {
      sessionStorage.removeItem("overlayStudioExportRetry");
    } catch {
      /* The in-memory state has already been cleared. */
    }
  }
  async function run(job: Job) {
    if (pending.current) return;
    restoreResult.current = false;
    pending.current = true;
    setError("");
    lastJob.current = job;
    try {
      sessionStorage.setItem("overlayStudioExportRetry", JSON.stringify(job));
    } catch {
      /* The current tab keeps the retry snapshot in memory. */
    }
    setResult(null);
    setProgress(null);
    setCancelling(false);
    setRunning(true);
    try {
      setResult(await request<Result>("export", job));
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      pending.current = false;
      observed.current = 0;
      setRunning(false);
      setCancelling(false);
    }
  }
  async function submit() {
    if (folderBusy || pending.current) return;
    setError("");
    setFolderBusy(true);
    try {
      const folder = await request<{ ok: boolean; dir: string; error?: string }>("export-folder", {
        dir: directory.trim(),
      });
      if (!folder.ok) throw Error(folder.error || "无法写入保存文件夹");
      const doc = props.library
        ? {
            ...(props.document ?? { version: 1 as const }),
            srt: [],
            cards: [
              { id: "single", kind: props.effectId, start: 0, end: seconds, params: { ...props.params } },
            ],
          }
        : props.document;
      if (!doc?.cards.length) throw Error("请先添加卡片或打开编排");
      const duration = props.library
        ? seconds
        : Math.min(86400, Math.max(...doc.cards.map((c) => c.end)) + 0.5);
      const { reviewOrigin: _origin, ...renderDoc } = doc;
      const job: Job = {
        requestId: crypto.randomUUID(),
        mode: "timeline",
        doc: { ...renderDoc, videoScale: props.videoScale, exportFps: fps },
        duration,
        fps,
        scale: props.scale,
        speed: props.speed,
        outputDir: folder.dir,
        outputs: webm ? ["mov", "webm"] : ["mov"],
        fastPng,
        compatibilityMode: compat,
        parallelFrames: parallel,
        exportMode: streaming ? "stream" : "sequence",
      };
      remember("overlayStudioExportDir", folder.dir);
      setDirectory(folder.dir);
      props.close();
      props.onFps(fps);
      if (!props.library) props.onTimelineExport();
      void run(job);
    } catch (e) {
      setError(String(e));
    } finally {
      setFolderBusy(false);
    }
  }
  async function cancel() {
    setCancelling(true);
    try {
      const r = await request<Result>("export-cancel?startedAt=" + progress?.startedAt, {});
      if (!r.ok) throw Error(r.error);
    } catch (e) {
      setCancelling(false);
      setError(String(e));
    }
  }
  const meter = exportProgressView(progress);
  return (
    <>
      {props.open && (
        <dialog
          ref={dialog}
          className="video-export-dialog"
          aria-labelledby="video-export-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!folderBusy) props.close();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2 id="video-export-title">{props.library ? "导出单卡" : "导出整条时间轴"}</h2>
            {props.library && (
              <label>
                {props.title} · 时长（秒）
                <input
                  type="number"
                  min="2"
                  max="15"
                  required
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.valueAsNumber || 0)}
                />
              </label>
            )}
            <label>
              帧率
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[29.97, 30, 50, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} fps
                  </option>
                ))}
              </select>
            </label>
            <ExportOptions
              includeWebm={webm}
              onIncludeWebm={setWebm}
              compatibilityMode={compat}
              onCompatibilityMode={(v) => {
                setCompat(v);
                remember("overlayStudioExportCompatibilityMode", v ? "1" : "0");
              }}
              fastPng={fastPng}
              onFastPng={setFastPng}
              parallelFrames={parallel}
              onParallelFrames={setParallel}
              streaming={streaming}
              onStreaming={setStreaming}
              disabled={folderBusy}
            />
            <label>
              输出文件夹
              <input required value={directory} onChange={(e) => setDirectory(e.target.value)} />
            </label>
            <button
              className="tb-btn"
              type="button"
              disabled={folderBusy}
              onClick={async () => {
                setFolderBusy(true);
                try {
                  const d = await request<{ dir?: string; cancelled?: boolean; error?: string }>(
                    "export-folder",
                    { initialDir: directory },
                  );
                  if (d.dir) setDirectory(d.dir);
                  else if (!d.cancelled) throw Error(d.error);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setFolderBusy(false);
                }
              }}
            >
              浏览文件夹…
            </button>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button className="tb-btn" type="button" disabled={folderBusy} onClick={props.close}>
                取消
              </button>
              <button className="tb-btn tb-btn--primary" disabled={folderBusy || running}>
                开始导出
              </button>
            </footer>
          </form>
        </dialog>
      )}
      {running && (
        <aside className="export-prog" aria-label="导出进度">
          <div className="export-prog-head">
            <strong>正在导出</strong>
            <button disabled={cancelling || !progress} onClick={() => void cancel()}>
              {cancelling ? "正在取消…" : "取消导出"}
            </button>
            <b>{meter.label}</b>
          </div>
          <progress aria-label="当前导出阶段" max={100} value={meter.pct ?? undefined} />
          <div className="export-prog-sub">{meter.text}</div>
          {error && <p role="alert">{error}</p>}
        </aside>
      )}
      {!running && result && (
        <aside className="export-result" role="status">
          <b>
            {result.cancelled
              ? "导出已取消"
              : result.ok
                ? result.mov
                  ? "导出完成"
                  : "PNG 序列已保存"
                : "导出失败"}
          </b>
          {result.ok ? (
            <span>{[result.mov, result.webm, result.sfxAudio, result.dir].filter(Boolean).join("\n")}</span>
          ) : (
            !result.cancelled && <span>{exportFailureMessage(result)}</span>
          )}
          {result.ok && !result.mov && <span>安装 FFmpeg 后可生成透明 MOV。</span>}
          {result.mov && (
            <button
              onClick={async () => {
                try {
                  const d = await request<Result>("export-open", {});
                  if (!d.ok) throw Error(d.error);
                } catch (e) {
                  alert(String(e));
                }
              }}
            >
              打开输出文件夹
            </button>
          )}
          {!result.ok && (
            <button
              onClick={() => {
                if (lastJob.current) void run(lastJob.current);
                else props.onConfigure();
              }}
            >
              {lastJob.current ? "重试导出" : "选择导出设置"}
            </button>
          )}
          <button
            onClick={() => {
              forgetJob();
              setResult(null);
            }}
          >
            关闭
          </button>
        </aside>
      )}
    </>
  );
}
