import type {OverlayFileState} from '../hooks/useOverlayFile';
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadErrText } from "../uploadErr";
import type { EffectDef, VisualTag } from "../effects/types";
import { VISUAL_TAGS } from "../effects/types";
import { EFFECT_GROUPS, EFFECTS } from "../effects/registry";

/* 效果库最上面的展示栏:这几张换成了 Opus 5.5 精修动效。只在界面里多列一遍,
   不进 EFFECT_GROUPS —— 说明书按 EFFECT_GROUPS 的用途分组生成,AI 靠它挑卡 */
const OPUS_IDS = ["rank-bars", "odometer", "versus-card", "quote-lockup", "checklist", "blur-text", "chapter-bar", "pin-board", "stat-proof", "ring-metric", "growth-curve", "punch-pill", "step-timeline", "term-card", "ui-callout", "type-shift", "entity-chips", "focus-card", "terminal-3d"];
const OPUS_TITLE = "Opus 精修动效卡";
const LIB_GROUPS = [
  { title: OPUS_TITLE, effects: OPUS_IDS.map((id) => EFFECTS.find((e) => e.id === id)!).filter(Boolean) },
  ...EFFECT_GROUPS,
];
import { PROMO_URL } from "../promo";
import { kindColor } from "../effects/kindColor";
import type { OverlayDoc } from "../overlay/types";
import type { SrtLine } from "../overlay/srt";
import type { StudioTab } from "./TopBar";

interface SidebarProps {
  tab: StudioTab;
  effects: EffectDef<any>[];
  selectedId: string;
  onSelect: (id: string) => void;
  onReplay: () => void;
  hasVideo: boolean;
  /** 视频正在落盘:和顶栏那个按钮同一把锁 */
  videoBusy: boolean;
  fxScale: number;
  videoScale: number;
  onVideoScale: (v: number) => void;
  animSpeed: number;
  onAnimSpeed: (v: number) => void;
  exporting: boolean;
  overlay: OverlayDoc | null;
  selCardId: string | null;
  /** 全局底色:一键统一所有卡片亮/暗 */
  onGlobalTheme: (theme: "dark" | "light") => void;
  /** 全局口播视频(H264):运镜卡导出共用,传一次即可 */
  cam: string;
  onSetCam: (src: string) => void;
  /** 字幕稿:点句跳转,标记有没有卡覆盖 */
  srt: SrtLine[] | null;
  curT: number;
  onSeek: (t: number) => void;
  onImportSrt: (file: File | null) => void;
  onSelectCard: (id: string) => void;
  onImportJson: (file: File | null) => void;
  handoff: OverlayFileState;
  onExportJson: () => void;
  onClearOverlay: () => void;
  onVideo: (file: File | null) => void;
  onFxScale: (v: number) => void;
  onExport: () => void;
}

