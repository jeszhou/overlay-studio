import { useRef, useState } from "react";
import { uploadErrText } from "../uploadErr";
import { TIER } from "../tierFlags";
import type { Control, EffectDef } from "../effects/types";
import { EFFECT_GROUPS } from "../effects/registry";
import { kindColor } from "../effects/kindColor";
import type { OverlayCard } from "../overlay/types";

interface ParamsPanelProps {
  /** 一次改一批(应用预设):走一次状态更新,只占一步撤销 */
  onChangeMany?: (patch: Record<string, unknown>) => void;
  /** 查不到时是 undefined:编排里可能有本档没有的卡(基础版卡少),
      面板要能说清楚,不能崩 —— 见下面的 pp-empty 分支 */
  effect: EffectDef<any> | undefined;
  params: any;
  /** 画幅:竖版才给「竖版让位」这一栏 */
  ratio?: string;
  onChange: (key: string, value: unknown) => void;
  /** 时间轴模式:当前选中的卡片(可编辑出现/消失时间) */
  card?: OverlayCard | null;
  /** 时间轴模式但没选卡:显示空状态引导 */
  editMode?: boolean;
  onTimeChange?: (key: "start" | "end", value: number) => void;
  /** 时间轴模式:把选中卡片替换成另一种特效 */
  onKindChange?: (kind: string) => void;
  /** 叠放:把选中卡片在渲染顺序里往上/下挪(只和同时出现的卡换先后) */
  onLayer?: (dir: "up" | "down" | "top" | "bottom") => void;
  /** 选中卡在"同时出现的卡"里排第几层(1 = 最底下) */
  layer?: { index: number; total: number };
  /** 时间轴模式:删除选中卡片 */
  onDelete?: (id: string) => void;
  /** 效果库模式:把当前效果(连同调好的参数)插到时间轴的当前时刻 */
  onAddToTimeline?: () => void;
  /** 效果库模式:插入落点(秒),写进按钮文案让人按之前就知道加到哪 */
  addAt?: number;
  /** 效果库模式:插入后这张卡多长(秒),同样写进文案 */
  addSec?: number;
}

/** 落点文案用的 m:ss.s */
function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

/** 所有卡片通用的大小滑块(画布滚轮同步改这个值)
    上限 2 → 3:贴边卡(封面叠放、截图墙这类)按自己的固定尺寸画,
    想让它在 1920×1080 里占到半屏,2 倍不够用。 */
const SCALE_CONTROL: Control = {
  key: "scale",
  label: "卡片大小",
  type: "range",
  min: 0.4,
  max: 3,
  step: 0.05,
  unit: "×",
};

/** 所有卡片通用的速度滑块(只影响这一张卡的动画节奏) */
/** 竖版让位:只在竖版画幅下进面板 —— 横版没有让位这回事。
    空 = 用卡片自带的出厂默认(registry 里的 vTier),选了就以这张卡为准 */
const VTIER_CONTROL: Control = {
  key: "vTier",
  label: "竖版让位(这张卡出现时人退到哪)",
  type: "select",
  options: [
    { label: "跟卡片默认", value: "" },
    { label: "不让 · 人不动", value: "still" },
    { label: "半让 · 人沉到下半屏", value: "half" },
    { label: "全让 · 人缩成角落小窗", value: "full" },
  ],
};

const SPEED_CONTROL: Control = {
  key: "speed",
  label: "动画速度(此卡)",
  type: "range",
  min: 0.3,
  max: 3,
  step: 0.05,
  unit: "×",
};

/** 所有卡片通用的投影(把卡从画面里托出来;用 filter 不吃「文字光晕」总开关) */
const SHADOW_CONTROL: Control = {
  key: "shadow",
  label: "投影(把卡从画面里托出来)",
  type: "select",
  options: [
    { label: "无", value: "none" },
    { label: "柔和投影", value: "soft" },
    { label: "硬投影(参考片那种)", value: "hard" },
    { label: "深色描边", value: "outline" },
  ],
};

