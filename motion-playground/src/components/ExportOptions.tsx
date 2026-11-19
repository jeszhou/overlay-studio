import { useId } from "react";

interface ExportOptionsProps {
  includeWebm: boolean;
  onIncludeWebm: (include: boolean) => void;
  compatibilityMode: boolean;
  onCompatibilityMode: (enabled: boolean) => void;
  fastPng: boolean;
  onFastPng: (fast: boolean) => void;
  parallelFrames: boolean;
  onParallelFrames: (enabled: boolean) => void;
  streaming: boolean;
  onStreaming: (enabled: boolean) => void;
  disabled: boolean;
}

/** Shared by timeline and single-card exports; MOV is always included. */
export function ExportOptions({ includeWebm, onIncludeWebm, compatibilityMode, onCompatibilityMode, fastPng, onFastPng, streaming, onStreaming, parallelFrames, onParallelFrames, disabled }: ExportOptionsProps) {
  const webmDescription = useId();
  const compatibilityDescription = useId();
  const fastDescription = useId();
  const streamDescription = useId();
  const parallelDescription = useId();
  return (
    <fieldset className="export-options" disabled={disabled}>
      <legend>导出设置</legend>
      <div className="export-options-base">
        <strong>透明 MOV</strong>
        <span>默认输出 · 用于剪映</span>
      </div>
      <label className="export-option">
        <input
          type="checkbox"
          aria-label="附加 WebM"
          aria-describedby={webmDescription}
          checked={includeWebm}
          onChange={(event) => onIncludeWebm(event.target.checked)}
        />
        <span className="export-option-content">
          <span className="export-option-heading">
            <strong>附加 WebM</strong>
            <span className="export-option-state">{includeWebm ? "已开启" : "已关闭"}</span>
          </span>
          <span className="export-option-description" id={webmDescription}>
            小体积版本，用于预览或网页展示。
            <span className="export-option-cost">需要额外编码，会增加等待时间。</span>
          </span>
        </span>
      </label>
      <label className="export-option">
        <input type="checkbox" aria-label="兼容模式" aria-describedby={compatibilityDescription}
          checked={compatibilityMode} onChange={(event) => onCompatibilityMode(event.target.checked)} />
        <span className="export-option-content">
          <span className="export-option-heading">
            <strong>兼容模式</strong>
            <span className="export-option-state">{compatibilityMode ? "已开启" : "已关闭"}</span>
          </span>
          <span className="export-option-description" id={compatibilityDescription}>
            Windows 渲染画面异常缓慢时可尝试开启，仅 Windows 导出生效。
            <span className="export-option-cost">记住当前浏览器的选择；无改善或画面异常时关闭重试。</span>
          </span>
        </span>
      </label>
      <label className="export-option">
        <input
          type="checkbox"
          aria-label="加快帧截图（实验）"
          aria-describedby={fastDescription}
          checked={fastPng}
          onChange={(event) => onFastPng(event.target.checked)}
        />
        <span className="export-option-content">
          <span className="export-option-heading">
            <strong>加快帧截图</strong>
            <span className="export-option-tag">实验</span>
            <span className="export-option-state">{fastPng ? "已开启" : "已关闭"}</span>
          </span>
          <span className="export-option-description" id={fastDescription}>
            尝试缩短截图耗时，效果因工程和电脑而异。
            <span className="export-option-cost">可能增加临时磁盘占用；空间不足或出现异常时可关闭。</span>
          </span>
        </span>
      </label>
      <label className="export-option">
        <input type="checkbox" aria-label="边渲染边编码（实验）" aria-describedby={streamDescription}
          checked={streaming} onChange={(event) => onStreaming(event.target.checked)} />
        <span className="export-option-content">
          <span className="export-option-heading">
            <strong>边渲染边编码</strong>
            <span className="export-option-tag">实验</span>
            <span className="export-option-state">{streaming ? "已开启" : "已关闭"}</span>
          </span>
          <span className="export-option-description" id={streamDescription}>
            减少中间文件读写，让截图与视频编码同时进行。
            <span className="export-option-cost">不保留 PNG 序列；失败需重新渲染。效果因电脑而异，可关闭重试。</span>
          </span>
        </span>
      </label>
      <label className="export-option">
        <input type="checkbox" aria-label="并行渲染（实验）" aria-describedby={parallelDescription}
          checked={parallelFrames} onChange={(event) => onParallelFrames(event.target.checked)} />
        <span className="export-option-content">
          <span className="export-option-heading">
            <strong>并行渲染</strong>
            <span className="export-option-tag">实验</span>
            <span className="export-option-state">{parallelFrames ? "已开启" : "已关闭"}</span>
          </span>
          <span className="export-option-description" id={parallelDescription}>
            字幕与章节条可尝试两页同时渲染；含其他卡片、分组或变浅动画时使用单页。
            <span className="export-option-cost">增加内存用量，至少需两核及 8GB 内存；效果因电脑而异，可关闭重试。</span>
          </span>
        </span>
      </label>
    </fieldset>
  );
}
