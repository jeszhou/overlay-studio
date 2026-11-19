import { useCallback, useEffect, useRef, useState } from "react";
export const AUTOSAVE_KEY = "overlayStudioAutosave";
export const BACKUP_KEY = "overlayStudioAutosaveBackup";
export function useProjectAutosave(value: unknown, ready: boolean) {
  const current = useRef(value);
  current.current = value;
  const [status, setStatus] = useState("正在恢复工程…");
  const failed = useRef(false);
  const last = useRef("");
  const savedStatus = useRef("已自动保存");
  const flush = useCallback(() => {
    if (!ready) return;
    try {
      const raw = JSON.stringify(current.current);
      if (raw === last.current) {
        setStatus(current.current === null ? "尚未创建工程" : savedStatus.current);
        return;
      }
      if (current.current === null) {
        localStorage.removeItem(AUTOSAVE_KEY);
        last.current = raw;
        setStatus("尚未创建工程");
        return;
      }
      const previous = localStorage.getItem(AUTOSAVE_KEY);
      if (previous && previous !== raw) {
        try {
          const prior = JSON.parse(previous);
          if (Array.isArray((prior?.overlay ?? prior)?.cards)) localStorage.setItem(BACKUP_KEY, previous);
        } catch {
          /* Current save still gets its own attempt. */
        }
      }
      localStorage.setItem(AUTOSAVE_KEY, raw);
      last.current = raw;
      failed.current = false;
      savedStatus.current = "上次自动保存：" + new Date().toLocaleString("zh-CN", { hour12: false });
      setStatus(savedStatus.current);
    } catch {
      failed.current = true;
      setStatus("自动保存失败，请立即另存工程");
    }
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    setStatus("正在保存…");
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [value, ready, flush]);
  useEffect(() => {
    const hide = () => flush();
    const leave = (e: BeforeUnloadEvent) => {
      flush();
      if (failed.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [ready, flush]);
  return { status, flush };
}
