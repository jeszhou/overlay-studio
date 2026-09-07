import { useEffect, useRef, useState } from "react";

/**
 * 授权协议门:首次使用先读协议、点「我已阅读并同意」才能进 Studio。
 *
 * 协议文本取自 /LICENSE.txt —— 它是当前这份仓库的 LICENSE 的副本,所以:
 *   - 弹出的内容永远和仓库里的协议一致;
 *   - 没有这个文件就永远不弹。
 *
 * 同意记录存 localStorage(按协议文本 hash):协议改版 → hash 变 → 重新弹。
 * 「同意」按钮要滚到协议底部才亮起 —— 点过即视为知情同意(clickwrap)。
 */
const EULA_KEY = "overlayStudioEulaAccepted";

/** djb2:够用的文本指纹,协议一改 hash 必变 */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function EulaGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "needed" | "ok">("loading");
  const [text, setText] = useState("");
  const [reachedEnd, setReachedEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/LICENSE.txt")
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        // 本地开发服务器对不存在的路径会回 index.html(SPA fallback),不是 404 —— 按内容识别
        if (!t.trim() || t.trimStart().startsWith("<!") || t.includes("<html")) {
          setState("ok");
          return;
        }
        let seen = "";
        try {
          seen = localStorage.getItem(EULA_KEY) ?? "";
        } catch {
          setState("ok"); // 隐私模式记不住同意状态,不拦(拦了每次都要重点)
          return;
        }
        if (seen === hash(t)) setState("ok");
        else {
          setText(t);
          setState("needed");
        }
      })
      .catch(() => setState("ok")); // 取不到协议文件(没放这个文件 / 断网)不拦
  }, []);

  // 协议不满一屏时没有"滚到底"这回事,直接亮按钮
  useEffect(() => {
    if (state !== "needed") return;
    const el = bodyRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setReachedEnd(true);
  }, [state]);

  if (state === "loading") return null;
  if (state === "ok") return <>{children}</>;

  return (
    <div className="eula">
      <div className="eula-box">
        <div className="eula-head">
          <b>使用前请阅读授权协议</b>
          <span>滚动到底部后,点「我已阅读并同意」进入</span>
        </div>
        <div
          className="eula-body"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReachedEnd(true);
          }}
        >
          <pre>{text}</pre>
        </div>
        <div className="eula-foot">
          <button
            className="eula-btn"
            disabled={!reachedEnd}
            onClick={() => {
              try {
                localStorage.setItem(EULA_KEY, hash(text));
              } catch {
                /* 记不住就记不住,本次先放行 */
              }
              setState("ok");
            }}
          >
            {reachedEnd ? "✓ 我已阅读并同意" : "请先滚动到协议底部"}
          </button>
        </div>
      </div>
    </div>
  );
}
