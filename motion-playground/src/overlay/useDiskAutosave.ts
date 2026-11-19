import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayDoc } from "./types";
import { saveProjectFile } from "./projectFiles";

/** Browser recovery remains synchronous; disk writes are serialized and debounced. */
export function useDiskAutosave(doc: OverlayDoc | null, dir: string, ready: boolean) {
  const current = useRef({ doc, dir, ready });
  current.current = { doc, dir, ready };
  const queue = useRef(Promise.resolve());
  const lastQueued = useRef("");
  const [status, setStatus] = useState("");
  const flush = useCallback((leaving = false) => {
    const value = current.current;
    if (!value.ready || !value.doc || !value.dir) return;
    const key = JSON.stringify([value.dir, value.doc]);
    if (key === lastQueued.current) return;
    lastQueued.current = key;
    setStatus("工程文件保存中…");
    queue.current = queue.current.then(async () => {
      try {
        await saveProjectFile("autosave", value.dir, value.doc, leaving && new Blob([key]).size < 60000);
        if (key === lastQueued.current)
          setStatus("上次保存：" + new Date().toLocaleString("zh-CN", { hour12: false }));
      } catch (error) {
        if (key === lastQueued.current) {
          lastQueued.current = "";
          setStatus("工程文件保存失败：" + String(error));
        }
      }
    });
  }, []);
  useEffect(() => {
    if (!dir || !doc) {
      setStatus("");
      return;
    }
    const timer = setTimeout(() => flush(), 800);
    return () => clearTimeout(timer);
  }, [doc, dir, ready, flush]);
  useEffect(() => {
    const hide = () => flush(true);
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [flush]);
  return status;
}