/** 所有卡片通用的音效选择(导出时烤进 MOV 音轨;选中即试听) */
export const SFX_OPTIONS = [
  { label: "🔊 自动(按特效类型)", value: "" },
  { label: "🔇 无音效", value: "none" },
  { label: "轻点 pop", value: "pop-light" },
  { label: "弹出 pop", value: "pop" },
  { label: "连环 pop(多物弹入)", value: "pop-cluster" },
  { label: "大转场 嗖", value: "whoosh" },
  { label: "轻转场 嗖", value: "whoosh-soft" },
  { label: "打字声", value: "type" },
  { label: "点击", value: "click" },
  { label: "相机快门", value: "shutter" },
  { label: "翻页 叮", value: "chime" },
  { label: "达成铃", value: "ding" },
  { label: "重击(盖章/落锤)", value: "impact" },
  { label: "轻击", value: "hit-soft" },
  { label: "电子故障", value: "glitch" },
  { label: "魔法闪光", value: "sparkle" },
  { label: "数字上升", value: "rise" },
];

const SFX_CONTROL: Control = {
  key: "sfx",
  label: "音效(出现时响,导出自动混入)",
  type: "select",
  options: SFX_OPTIONS,
};

/* ---- 参数分组:内容 / 节奏 / 样式 / 落位与大小 ----
   一目了然的关键:先改什么字,再对什么节奏,再挑什么样式,最后摆哪里 */
type Group = "content" | "timing" | "style" | "layout";

const GROUP_META: { id: Group; label: string; en: string }[] = [
  { id: "content", label: "内容", en: "CONTENT" },
  { id: "timing", label: "节奏", en: "TIMING" },
  { id: "style", label: "样式", en: "STYLE" },
  { id: "layout", label: "落位与大小", en: "LAYOUT" },
];

function groupOf(c: Control): Group {
  if (["offsetX", "offsetY", "position", "side", "corner", "scale", "vTier"].includes(c.key))
    return "layout";
  if (c.key === "speed" || c.key === "sfx") return "timing";
  if (c.type === "range" && (c.unit === "ms" || c.unit === "s")) return "timing";
  if (c.type === "select" || c.type === "toggle" || c.type === "color") return "style";
  return "content";
}

/* ---- 预设:把一张卡当前的全部参数存成可复用组合(localStorage,跨会话长期有效) ---- */
const PRESET_KEY = "fx-presets-v1";
type PresetStore = Record<string, { name: string; params: Record<string, unknown> }[]>;

