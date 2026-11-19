/**
 * 编排文件:编辑台 ←→ AI 助手的交接口。
 *
 * 「同步」把当前编排写进 exports/当前编排.json,AI 助手直接读写那一份;
 * 「取回」把 AI 改完的读回来。省掉「导出→翻下载文件夹→拖给 AI→下载→拖回来」。
 *
 * 这里最要紧的其实是 `synced` 这个布尔值。设计时差点漏掉它:如果只做「同步/取回」
 * 两个按钮,用户调完参数忘了点同步就去喊 AI,AI 读到的是上一次的版本 —— 它不会报错,
 * 用户也看不出来,症状和「AI 怎么没看到我的修改」一模一样,只会以为是 AI 的毛病。
 * 所以按钮旁边必须一直显示「已同步 / 有改动没同步」,这是整件事能不能用的前提。
 *
 * 反方向也会说谎,而且后果更重:同步完之后 AI 把文件改了,按钮却还写着「✓ 已同步」——
 * 用户再点一次同步,AI 刚做完的活就被无声盖掉了。所以每次写之前先看一眼文件的修改时间,
 * 跟我们上次留下的不一样就问一句。这是「盖掉别人的成果」这类操作唯一的闸门。
 *
 * 同一个「跟上次不一样」也拿来提醒取回(aiReady):AI 改完,「取回」就闪,
 * 客户不用记得去问「它改好没有」。轮询只问修改时间,不读文件内容。
 *
 * 界面文字不出现 INI / 初版:那是给 AI 和复盘用的内部概念,客户只需要知道
 * 「同步给 AI / 取回 / 完成本期」三件事。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OverlayDoc } from "../overlay/types";
import { toSrtText, type SrtLine } from "../overlay/srt";

/** 同步过的那一版长什么样。比较用,不做展示。
 *  字幕整份算进去,文字也算:以前只比条数和最后一句的时间,改错字这两样都不变,
 *  按钮继续显示「已同步」,AI 读到的还是错字版 —— 字幕编辑一上线这个洞就露出来了。 */
function fingerprint(doc: OverlayDoc | null, srt: SrtLine[] | null): string {
  return JSON.stringify([doc, srt]);
}

