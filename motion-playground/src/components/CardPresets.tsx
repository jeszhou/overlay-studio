import { useState } from "react";
import type { Control } from "../effects/types";

type Preset = { name: string; values: Record<string, unknown> };
export function CardPresets({
  kind,
  controls,
  params,
  onApply,
}: {
  kind: string;
  controls: Control[];
  params: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
}) {
  const key = "overlayStudioStylePreset:" + kind;
  const [store, setStore] = useState<Preset[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  });
  const [name, setName] = useState("");
  const existing = store.find((p) => p.name === name.trim());
  const style = (values: Record<string, unknown>) =>
    Object.fromEntries(
      controls.filter((c) => Object.hasOwn(values, c.key)).map((c) => [c.key, values[c.key]]),
    );
  const persist = (entries: Preset[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(entries));
      setStore(entries);
    } catch {
      alert("无法保存预设，请检查浏览器存储空间。");
    }
  };
  return (
    <details className="pp-sec">
      <summary>我的样式预设</summary>
      <label>
        名称{" "}
        <input className="ctrl-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <select aria-label="已保存预设" value={existing?.name ?? ""} onChange={(e) => setName(e.target.value)}>
        <option value="">选择预设</option>
        {store.map((p) => (
          <option key={p.name}>{p.name}</option>
        ))}
      </select>
      <button
        className="video-btn"
        disabled={!name.trim()}
        onClick={() =>
          persist([...store.filter((p) => p !== existing), { name: name.trim(), values: style(params) }])
        }
      >
        保存样式
      </button>
      <button
        className="video-btn"
        disabled={!existing}
        onClick={() => existing && onApply(style(existing.values))}
      >
        应用
      </button>
      <button
        className="video-btn"
        disabled={!existing}
        onClick={() => persist(store.filter((p) => p !== existing))}
      >
        删除
      </button>
    </details>
  );
}