function fmtT(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export function Sidebar({
  tab,
  effects,
  selectedId,
  onSelect,
  onReplay,
  hasVideo,
  videoBusy,
  fxScale,
  videoScale,
  onVideoScale,
  animSpeed,
  onAnimSpeed,
  exporting,
  overlay,
  selCardId,
  onGlobalTheme,
  cam,
  onSetCam,
  srt,
  curT,
  onSeek,
  onImportSrt,
  onSelectCard,
  onImportJson,
  handoff, onExportJson,
  onClearOverlay,
  onVideo,
  onFxScale,
  onExport,
}: SidebarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const srtRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [camUploading, setCamUploading] = useState(false);
  // 全局口播上传:存进项目 public/demo,导出的无头浏览器才读得到
  const pickCam = async (file: File | null) => {
    if (!file) return;
    setCamUploading(true);
    try {
      const res = await fetch(`/api/upload-demo?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
      });
      const data = await res.json();
      if (data.ok) onSetCam(data.src);
      else alert(`❌ 上传失败:${data.error}`);
    } catch (e) {
      alert(`❌ 上传失败:${uploadErrText(e)}`);
    } finally {
      setCamUploading(false);
    }
  };
  // 编辑台左栏视图:卡片列表 / 字幕稿
  const [view, setView] = useState<"cards" | "srt">("cards");
  // 效果库搜索:按名字/kind/用途描述过滤
  const [fxQuery, setFxQuery] = useState("");
  // 浏览范围:空 = 全部;group:组名 = 只看这一组
  const [fxCategory, setFxCategory] = useState("");
  // 分组收起:卡全摊开要一直往下滑,收起哪几组记在本机
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("overlayStudioCollapsedGroups") || "[]");
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const saveCollapsed = (next: string[]) => {
    setCollapsedGroups(next);
    try {
      localStorage.setItem("overlayStudioCollapsedGroups", JSON.stringify(next));
    } catch {
      /* 无存储权限时仅保留会话 */
    }
  };
  const fxKw = fxQuery.trim().toLowerCase();
  // 过滤后的分组:渲染和键盘 ↑↓ 用同一份,保证「看到的顺序 = 走的顺序」
  const fxGroups = useMemo(() => {
    const kw = fxKw;
    const hit = (e: EffectDef<any>) =>
      !kw ||
      e.id.toLowerCase().includes(kw) ||
      e.name.toLowerCase().includes(kw) ||
      e.description.toLowerCase().includes(kw) ||
      // 视觉标签:让「发光」「故障」「滚动计数」这类"手感词"也能搜到,
      // 名字和描述里未必出现这些词(见 types.ts 的 VISUAL_TAGS)
      (e.tags ?? []).some((t) => t.toLowerCase().includes(kw));
    // 组名命中 = 整组保留;否则按卡过滤
    return LIB_GROUPS.filter((g) => !fxCategory || fxCategory === `group:${g.title}`)
      .map((g) => ({
        ...g,
        effects: kw && g.title.toLowerCase().includes(kw) ? g.effects : g.effects.filter(hit),
      }))
      .filter((g) => g.effects.length > 0);
  }, [fxKw, fxCategory]);
  // 搜索时不收起:那时要的是结果,不是目录
  const canCollapse = !fxKw;
  const isCollapsed = (title: string) => canCollapse && collapsedGroups.includes(title);
  const toggleGroup = (title: string) =>
    saveCollapsed(isCollapsed(title) ? collapsedGroups.filter((x) => x !== title) : [...collapsedGroups, title]);
  const allCollapsed = fxGroups.every((g) => collapsedGroups.includes(g.title));
  const fxListRef = useRef<HTMLDivElement>(null);
  // ↑ ↓ = 上一张 / 下一张卡,两个模式都能用:
  // 效果库走过滤后的卡片库,编辑台走时间轴上的卡(和点一下一样,播放头跟着跳过去)。
  // 编辑台的「字幕稿」视图不接管方向键 —— 那儿没有"卡"这个东西。
  useEffect(() => {
    const inLib = tab === "library";
    if (!inLib && view !== "cards") return;
    const ids = inLib
      ? [...new Set(fxGroups.filter((g) => !isCollapsed(g.title)).flatMap((g) => g.effects.map((x) => x.id)))] // 收起的组跳过;展示栏的卡在原分组里也有,去重
      : (overlay?.cards ?? []).map((c) => c.id);
    if (ids.length === 0) return;
    const curId = inLib ? selectedId : selCardId;
    const pick = inLib ? onSelect : onSelectCard;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const el = e.target as HTMLElement;
      // 搜索框是例外:搜完卡光标就留在框里,这时候按 ↑↓ 正是最想换卡的时刻。
      // 其余输入框(参数面板那些数字框)照旧让位 —— 那儿的 ↑↓ 是加减数值。
      const inFxSearch = el.closest(".fx-search") !== null;
      if (!inFxSearch && (el.isContentEditable || el.closest("input, textarea, select")))
        return;
      e.preventDefault(); // 否则浏览器会顺手滚一下列表
      const cur = ids.indexOf(curId ?? "");
      const next =
        cur < 0 ? 0 : Math.min(Math.max(cur + (e.key === "ArrowDown" ? 1 : -1), 0), ids.length - 1);
      if (ids[next] !== curId) pick(ids[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, view, fxGroups, overlay, selectedId, selCardId, onSelect, onSelectCard, collapsedGroups, canCollapse]);
  // 选中的卡跟着滚进可视区(键盘连按时不会走丢;鼠标点的那张本来就在屏幕上,不会乱跳)
  useEffect(() => {
    fxListRef.current?.querySelector(".fx-item.is-on")?.scrollIntoView({ block: "nearest" });
  }, [tab, view, selectedId, selCardId]);
  return (
    <aside className="panel panel-left">
      {tab === "edit" ? (
        /* 编辑台:卡片列表 / 字幕稿 双视图 */
        <>
          <div className="side-tabs">
            <button
              className={`side-tab ${view === "cards" ? "is-on" : ""}`}
              onClick={() => setView("cards")}
            >
              卡片 {overlay?.cards.length ?? 0}
            </button>
            <button
              className={`side-tab ${view === "srt" ? "is-on" : ""}`}
              onClick={() => setView("srt")}
            >
              字幕稿 {srt?.length ?? 0}
            </button>
            {view === "cards" && overlay && (
              <button className="tl-clear" onClick={onClearOverlay}>
                清空
              </button>
            )}
            {/* 换稿入口:以前只有"还没有字幕稿"那个空状态里有按钮,
                一旦导过(或自动存档恢复了)就再也找不到入口,只能靠拖文件 */}
            {view === "srt" && (
              <button className="tl-clear" onClick={() => srtRef.current?.click()}>
                {srt && srt.length > 0 ? "换 SRT" : "导入 SRT"}
              </button>
            )}
          </div>
          <input
            ref={srtRef}
            type="file"
            accept=".srt"
            style={{ display: "none" }}
            onChange={(e) => {
              onImportSrt(e.target.files?.[0] ?? null);
              if (srtRef.current) srtRef.current.value = "";
            }}
          />
          {view === "cards" ? (
            <div className="fx-list" ref={fxListRef}>
              {overlay && overlay.cards.length > 0 ? (
                overlay.cards.map((c, i) => {
                  const def = effects.find((e) => e.id === c.kind);
                  return (
                    <button
                      key={c.id}
                      className={`fx-item fx-item--row ${c.id === selCardId ? "is-on" : ""}`}
                      onClick={() => onSelectCard(c.id)}
                    >
                      <span className="fx-idx">{String(i + 1).padStart(2, "0")}</span>
                      <span className="fx-meta">
                        <span className="fx-name">
                          <i className="fx-dot" style={{ background: kindColor(c.kind) }} />
                          {def?.name ?? c.kind}
                        </span>
                        <span className="fx-desc">{def?.description.split(" · ")[0] ?? ""}</span>
                      </span>
                      <span className="fx-time">
                        {fmtT(c.start)}–{fmtT(c.end)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="fx-empty">
                  还没有卡片。
                  <br />📥 导入 Skill 生成的 JSON,
                  <br />或去 ✨ 效果库挑一张 ➕ 加进来。
                </div>
              )}
            </div>
          ) : (
            <div className="fx-list">
              {srt && srt.length > 0 ? (
                srt.map((line, i) => {
                  const now = curT >= line.start && curT < line.end;
                  const covered = overlay?.cards.some(
                    (c) => c.start < line.end && c.end > line.start,
                  );
                  return (
                    <button
                      key={i}
                      className={`srt-line ${now ? "is-now" : ""}`}
                      onClick={() => onSeek(line.start + 0.01)}
                      title={covered ? "这句已有卡覆盖" : "这句还没有卡"}
                    >
                      <span className="srt-time">
                        {fmtT(line.start)}
                        <span
                          className={`srt-dot ${covered ? "is-covered" : ""}`}
                        />
                      </span>
                      <span className="srt-text">{line.text}</span>
                    </button>
                  );
                })
              ) : (
                <div className="fx-empty">
                  还没有字幕稿。
                  <br />
                  <button
                    className="video-btn"
                    style={{ marginTop: 10 }}
                    onClick={() => srtRef.current?.click()}
                  >
                    📄 导入 SRT
                  </button>
                  <br />
                  (或直接把 .srt 拖进窗口)
                  <br />
                  点一句就跳到那个时间;
                  <br />
                  亮点 = 这句已有卡覆盖。
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="panel-title">动效预览</div>
          <div className="fx-search">
            <input
              className="ctrl-input"
              type="search"
              placeholder="🔍 搜卡片:名字 / 用途 / 手感,如 数字、引用、发光、故障"
              value={fxQuery}
              onChange={(e) => setFxQuery(e.target.value)}
            />
          </div>
          <div className="fx-tagbar">
            {(Object.keys(VISUAL_TAGS) as VisualTag[]).map((t) => (
              <button
                key={t}
                className={`fx-tag ${fxQuery.trim().toLowerCase() === t.toLowerCase() ? "is-on" : ""}`}
                title={VISUAL_TAGS[t]}
                onClick={() =>
                  setFxQuery(fxQuery.trim().toLowerCase() === t.toLowerCase() ? "" : t)
                }
              >
                {t}
              </button>
            ))}
          </div>
          <label className="fx-category">
            <span>浏览范围</span>
            <select className="ctrl-input kind-select" value={fxCategory} onChange={(e) => setFxCategory(e.target.value)}>
              <option value="">全部卡片({EFFECTS.length})</option>
              <optgroup label="按用途分类">
                {LIB_GROUPS.map((g) => (
                  <option key={g.title} value={`group:${g.title}`}>
                    {g.title}({g.effects.length})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {canCollapse && fxGroups.length > 1 && (
            <div className="fx-view-bar">
              <button type="button" onClick={() => saveCollapsed(allCollapsed ? [] : fxGroups.map((g) => g.title))}>
                {allCollapsed ? "全部展开" : "全部收起"}
              </button>
            </div>
          )}
          <div className="fx-list" ref={fxListRef}>
            {(() => {
              const kw = fxKw;
              const groups = fxGroups;
              if (groups.length === 0)
                return <div className="fx-empty">没有匹配「{fxQuery}」的卡片,换个词试试</div>;
              let idx = 0;
              return groups.map((g) => (
                <div className="fx-group" key={g.title}>
                  {canCollapse ? (
                    <button
                      type="button"
                      className="fx-group-title fx-group-toggle"
                      aria-expanded={!isCollapsed(g.title)}
                      onClick={() => toggleGroup(g.title)}
                    >
                      <span>
                        <i className="fx-group-caret">{isCollapsed(g.title) ? "▸" : "▾"}</i>
                        {g.title}
                      </span>
                      <span className="fx-group-count">{g.effects.length}</span>
                    </button>
                  ) : (
                    <div className="fx-group-title">
                      {g.title}
                      <span className="fx-group-count">{g.effects.length}</span>
                    </div>
                  )}
                  {/* 收起的组也把编号占上,展开别的组时编号不会跳 */}
                  {isCollapsed(g.title) ? ((idx += g.title === OPUS_TITLE ? 0 : g.effects.length), null) : g.effects.map((e) => {
                    // 展示栏是下面各组里的卡再列一遍,不占编号:编号 01~N 对应卡片库真实张数
                    const showcase = g.title === OPUS_TITLE;
                    if (!showcase) idx += 1;
                    return (
                      <button
                        key={e.id}
                        className={`fx-item ${e.id === selectedId ? "is-on" : ""}`}
                        onClick={() => onSelect(e.id)}
                      >
                        <span className="fx-idx">{showcase ? "★" : String(idx).padStart(2, "0")}</span>
                        <span className="fx-meta">
                          <span className="fx-name">
                            <i className="fx-dot" style={{ background: kindColor(e.id) }} />
                            {e.name}
                          </span>
                          <span className="fx-desc">{e.description}</span>
                          {e.tags?.length ? (
                            <span className="fx-tags">
                              {e.tags.map((t) => (
                                <span
                                  key={t}
                                  className={`fx-tag ${kw === t.toLowerCase() ? "is-on" : ""}`}
                                  role="button"
                                  tabIndex={-1}
                                  title={`只看「${t}」的卡`}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setFxQuery(kw === t.toLowerCase() ? "" : t);
                                  }}
                                >
                                  {t}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
            {/* 列表末尾的入口:人正在翻卡、正在找"有没有更合适的表达"的时候才遇到。
                搜索状态下不出现 —— 那时他要的是某一张具体的卡,不是版本对比。
                地址为空时整块不渲染。 */}
            {PROMO_URL && !fxQuery ? (
              <a className="fx-promo" href={PROMO_URL} target="_blank" rel="noreferrer"
                aria-label="升级 Pro（在新标签页打开官网购买页）">
                <span className="fx-promo-t">升级 Pro ↗</span>
                <span className="fx-promo-d">
                  前往官网购买专业版卡库和编排 Skill
                </span>
              </a>
            ) : null}
          </div>
        </>
      )}

      <div className="sidebar-foot">
        {/* 左栏 = 全局:这里的每一项影响整条时间轴/所有卡片 */}
        <div className="foot-kicker">全局 · 影响所有卡片</div>
        {tab === "library" && (
          <button className="play-btn" onClick={onReplay}>
            <span className="play-tri" /> 重放动画
          </button>
        )}

        {/* 全局底色:一键统一所有卡的亮/暗(单卡可在右栏再单独覆盖) */}
        {tab === "edit" && overlay && (
          <div className="ctrl scale-row">
            <div className="ctrl-head">
              <span>全局底色(所有卡片)</span>
            </div>
            <div className="seg">
              <button
                className={`seg-btn ${overlay.theme !== "light" ? "is-on" : ""}`}
                onClick={() => onGlobalTheme("dark")}
              >
                🌙 暗底
              </button>
              <button
                className={`seg-btn ${overlay.theme === "light" ? "is-on" : ""}`}
                onClick={() => onGlobalTheme("light")}
              >
                🌞 亮底
              </button>
            </div>
          </div>
        )}

        {/* 导入本地视频垫底,实时预览特效 */}
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => onVideo(e.target.files?.[0] ?? null)}
        />
        <div className="video-row">
          <button
            className="video-btn"
            disabled={videoBusy}
            onClick={() => fileRef.current?.click()}
          >
            {videoBusy ? "⏳ 上传中…" : hasVideo ? "🎬 换视频" : "🎬 导入视频"}
          </button>
          {hasVideo && (
            <button
              className="video-btn video-btn--clear"
              onClick={() => {
                onVideo(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              清除
            </button>
          )}
        </div>

        {tab === "edit" && <details className="pp-sec"><summary>AI 文件交接</summary>
          <p role="status">{handoff.aiReady ? '交接文件有更新，可以取回' :
            handoff.synced === false ? '有改动待同步' : handoff.synced ? '已同步' : '尚未同步'}</p>
          <button className="video-btn" disabled={(!overlay && !srt?.length) || handoff.busy} onClick={()=>void handoff.sync()}>同步给 AI</button>
          <button className="video-btn" disabled={handoff.busy} onClick={()=>void handoff.pull()}>取回编排</button>
          <button className="video-btn" disabled={!overlay || handoff.busy} onClick={async()=>{
            if (!confirm("完成本期并归档当前交接文件？")) return;
            const result=await handoff.archive(overlay?.projectName || '本期');
            if(result) alert('已归档到 '+result.dest);
          }}>完成本期</button>
          {handoff.note && <p role="status">{handoff.note}</p>}
        </details>}
        {/* Overlay JSON:导入(Skill 生成的时间轴)/ 导出(改完的)—— 只在编辑台出现 */}
        {tab === "edit" && (
          <>
            <input
              ref={jsonRef}
              type="file"
              accept=".json,.overlaypack,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                onImportJson(e.target.files?.[0] ?? null);
                if (jsonRef.current) jsonRef.current.value = "";
              }}
            />
            <div className="video-row">
              <button className="video-btn" onClick={() => jsonRef.current?.click()}>
                📥 打开工程
              </button>
              {overlay && (
                <button className="video-btn video-btn--clear" onClick={onExportJson}>
                  📤 导出
                </button>
              )}
            </div>
            {/* 全局口播:传一次,所有运镜卡(focus-card)导出共用,
                按时间轴自动对位,不用剪时间段 */}
            {overlay && (
              <div className="ctrl scale-row">
                <div className="ctrl-head">
                  <span>口播视频 · 运镜卡共用(需 H264)</span>
                </div>
                <input
                  ref={camRef}
                  type="file"
                  accept="video/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    pickCam(e.target.files?.[0] ?? null);
                    if (camRef.current) camRef.current.value = "";
                  }}
                />
                <div className="video-row">
                  <button
                    className="video-btn"
                    disabled={camUploading}
                    onClick={() => camRef.current?.click()}
                  >
                    {camUploading ? "⏳ 上传中…" : cam ? "🎥 换全局口播" : "🎥 传口播(一次全局用)"}
                  </button>
                  {cam && (
                    <button className="video-btn video-btn--clear" onClick={() => onSetCam("")}>
                      清除
                    </button>
                  )}
                </div>
                {cam && <div className="demo-src">{cam}</div>}
              </div>
            )}
          </>
        )}

        {/* 导出透明动效层 */}
        {(
        <div className="export-row">
          <button className="export-btn" onClick={onExport} disabled={exporting}>
            {exporting ? "⏳ 导出中…请稍候" : tab === "edit" ? "⬇ 导出整条时间轴(透明)" : "⬇ 导出单卡(透明)"}
          </button>
        </div>
        )}

        {/* 视频画面缩放:源视频带黑边/没占满画布时放大充满 */}
        {hasVideo && (
          <label className="ctrl scale-row">
            <div className="ctrl-head">
              <span>视频画面缩放</span>
              <span className="ctrl-val">{Math.round(videoScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={2}
              step={0.02}
              value={videoScale}
              onChange={(e) => onVideoScale(Number(e.target.value))}
            />
          </label>
        )}

        {/* 特效整体缩放 */}
        <label className="ctrl scale-row">
          <div className="ctrl-head">
            <span>特效整体大小</span>
            <span className="ctrl-val">{Math.round(fxScale * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.6}
            step={0.05}
            value={fxScale}
            onChange={(e) => onFxScale(Number(e.target.value))}
          />
        </label>

        {/* 动画速度:加速/放慢所有卡片动画(导出同步生效) */}
        <label className="ctrl scale-row">
          <div className="ctrl-head">
            <span>动画速度</span>
            <span className="ctrl-val">{animSpeed.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={animSpeed}
            onChange={(e) => onAnimSpeed(Number(e.target.value))}
          />
        </label>


      </div>
    </aside>
  );
}