function when(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** 上次我们写文件时留下的时间戳。存进浏览器,因为刷新一次就归零的话,
 *  「AI 改过了吗」这道闸在刷新后的第一次同步上等于不存在 ——
 *  而「改完刷新一下」恰恰是最常见的动作顺序。 */
const PRINT_KEY = "overlay-studio:last-sync-print";
function readStoredPrint(): string | null {
  try {
    return localStorage.getItem(PRINT_KEY);
  } catch {
    return null;
  }
}
const MTIME_KEY = "overlay-studio:last-sync-mtime";
function readStoredMtime(): number | null {
  try {
    const v = localStorage.getItem(MTIME_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

interface FileStatus {
  current?: { exists: boolean; mtime?: number };
  /** 交接区里那一期的工程 id(当前编排或初版里记的) */
  projectId?: string;
  initial?: { exists: boolean; mtime?: number };
}

export interface OverlayFileState {
  /** 当前编排和文件里那份是否一致。null = 从没同步过 */
  synced: boolean | null;
  busy: boolean;
  /** 最近一次同步/取回的结果,挂在按钮提示里 */
  note: string | null;
  sync: () => Promise<void>;
  pull: () => Promise<OverlayDoc | null>;
  /** 磁盘上那份在我们上次同步/取回之后被别人(多半是 AI)改过 →「取回」该闪了 */
  aiReady: boolean;
  archive: (name: string) => Promise<{ dest: string; learnLog: boolean } | null>;
}

const POLL_MS = 3000;

export function useOverlayFile(
  overlay: OverlayDoc | null,
  srt: SrtLine[] | null,
  onPulled: (doc: OverlayDoc) => boolean,
): OverlayFileState {
  const [syncedPrint, setSyncedPrint] = useState<string | null>(readStoredPrint);
  const syncedRef = useRef(syncedPrint);
  const rememberPrint = (value: string | null) => {
    syncedRef.current = value;
    setSyncedPrint(value);
    try {
      if (value === null) localStorage.removeItem(PRINT_KEY);
      else localStorage.setItem(PRINT_KEY, value);
    } catch {
      /* session state remains available */
    }
  };
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const srtRef = useRef(srt);
  srtRef.current = srt;
  /** 我们上次留下的文件修改时间。跟磁盘上的对不上,就说明这中间有别人写过。 */
  const lastMtime = useRef<number | null>(readStoredMtime());
  const rememberMtime = (m: number | null) => {
    lastMtime.current = m;
    try {
      if (m === null) localStorage.removeItem(MTIME_KEY);
      else localStorage.setItem(MTIME_KEY, String(m));
    } catch {
      /* 存不下就退回「只在本次会话里记得」,比整个功能不能用强 */
    }
  };

  const [aiReady, setAiReady] = useState(false);
  const checkAiReady = (st: FileStatus | null) => {
    if (!st) return; // 服务暂时连不上:保持原样,别把提醒闪没了
    setAiReady(Boolean(st.current?.exists && st.current.mtime !== lastMtime.current));
  };

  const readStatus = async (): Promise<FileStatus | null> => {
    try {
      const d = await fetch("/api/overlay-status").then((r) => r.json());
      return d?.ok ? (d as FileStatus) : null;
    } catch {
      return null;
    }
  };

  const sync = useCallback(async () => {
    const doc = overlayRef.current;
    const lines = srtRef.current;
    // 只有字幕、还没编排是正常起点(让 AI 从字幕排第一版),不能当成「没东西可同步」
    if (!doc && !lines?.length) return;
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      let st = await readStatus();

      // 换了一期却忘了点「完成本期」:交接区还是上一期的。就地给收尾,不让客户自己去找按钮。
      // 放在「会不会盖掉 AI 的改动」那道闸前面:是另一期的话那道闸问的问题就不对了。
      let finishedPrev = false;
      if (st?.projectId && st.projectId !== doc?.projectId) {
        const ok = confirm(
          "上一期还没收尾。\n\n" +
            "AI 那边放的还是上一期的编排。点「确定」先把上一期收尾(存进 exports/归档/,\n" +
            "并记下「AI 排的 vs 你改完的」给「学一下」用),然后接着同步这一期。\n\n" +
            "点「取消」什么都不动。",
        );
        if (!ok) return;
        const a = await fetch("/api/overlay-archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "", expectedMtime: st.current?.mtime ?? null }),
        }).then((r) => r.json().catch(() => null));
        if (!a?.ok) throw new Error(`上一期收尾失败:${a?.error ?? "未知错误"}`);
        finishedPrev = true;
        rememberMtime(null);
        st = await readStatus();
      }

      // 拦「盖掉 AI 的成果」。只在我们写过之后才比对:lastMtime 为空时文件要么是
      // 本期第一份,要么是 AI 刚生成的初版 —— 那两种情况下写过去都不会毁掉什么。
      if (st?.current?.exists && (lastMtime.current === null || st.current.mtime !== lastMtime.current)) {
        const ok = confirm(
          `⚠️ 这份文件在你上次同步之后被改过了(${when(st.current.mtime)})。\n\n` +
            "多半是 AI 助手刚改完。现在同步会把它的改动整个盖掉。\n\n" +
            "建议先点「↓ 取回」看看它改了什么。\n\n" +
            "确定要盖掉吗?",
        );
        if (!ok) return;
      }

      const r = await fetch("/api/overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc,
          srt: lines?.length ? toSrtText(lines) : null,
          expectedMtime: st?.current?.mtime ?? null,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!d?.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);

      rememberMtime(d.mtime ?? null);
      rememberPrint(fingerprint(doc, lines));
      setAiReady(false);
      const srtPart = d.savedSrt ? ` · 字幕 ${lines?.length ?? 0} 条` : "";
      const prevPart = finishedPrev ? "上一期已收尾存档 · " : "";
      setNote(
        prevPart +
          (d.srtOnly
            ? `字幕已交给 AI(${lines?.length ?? 0} 条)· 还没有编排,可以让它排第一版了`
            : `已同步${srtPart} · 跟 AI 说要改哪里,它改完会叫你点「取回」`),
      );
    } catch (e) {
      // 同步失败必须吵醒用户。悄悄失败的话 AI 读到的是旧版本,
      // 而用户以为早就同步了 —— 这正是这个功能要消灭的那种故障。
      setNote(null);
      alert(
        `❌ 同步失败:${e}\n\n` +
          "AI 助手读到的会是上一次的版本。检查本地服务还在不在(启动时那个终端窗口),然后重试。",
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, []);

  const pull = useCallback(async (): Promise<OverlayDoc | null> => {
    if (operation.current) return null;
    operation.current = true;
    setBusy(true);
    const before = fingerprint(overlayRef.current, srtRef.current);
    try {
      const r = await fetch("/api/overlay");
      const d = await r.json().catch(() => null);
      if (!d?.ok) {
        alert(
          d?.empty
            ? "❌ 还没有「当前编排」这份文件。\n\n先点一次「同步」把现在的编排交给 AI,它才有东西可改。"
            : `❌ 取回失败:${d?.error ?? `HTTP ${r.status}`}`,
        );
        return null;
      }
      const doc = d.doc as OverlayDoc;
      if (
        (before !== fingerprint(overlayRef.current, srtRef.current) ||
          (overlayRef.current && syncedRef.current !== before)) &&
        !confirm("取回将替换尚未同步的编辑。已另存工程并确定替换吗？")
      )
        return null;
      // 指纹按「调用方最终采纳的那一版」算,不是文件里那一版:onPulled 会走一遍
      // parseOverlay(字段迁移、跳过认不出的卡),迁移过就跟文件不一致了,
      // 这时候显示「有改动待同步」是诚实的。
      if (!onPulled(doc)) return null;
      rememberMtime(d.mtime ?? null);
      rememberPrint(fingerprint(doc, doc.srt ?? null));
      setAiReady(false);
      setNote("已取回 AI 改好的版本");
      return doc;
    } catch (e) {
      alert(`❌ 取回失败:${e}`);
      return null;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, [onPulled]);

  const archive = useCallback(async (name: string): Promise<{ dest: string; learnLog: boolean } | null> => {
    if (operation.current) return null;
    if (!syncedRef.current || syncedRef.current !== fingerprint(overlayRef.current, srtRef.current)) {
      alert("还有改动没同步给 AI。先点一次「同步给 AI」,再点「完成本期」;编辑台里的内容没动。");
      return null;
    }
    operation.current = true;
    setBusy(true);
    try {
      const r = await fetch("/api/overlay-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          expectedMtime: lastMtime.current,
          projectId: overlayRef.current?.projectId,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!d?.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      rememberPrint(null);
      setNote(null);
      rememberMtime(null); // 新的一期,重新开始
      setAiReady(false);
      return { dest: d.dest as string, learnLog: Boolean(d.learnLog) };
    } catch (e) {
      alert(`❌ 收尾失败:${e}`);
      return null;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, []);

  // AI 改完了没有:定时看一眼修改时间,切回编辑台窗口时立刻再看一眼
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.hidden || operation.current) return;
      void readStatus().then((st) => alive && !operation.current && checkAiReady(st));
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);

  const cur = useMemo(() => fingerprint(overlay, srt), [overlay, srt]);
  const synced = syncedPrint === null ? null : syncedPrint === cur;

  return {
    synced,
    busy,
    note,
    sync,
    pull,
    aiReady,
    archive,
  };
}