function loadPresets(): PresetStore {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * 预设**只套样式,不套文案**。
 * 判定很简单:text / textarea 控件装的就是"这张卡自己的内容"——
 * 标题、金句、步骤、素材路径(img1、videoSrc、src、camSrc 都是 text 控件)、
 * 卡点秒串(times)、巡览路线(stops),换一张卡这些必须是新的。
 * 再额外排掉 clipStart*(素材起始秒,是 range 但同样跟素材绑死)。
 * 剩下的 range / select / toggle —— 颜色、字号、窗形、倾斜、落位、速度 —— 才是"风格"。
 */
function contentKeys(controls: Control[]): Set<string> {
  const skip = new Set<string>();
  for (const c of controls)
    if (c.type === "text" || c.type === "textarea") skip.add(c.key);
  for (const c of controls) if (/^clipStart\d*$/.test(c.key)) skip.add(c.key);
  // 再排掉 *At 结尾的:subAt / firstAt / intoAt / noteAt … 都是"这张卡第几秒点亮"的卡点,
  // 按 SRT 算出来的,跟样式没关系。它们是 range+秒,不排的话会被预设当样式带过去,
  // 挨张套预设时把所有卡的点亮时刻抹成同一个值(实际踩到过)。
  for (const c of controls) if (/At$/.test(c.key)) skip.add(c.key);
  return skip;
}

function PresetRow({
  effectId,
  controls,
  params,
  onChange,
  onChangeMany,
}: {
  effectId: string;
  controls: Control[];
  params: any;
  onChange: (key: string, value: unknown) => void;
  onChangeMany?: (patch: Record<string, unknown>) => void;
}) {
  const [store, setStore] = useState<PresetStore>(loadPresets);
  const [sel, setSel] = useState("");
  const mine = store[effectId] ?? [];
  const persist = (next: PresetStore) => {
    setStore(next);
    localStorage.setItem(PRESET_KEY, JSON.stringify(next));
  };
  const save = () => {
    const name = window.prompt("给这套参数起个名字(如:黑玻璃·右侧·带音效):")?.trim();
    if (!name) return;
    // __ 开头的是时间轴运行时注入的内部值;文案/素材也不进预设(见 contentKeys)
    const skip = contentKeys(controls);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>))
      if (!k.startsWith("__") && !skip.has(k)) clean[k] = v;
    persist({
      ...store,
      [effectId]: [...mine.filter((p) => p.name !== name), { name, params: clean }],
    });
    setSel(name);
  };
  const apply = (name: string) => {
    setSel(name);
    const p = mine.find((x) => x.name === name);
    if (!p) return;
    // 只套样式:文案 / 素材那几个键跳过,当前卡自己的内容原样留着
    const skip = contentKeys(controls);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.params)) if (!skip.has(k)) patch[k] = v;
    // 必须一次写进去:逐个 onChange 会被状态更新的批处理吃掉,只剩最后一个 key 生效
    if (onChangeMany) onChangeMany(patch);
    else for (const [k, v] of Object.entries(patch)) onChange(k, v);
  };
  const del = () => {
    if (!sel || !window.confirm(`删除预设「${sel}」?`)) return;
    persist({ ...store, [effectId]: mine.filter((p) => p.name !== sel) });
    setSel("");
  };
  return (
    <div className="ctrl">
      <div className="ctrl-head">
        <span>预设(只套样式,文案不动)</span>
      </div>
      <div className="preset-line">
        <select
          className="ctrl-input kind-select"
          value={sel}
          onChange={(e) => apply(e.target.value)}
        >
          <option value="">{mine.length ? "选一套应用…" : "还没有预设,调好后存一套"}</option>
          {mine.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="video-btn preset-btn" onClick={save} title="把当前参数存为预设">
          💾
        </button>
        {sel && (
          <button className="video-btn preset-btn" onClick={del} title="删除选中的预设">
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

/** 媒体路径控件:选文件 → 上传进 public/demo/ → 自动填路径(预览和导出都可用) */
function MediaRow({
  label,
  accept,
  noun,
  value,
  onChange,
}: {
  label: string;
  accept: string;
  noun: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pick = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/upload-demo?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      });
      const data = await res.json();
      if (data.ok) onChange(data.src);
      else alert(`❌ 上传失败:${data.error}`);
    } catch (e) {
      alert(`❌ 上传失败:${uploadErrText(e)}`);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="ctrl">
      <div className="ctrl-head">
        <span>{label}</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
      <div className="video-row">
        <button
          className="video-btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "⏳ 上传中…" : value ? `📁 换${noun}` : `📁 选择${noun}`}
        </button>
        {/* 传错了要能撤:清空路径 = 这个位子空出来(空位不渲染,不会留空框) */}
        {Boolean(value) && (
          <button className="video-btn video-btn--clear" onClick={() => onChange("")}>
            ✕ 清除
          </button>
        )}
      </div>
      {Boolean(value) && <div className="demo-src">{String(value)}</div>}
    </div>
  );
}

/**
 * 批量上传:一次选多张图,按**文件名顺序**依次填进 img1、img2……
 * 为什么要一次写进去:逐个 onChange 会被 React 的批处理吃掉,只剩最后一个 key 生效,
 * 所以这里攒成一个 patch 交给 onChangeMany(和预设那边同一个坑)。
 */
function MediaBulkRow({
  keys,
  onChangeMany,
}: {
  keys: string[];
  onChangeMany: (patch: Record<string, unknown>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    // 文件选择框给的顺序各系统不一样,统一按文件名排,谁先弹出来是可预期的
    const list = Array.from(files).sort((a, b) =>
      a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }),
    );
    const over = list.length - keys.length;
    if (over > 0 && !confirm(`选了 ${list.length} 张,这张卡最多 ${keys.length} 张。\n只用前 ${keys.length} 张(按文件名排),继续?`))
      return;
    const use = list.slice(0, keys.length);
    const patch: Record<string, unknown> = {};
    // 没选到的槽位清空 = 这一批就是全部,不会混着上一批的残图
    for (const k of keys) patch[k] = "";
    for (let i = 0; i < use.length; i++) {
      setBusy(`${i + 1}/${use.length}`);
      try {
        const res = await fetch(`/api/upload-demo?name=${encodeURIComponent(use[i].name)}`, {
          method: "POST",
          body: use[i],
        });
        const data = await res.json();
        if (data.ok) patch[keys[i]] = data.src;
        else alert(`❌ ${use[i].name} 上传失败:${data.error}`);
      } catch (e) {
        alert(`❌ ${use[i].name} 上传失败:${uploadErrText(e)}`);
      }
    }
    setBusy("");
    onChangeMany(patch);
  };
  return (
    <div className="ctrl">
      <div className="ctrl-head">
        <span>批量上传(一次选多张)</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,video/webm"
        style={{ display: "none" }}
        onChange={(e) => {
          pick(e.target.files);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
      <div className="video-row">
        <button className="video-btn" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
          {busy ? `⏳ 上传中 ${busy}…` : `📁 一次选最多 ${keys.length} 张`}
        </button>
      </div>
      <div className="demo-src">按文件名顺序填进下面的槽位,并覆盖原有的图。</div>
    </div>
  );
}

function ControlRow({
  control,
  value,
  onChange,
}: {
  control: Control;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (control.type === "range") {
    const num = Number(value);
    return (
      <label className="ctrl">
        <div className="ctrl-head">
          <span>{control.label}</span>
          <span className="ctrl-val">
            {num}
            {control.unit ?? ""}
          </span>
        </div>
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }

  if (control.type === "color") {
    const v = /^#[0-9a-fA-F]{6}$/.test(String(value ?? "")) ? String(value) : "#000000";
    return (
      <label className="ctrl">
        <div className="ctrl-head">
          <span>{control.label}</span>
          <span className="ctrl-val">{v}</span>
        </div>
        {/* 原生取色器:面板里自带吸管,可直接吸屏幕颜色 */}
        <input
          type="color"
          className="ctrl-color"
          value={v}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  if (control.type === "text") {
    return (
      <label className="ctrl">
        <div className="ctrl-head">
          <span>{control.label}</span>
        </div>
        <input
          type="text"
          className="ctrl-input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  if (control.type === "textarea") {
    // div 而非 label:help 折叠面板的点击不能触发 label 的聚焦转发
    return (
      <div className="ctrl">
        <div className="ctrl-head">
          <span>{control.label}</span>
        </div>
        {control.help && (
          <details className="ctrl-help">
            <summary>📖 语法速查</summary>
            <pre>{control.help}</pre>
          </details>
        )}
        <textarea
          className="ctrl-input ctrl-textarea"
          rows={control.rows ?? 6}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (control.type === "select") {
    // 选项多的用原生下拉(分段按钮放不下);音效选中即试听
    if (control.options.length > 8) {
      return (
        <label className="ctrl">
          <div className="ctrl-head">
            <span>{control.label}</span>
          </div>
          <select
            className="ctrl-input kind-select"
            value={String(value ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v);
              if (control.key === "sfx" && v && v !== "none") {
                const a = new Audio(`/sfx/${v}.mp3`);
                a.volume = 0.6;
                a.play().catch(() => {});
              }
            }}
          >
            {control.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <div className="ctrl">
        <div className="ctrl-head">
          <span>{control.label}</span>
        </div>
        <div className="seg">
          {control.options.map((opt) => (
            <button
              key={opt.value}
              className={`seg-btn ${value === opt.value ? "is-on" : ""}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // toggle
  return (
    <label className="ctrl ctrl-toggle">
      <span>{control.label}</span>
      <button
        className={`switch ${value ? "is-on" : ""}`}
        role="switch"
        aria-checked={Boolean(value)}
        onClick={() => onChange(!value)}
      >
        <span className="switch-knob" />
      </button>
    </label>
  );
}

/** 按 key 选择渲染器:videoSrc = 录屏选择器,img* = 图片选择器,其余走通用控件 */
function renderControl(
  c: Control,
  params: any,
  onChange: (key: string, value: unknown) => void,
  imgKeys: string[] = [],
  onChangeMany?: (patch: Record<string, unknown>) => void,
) {
  // videoSrc / videoSrc2 / videoSrc3… 都走上传器(多段录屏拼接用)
  if (/^videoSrc\d*$/.test(c.key))
    return (
      <MediaRow
        key={c.key}
        label={c.key === "videoSrc" ? "录屏视频" : c.label}
        accept="video/*"
        noun="录屏文件"
        value={params[c.key]}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  if (c.key === "src")
    return (
      <MediaRow
        key={c.key}
        label={c.label}
        accept="video/*,image/*"
        noun="视频/图"
        value={params[c.key]}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  if (c.key === "camSrc")
    return (
      <MediaRow
        key={c.key}
        label="口播视频(烤进导出 · 需 H264)"
        accept="video/*"
        noun="口播文件"
        value={params[c.key]}
        onChange={(v) => onChange(c.key, v)}
      />
    );
  if (/^img\d/.test(c.key)) {
    const row = (
      <MediaRow
        key={c.key}
        label={c.label}
        accept="image/*,video/mp4,video/quicktime,video/webm"
        noun="图/视频"
        value={params[c.key]}
        onChange={(v) => onChange(c.key, v)}
      />
    );
    // 多槽位的卡(截图墙、照片环绕…)在第一个槽前面多给一个「一次选多张」
    if (c.key === imgKeys[0] && imgKeys.length > 1 && onChangeMany)
      return [
        <MediaBulkRow key="__imgbulk" keys={imgKeys} onChangeMany={onChangeMany} />,
        row,
      ];
    return row;
  }
  return (
    <ControlRow
      key={c.key}
      control={c}
      value={params[c.key]}
      onChange={(v) => onChange(c.key, v)}
    />
  );
}

export function ParamsPanel({
  effect,
  params,
  onChange,
  onChangeMany,
  card,
  editMode,
  onLayer,
  layer,
  onTimeChange,
  onKindChange,
  onDelete,
  onAddToTimeline,
  addAt = 0,
  addSec = 5,
  ratio,
}: ParamsPanelProps) {
  // 「更换特效」搜索词(卡片越来越多,先搜再换)
  const [kindQuery, setKindQuery] = useState("");
  // 加入时间轴之后不再跳回编辑台,所以按钮自己要给一下「加成功了」的回执
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<number | null>(null);
  // 选中的卡这一档没有(基础版卡少,别人用专业版做的编排里就会有)。
  // 以前这里是 EFFECTS.find(...)! 直接当它一定在,结果 effect.controls 读了个
  // undefined —— **整页白屏**,连哪张卡出问题都看不到。画布和导出早就写了
  // `if (!def) return null` 跳过,只有这块面板会炸。
  if (card && !effect) {
    return (
      <aside className="panel panel-right">
        <div className="pp-head">
          <span className="pp-kicker">单卡参数 · Card</span>
        </div>
        <div className="pp-empty">
          这张卡是 <b>{card.kind}</b>,
          <br />
          你这个版本里没有。
          <br />
          <br />
          它在画面上不会出现。用上面的
          <br />
          「更换特效」换一张,或直接删掉。
        </div>
      </aside>
    );
  }

  // 兜底:上面两种情况之外 effect 一定在(效果库那条路查不到会退回 EFFECTS[0])。
  // 写出来是为了让类型检查替我们盯着下面几十处 effect.xxx —— 以后再有人往
  // 这块传 undefined,是编译期报错,不是用户那边白屏。
  if (!effect) return null;

  // 编辑台没选卡:给一个明确的空状态,而不是显示无关参数
  if (editMode && !card) {
    return (
      <aside className="panel panel-right">
        <div className="pp-head">
          <span className="pp-kicker">单卡参数 · Card</span>
        </div>
        <div className="pp-empty">
          在<b>时间轴色块</b>或<b>左栏卡片列表</b>里
          <br />
          点选一张卡,这里就能调它的
          <br />
          内容 / 节奏 / 样式 / 落位。
        </div>
      </aside>
    );
  }

  // 所有控件(含通用大小/速度)按组归类,顺序:内容 → 节奏 → 样式 → 落位
  // 发行版功能开关:基础版关掉的控件直接不进面板(见 tierFlags.ts)
  const own = effect.controls.filter(
    (c) => TIER.glassControl || (c.key !== "glass" && c.key !== "glassAlpha"),
  );
  // 通用控件给卡自带的同名控件让位:比如 warp-title 自带 speed(穿梭速度),
  // 再叠通用 SPEED_CONTROL 就是两个滑杆写同一个参数 + React 重复 key
  const ownKeys = new Set(own.map((c) => c.key));
  const universal = [
    ...(TIER.shadowControl ? [SHADOW_CONTROL] : []),
    SCALE_CONTROL,
    SPEED_CONTROL,
    SFX_CONTROL,
    // 竖版才给:让位是竖屏特有的问题,横版面板不该多这一栏
    ...(TIER.verticalRatio && ratio === "v" ? [VTIER_CONTROL] : []),
  ].filter((c) => !ownKeys.has(c.key));
  const all: Control[] = [...own, ...universal];
  // 这张卡有几个图片槽位(img1、img2…):有两个以上才给「一次选多张」
  const imgKeys = effect.controls
    .map((c) => c.key)
    .filter((k) => /^img\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const grouped = new Map<Group, Control[]>();
  for (const c of all) {
    const g = groupOf(c);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(c);
  }

  return (
    <aside className="panel panel-right">
      {/* 头部:我在调哪张卡 */}
      <div className="pp-head">
        <span className="pp-kicker">{card ? `单卡参数 · ${card.id}` : "效果模板"}</span>
        <span className="pp-name">
          <i className="fx-dot" style={{ background: kindColor(effect.id) }} />
          {effect.name}
          <em>{effect.description.split(" · ")[0]}</em>
        </span>
      </div>

      <div className="ctrl-list">
        {/* 换卡 + 时间:单卡最常用的两个动作,固定在最上面 */}
        {card && onKindChange && (
          <div className="ctrl">
            <div className="ctrl-head">
              {/* 标签跟着分档走:基础版关掉了内容搬家(kindSwapCarry),换卡给的是新卡默认值。
                  写死「内容保留」的话,基础版用户换完发现文案没了,而时间和落位又确实还在,
                  只会以为是自己手滑 —— 失败是静默的,不会有人来问。 */}
              <span>
                {TIER.kindSwapCarry
                  ? "更换特效(内容/时间/位置保留)"
                  : "更换特效(时间/位置保留,文案重置)"}
              </span>
            </div>
            <input
              className="ctrl-input"
              type="search"
              placeholder="🔍 先搜再换:名字 / 用途"
              value={kindQuery}
              onChange={(e) => setKindQuery(e.target.value)}
              style={{ marginBottom: 6 }}
            />
            <select
              className="ctrl-input kind-select"
              value={card.kind}
              onChange={(e) => onKindChange(e.target.value)}
            >
              {(() => {
                const kw = kindQuery.trim().toLowerCase();
                const hit = (e: EffectDef<any>) =>
                  !kw ||
                  e.id.toLowerCase().includes(kw) ||
                  e.name.toLowerCase().includes(kw) ||
                  e.description.toLowerCase().includes(kw) ||
                  e.id === card.kind; // 当前卡永远在列表里,select 才不会失配
                return EFFECT_GROUPS.map((g) => {
                  const list = (kw && g.title.toLowerCase().includes(kw)
                    ? g.effects
                    : g.effects.filter(hit));
                  if (list.length === 0) return null;
                  return (
                    <optgroup key={g.title} label={g.title}>
                      {list.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} · {e.description}
                        </option>
                      ))}
                    </optgroup>
                  );
                });
              })()}
            </select>
          </div>
        )}
        {card && onTimeChange && (
          <div className="ctrl time-ctrl">
            <div className="ctrl-head">
              <span>出现 → 消失(秒)</span>
              <span className="ctrl-val">{(card.end - card.start).toFixed(1)}s</span>
            </div>
            <div className="time-fields">
              <input
                type="number"
                className="ctrl-input"
                step={0.1}
                min={0}
                value={card.start}
                onChange={(e) => onTimeChange("start", Number(e.target.value))}
              />
              <span className="time-sep">→</span>
              <input
                type="number"
                className="ctrl-input"
                step={0.1}
                min={0}
                value={card.end}
                onChange={(e) => onTimeChange("end", Number(e.target.value))}
              />
            </div>
          </div>
        )}
        {card && (
          <div className="ctrl">
            <div className="ctrl-head">
              <span>讲过变浅时刻(秒,空 = 不变浅)</span>
            </div>
            <input
              type="number"
              className="ctrl-input"
              step={0.1}
              min={0}
              placeholder="到这秒后压暗让位,但不退场"
              value={typeof params.dimAt === "number" ? params.dimAt : ""}
              onChange={(e) =>
                onChange("dimAt", e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
            {typeof params.dimAt === "number" && (
              <div className="dim-mode-row">
                {[
                  ["both", "变浅+缩小"],
                  ["fade", "只变浅"],
                  ["shrink", "只缩小"],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    className={`dim-mode-btn${((params.dimMode as string) || "both") === v ? " is-on" : ""}`}
                    onClick={() => onChange("dimMode", v === "both" ? undefined : v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 预设:这张卡的常用参数组合(存本机,长期有效) */}
        {TIER.presets && <PresetRow
          key={effect.id}
          effectId={effect.id}
          controls={effect.controls}
          params={params}
          onChange={onChange}
          onChangeMany={onChangeMany}
        />}

        {/* 四组参数:内容 / 节奏 / 样式 / 落位与大小 */}
        {GROUP_META.map(({ id, label, en }) => {
          const items = grouped.get(id);
          if (!items?.length) return null;
          return (
            <section className="pp-sec" key={id}>
              <div className="pp-sec-head">
                <span>{label}</span>
                <i>{en}</i>
              </div>
              {items.map((c) =>
                renderControl(
                  c,
                  { ...params, scale: params.scale ?? 1, speed: params.speed ?? 1 },
                  onChange,
                  imgKeys,
                  onChangeMany,
                ),
              )}
            </section>
          );
        })}

        {/* 叠放:画布按数组顺序画,排在后面的压在上面。这里只在"同时出现的卡"之间挪,
            跟不见面的卡换先后没有视觉意义。挪到头了按钮自动变灰。 */}
        {card && onLayer && layer && layer.total > 1 && (
          <section className="pp-sec">
            <div className="pp-sec-head">
              <span>叠放</span>
              <i>LAYER</i>
            </div>
            <div className="ctrl">
              <div className="video-row">
                <button
                  className="video-btn"
                  disabled={layer.index >= layer.total}
                  onClick={() => onLayer("up")}
                  title="压到上面一张的前面"
                >
                  ⬆ 上移一层
                </button>
                <button
                  className="video-btn"
                  disabled={layer.index <= 1}
                  onClick={() => onLayer("down")}
                  title="退到下面一张的后面"
                >
                  ⬇ 下移一层
                </button>
              </div>
              <div className="video-row">
                <button
                  className="video-btn"
                  disabled={layer.index >= layer.total}
                  onClick={() => onLayer("top")}
                >
                  ⏫ 置顶
                </button>
                <button
                  className="video-btn"
                  disabled={layer.index <= 1}
                  onClick={() => onLayer("bottom")}
                >
                  ⏬ 置底
                </button>
              </div>
              <div className="demo-src">
                这一刻同屏 {layer.total} 张,它排第 {layer.index} 层(第 {layer.total} 层在最上面)
              </div>
            </div>
          </section>
        )}

        {card && onDelete && (
          <button className="del-card-btn" onClick={() => onDelete(card.id)}>
            🗑 删除这张卡(Delete)
          </button>
        )}
      </div>

      {/* 效果库的终点动作:挑卡 → 看画面 → 调参 → 加入,一条从左到右的流水线,
          按钮就长在流水线末端(以前它在顶栏,跟画布比例那些「只改怎么看」的
          配置混在一起)。文案写全落点和时长,按之前就知道会发生什么。
          加完不跳回编辑台 —— 时间轴本来两个模式都常驻,新卡在轨道上看得见,
          停在原地才能连着加好几张。 */}
      {!editMode && onAddToTimeline && (
        <div className="pp-foot">
          <button
            className={`pp-add-btn ${justAdded ? "is-done" : ""}`}
            onClick={() => {
              onAddToTimeline();
              setJustAdded(true);
              if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
              addedTimer.current = window.setTimeout(() => setJustAdded(false), 1400);
            }}
          >
            {justAdded ? "✓ 已加入,可以接着加下一张" : `＋ 加到 ${fmt(addAt)},时长 ${addSec} 秒`}
          </button>
        </div>
      )}
    </aside>
  );
}
