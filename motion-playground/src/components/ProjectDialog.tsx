import { useEffect, useRef, useState } from "react";
import { projectFolder } from "../overlay/project";

interface Props {
  name: string;
  directory: string;
  onSave: (kind: "json" | "pack", name: string, directory: string) => Promise<void>;
  onClose: () => void;
}

export function ProjectDialog({ name, directory, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [projectName, setName] = useState(name);
  const [folder, setFolder] = useState(directory);
  const [kind, setKind] = useState<"json" | "pack">("json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    let active = true;
    if (!directory)
      projectFolder()
        .then((dir) => {
          if (active && dir) setFolder((current) => current || dir);
        })
        .catch(() => {
          if (active) setError("本地保存服务不可用，可从左栏下载编排 JSON。");
        });
    return () => {
      active = false;
      dialog.close();
    };
  }, [directory]);

  return (
    <dialog
      ref={ref}
      className="project-dialog"
      aria-labelledby="project-heading"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const dir = await projectFolder({ dir: folder.trim() });
            if (dir) {
              await onSave(kind, projectName.trim(), dir);
              onClose();
            }
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="project-heading">保存工程</h2>
        <label>
          工程名称
          <input
            required
            autoFocus
            maxLength={80}
            value={projectName}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          文件类型
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="json">工程 JSON</option>
            <option value="pack">便携工程包（含素材）</option>
          </select>
        </label>
        <label>
          保存文件夹
          <input required value={folder} onChange={(e) => setFolder(e.target.value)} />
        </label>
        <button
          type="button"
          className="tb-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const dir = await projectFolder({ dir: folder, browse: true });
              if (dir) setFolder(dir);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          浏览文件夹…
        </button>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="tb-btn" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="tb-btn tb-btn--primary" disabled={busy || !projectName.trim() || !folder.trim()}>
            {busy ? "正在处理…" : "保存"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function ImportProjectDialog({
  onChoose,
  onCancel,
}: {
  onChoose: (keepMedia: boolean) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="project-dialog"
      aria-labelledby="open-project-heading"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="open-project-heading">打开工程</h2>
      <p>新文件自带的字幕和视频优先使用。</p>
      <footer>
        <button className="tb-btn" onClick={onCancel}>
          取消
        </button>
        <button className="tb-btn" onClick={() => onChoose(true)}>
          保留当前字幕和视频
        </button>
        <button className="tb-btn tb-btn--primary" onClick={() => onChoose(false)}>
          作为新工程打开
        </button>
      </footer>
    </dialog>
  );
}
