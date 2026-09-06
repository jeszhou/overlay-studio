import { useEffect, useMemo, useRef, useState } from "react";
import { EFFECTS } from "./effects/registry";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { ParamsPanel } from "./components/ParamsPanel";
import { TimelineBar } from "./components/TimelineBar";
import {
  TopBar,
  FORMS,
  PALETTES,
  LEGACY_SKIN_MAP,
  type StudioTab,
} from "./components/TopBar";
import { parseOverlay, type OverlayCard, type OverlayDoc } from "./overlay/types";
import { parseOverlayAutosave } from "./overlay/autosave";
import type { StageAspect } from "./stage";
import { parseSrt, type SrtLine } from "./overlay/srt";
import { lintOverlay, mergeLintConfig, type LintConfig, type LintIssue } from "./overlay/lint";
import { uploadErrText } from "./uploadErr";
import lintDefaults from "../lint-rules.default.json";

// 个人阈值(lint-rules.local.json,gitignore):存在就叠加覆盖公共默认
const lintLocalModules = import.meta.glob("../lint-rules.local.json", { eager: true }) as Record<
  string,
  { default: Partial<LintConfig> }
>;
const LINT_CFG = mergeLintConfig(
  lintDefaults as Partial<LintConfig>,
  Object.values(lintLocalModules)[0]?.default,
);
import "./effects/hud/hud.css";
import "./App.css";

/** 新卡默认多长:整段演示类的卡要 15 秒才够看完一轮,其余 5 秒。
    右栏那颗「加到 x:xx,时长 n 秒」按钮和真正的插入逻辑共用这一个数,
    避免文案说 5 秒、插进去却是别的。 */
function addSecFor(kind: string) {
  return ["screen-demo", "cam-pan", "focus-card"].includes(kind) ? 15 : 5;
}

export default function App() {
  // 明牌双模式:编辑台(视频+时间轴,像剪映)/ 效果库(挑卡调样式)
  const [tab, setTab] = useState<StudioTab>("edit");
  const [selectedId, setSelectedId] = useState(EFFECTS[0].id);
  // 每个动效各自保存一份参数,切换不丢
  const [paramsById, setParamsById] = useState<Record<string, any>>(() =>
    Object.fromEntries(EFFECTS.map((e) => [e.id, { ...e.defaults }])),
  );
  const [playToken, setPlayToken] = useState(0);
  const [showGuides, setShowGuides] = useState(true);
  const [showPerson, setShowPerson] = useState(true);
  // 导入的本地视频(object URL):编辑台=停在首帧等播放;效果库=静音循环当背景
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // 视频落盘期间锁住导入按钮。以前这里没有任何状态:传一条几百 MB 的口播要几十秒,
  // 界面全程毫无反应(画面里的视频还先被清掉了),换谁都会再点一次 —— 而同一个素材
  // 传第二遍正好是把后台搞死的那个操作。别的三个上传入口早就有这个锁,只有它漏了。
  const [videoBusy, setVideoBusy] = useState(false);
  // 本地服务在不在。页面是加载进浏览器内存的,服务停了它照样显示、按钮照样能点,
  // 只有真去请求后台才露馅 —— 用户完全没办法自己看出来。所以定时探一下,明着说。
  const [online, setOnline] = useState(true);
  const [videoDur, setVideoDur] = useState(0);
  // 编辑台的视频声音(效果库永远静音)
  const [muted, setMuted] = useState(false);
  // 视频画面缩放:视频自带黑边/比例不满时,放大充满画布(1 = 原始)
  const [videoScale, setVideoScale] = useState(1);
  // 动画速度倍率:加速/放慢所有卡片动画(导出同步生效)
  const [animSpeed, setAnimSpeed] = useState(1);
  // 特效整体缩放(1 = 100%)
  const [fxScale, setFxScale] = useState(1);
  // 导出透明动效层
  const [exporting, setExporting] = useState(false);
  // 导出进度(每秒轮询 /api/export-status)
  const [exportProg, setExportProg] = useState<{
    stage: string;
    frame: number;
    total: number;
    startedAt: number;
    framesAt: number;
  } | null>(null);

  // ---- 编辑台:时间轴 ----
  const [overlay, setOverlay] = useState<OverlayDoc | null>(null);
  const [curT, setCurT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selCardId, setSelCardId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ---- 学习闭环:记住本次导入的「AI 初选」,导出时连同终选一起落盘 ----
  const originRef = useRef<OverlayDoc | null>(null);

  // ---- 检查器:导入 JSON 时自动跑,只提醒不阻断;忽略标记写进卡片随 JSON 持久化 ----
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [lintCollapsed, setLintCollapsed] = useState(false);

  // ---- 字幕稿(SRT):点句跳转 / 标记覆盖情况 ----
  const [srt, setSrt] = useState<SrtLine[] | null>(null);

  // ---- 自动保存:编排随手存进浏览器,下次打开自动恢复 ----
  const AUTOSAVE_KEY = "overlayStudioAutosave";
  // 「学一下」是这套工具里唯一一个用户发现不了的能力 —— 不主动说,它就等于不存在。
  // 每次导出都会落一份 review-log(初选 vs 终选),但用户不说那三个字就没人去读。
  // 第 1 次和第 3 次导出各提醒一次:第 1 次让他知道有这回事,第 3 次他已经攒够改动了。
  const WELCOME_KEY = "overlayStudioWelcomed";
  const LEARN_TIP_KEY = "overlayStudioLearnTipCount";
  const maybeShowLearnTip = () => {
    let n = 1;
    try {
      n = Number(localStorage.getItem(LEARN_TIP_KEY) || 0) + 1;
      localStorage.setItem(LEARN_TIP_KEY, String(n));
    } catch {
      return; // 隐私模式等禁用 localStorage:不提醒总比每次都弹强
    }
    if (n !== 1 && n !== 3) return;
    setTimeout(() => {
      alert(
        "💡 刚才这份「AI 排的 vs 你改完的」已经存下来了。\n\n" +
          "对 AI 助手说一句「学一下」,它会对比两版、把你改了两次以上的地方问你确认,\n" +
          "写进 skill 目录的《我的偏好.md》和《经验规则.md》。下一期就按你的排法生成。\n\n" +
          "跑几期之后,那份偏好表里的取值就全是你自己的了 —— \n" +
          "出厂的《我的偏好.default.md》是中性的,风格得你自己长出来。",
      );
    }, 400); // 让下载/导出的动作先走完,别打断
  };

  // ---- 外壳外观:两根正交的轴,都挂在 <html> 上 ----
  //   风格 data-form    = 形状骨架(App.css「风格骨架」一节)
  //   配色 data-palette = 颜色取值表(index.css)
  // 只换编辑台外壳,画布/卡片/导出画面完全不受影响。
  const FORM_KEY = "overlayStudioForm";
  const PALETTE_KEY = "overlayStudioPalette";
  const LEGACY_SKIN_KEY = "overlayStudioSkin"; // 单轴时代的旧键,读到就迁移
  // 老用户开机时把旧皮肤 id 拆成两轴;拆完删掉旧键,只会跑这一次
  const restoreLook = () => {
    try {
      const legacy = localStorage.getItem(LEGACY_SKIN_KEY);
      if (legacy !== null) {
        const hit = LEGACY_SKIN_MAP[legacy] ?? { form: "", palette: "" };
        localStorage.setItem(FORM_KEY, hit.form);
        localStorage.setItem(PALETTE_KEY, hit.palette);
        localStorage.removeItem(LEGACY_SKIN_KEY);
        return hit;
      }
      const form = localStorage.getItem(FORM_KEY) ?? "";
      const palette = localStorage.getItem(PALETTE_KEY) ?? "";
      // 存档里是已下架的取值就回落默认
      return {
        form: FORMS.some((f) => f.id === form) ? form : "",
        palette: PALETTES.some((c) => c.id === palette) ? palette : "",
      };
    } catch {
      return { form: "", palette: "" };
    }
  };
  const [look] = useState(restoreLook);
  const [form, setForm] = useState<string>(look.form);
  const [palette, setPalette] = useState<string>(look.palette);
  // 换风格 = 连它的「原配」配色一起换上。
  // 曾经在这里加过「你手动挑过配色就不换」的判断,结果是:只要挑过一次配色,
  // 自动匹配就再也不触发,功能等于不存在。换风格本来就是「整套换掉」的动作,
  // 想要别的配色,换完再点一下配色下拉就行。
  const pickForm = (id: string) => {
    setForm(id);
    setPalette(FORMS.find((f) => f.id === id)?.mate ?? "");
  };

  useEffect(() => {
    const el = document.documentElement;
    if (form) el.dataset.form = form;
    else delete el.dataset.form;
    if (palette) el.dataset.palette = palette;
    else delete el.dataset.palette;
    try {
      localStorage.setItem(FORM_KEY, form);
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      // 隐私模式:外观只在本次会话生效
    }
  }, [form, palette]);

  // 首次挂载:恢复上次的编排 + 字幕稿 + 视频
  // 首次打开引导:什么都没有的新用户,先把 60 秒示例端到面前。
  // 空画布 + 一排陌生按钮是最劝退的第一屏;示例一载入,时间轴/画布/参数面板一眼就懂。
  // 只在「没有任何存档」时提一次(WELCOME_KEY 记一次性标记,和「学一下」提示同一套做法)。
  const loadDemoRef = useRef<() => void>(() => {});
  useEffect(() => {
    // 标记要等真正弹过再写:StrictMode 下 effect 会挂载两次,先写标记的话,
    // 第一次写完、第二次看到标记退出,而第一次的定时器又被 cleanup 清掉 —— 谁都弹不出来
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem(WELCOME_KEY)) return;
        localStorage.setItem(WELCOME_KEY, "1");
      } catch {
        return; // 隐私模式:不打扰
      }
      if (
        window.confirm(
          "👋 第一次来?\n\n先载入一套 60 秒的示例编排吧 —— 按空格播放,点画布上的卡片改参数,\n时间轴、拖拽、导出都能直接上手试。\n\n(顶栏「🎬 示例」随时能再载入;取消则从空白开始)",
        )
      )
        loadDemoRef.current();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 心跳:每 10 秒探一次后台(切到别的标签页时不探,省得白费请求)。
  // 回到这个标签页立刻补探一次 —— 「昨天的页面被浏览器恢复了、服务其实没起」
  // 正是最常见的那一幕,这时候第一时间告诉他,别等他点了导入才失败。
  useEffect(() => {
    // 连着两次探不到才算掉线。一次就报会误伤:改 vite.config.ts 会让服务自己重启一下,
    // 导出跑满 CPU 时也可能慢一拍 —— 那几秒里弹一条「服务已停止」比不弹更让人慌。
    let miss = 0;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/export-status", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        miss = 0;
        setOnline(true);
      } catch {
        miss += 1;
        if (miss >= 2) setOnline(false);
      }
    };
    ping();
    const id = window.setInterval(ping, 10000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const restored = parseOverlayAutosave(raw);
      if (restored.error || !restored.doc) {
        // 不把坏对象放回 state，也不覆盖原始 localStorage；用户仍可从浏览器存储中找回原文。
        console.warn("忽略无法恢复的自动存档:", restored.error);
        return;
      }
      const { doc: migrated, dropped } = restored;
      if (dropped?.length)
        console.warn("恢复上次编排时跳过了认不出的卡:", dropped.map((d) => `${d.kind}×${d.n}`).join(", "));
      setOverlay(migrated);
      originRef.current = restored.origin;
      if (restored.srt?.length) setSrt(restored.srt);
      setSelCardId(migrated.cards[0]?.id ?? null);
      // 视频:落盘过的走 /_media/ 真实路径,刷新后直接恢复,不用重新导入。
      // 先探一下还在不在(用户可能清过 public/_media),不在就当没存过,别留个坏的 <video>。
      const restoredVideoUrl = restored.videoUrl;
      if (restoredVideoUrl) {
        fetch(restoredVideoUrl, { method: "HEAD" })
          .then((r) => r.ok && setVideoUrl(restoredVideoUrl))
          .catch(() => {});
      }
    } catch {
      /* 坏数据直接忽略,不打扰 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 落盘过的预览视频自动当全局「口播视频」:运镜卡导出时要烤的,和预览里那条
  // 本来就是同一条。放在 effect 里而不是导入回调里,是因为「先导视频后导编排」
  // 和「先导编排后导视频」两种顺序都要覆盖到。已经手填过的不动。
  // 用户点过「清除」就不再往回填。以前的判断只看 `!overlay.cam`,清除把 cam 置空 →
  // 条件重新成立 → 立刻又填回去,那个「清除」按钮等于一个摆设。
  // 记的是「用户主动清过」这件事本身,不是「哪条视频挂过」:后者在刷新(存档里 cam 已带值,
  // 记号没机会写)和换编排(视频没变、记号还在,新编排永远挂不上)两种情况下都会失效。
  // 换视频 / 导入新编排 / 载入示例时把记号清掉:那是一次新的开始,该挂还得挂。
  const camClearedRef = useRef(false);
  useEffect(() => {
    if (!overlay || overlay.cam || !videoUrl?.startsWith("/_media/")) return;
    if (camClearedRef.current) return;
    setOverlay((o) => (o && !o.cam ? { ...o, cam: videoUrl } : o));
  }, [overlay, videoUrl]);

  // 任何改动后 800ms 自动落盘;删空卡片则清掉存档
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (!overlay) return;
        if (overlay.cards.length === 0) {
          localStorage.removeItem(AUTOSAVE_KEY);
          return;
        }
        localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify({
            overlay,
            origin: originRef.current,
            srt,
            // 只存落盘过的真实路径;blob 地址刷新即失效,存了也是坏的
            videoUrl: videoUrl?.startsWith("/_media/") ? videoUrl : undefined,
            savedAt: new Date().toISOString(),
          }),
        );
      } catch {
        /* 存储异常不打扰编辑 */
      }
    }, 800);
    return () => clearTimeout(id);
    // videoUrl 也要在依赖里:少了它,「清除视频」之后不会重新落盘,存档里留着旧地址,
    // 刷新一次视频又回来了 —— 用户看到的就是「清了个寂寞」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, srt, videoUrl]);

  // ---- 撤销/重做(⌘Z / ⇧⌘Z):存 overlay + 字幕稿 快照 ----
  // 字幕稿也要进快照:「清空」会把它一起清掉,而弹窗承诺了能 ⌘Z 撤销 ——
  // 只记 overlay 的话,撤销回来卡片在、字幕稿没了,自动存档还会顺手把最后一份也覆盖掉。
  type Snap = { overlay: OverlayDoc | null; srt: SrtLine[] | null };
  const snapRef = useRef<Snap>({ overlay: null, srt: null });
  snapRef.current = { overlay, srt };
  const undoRef = useRef<Snap[]>([]);
  const redoRef = useRef<Snap[]>([]);
  const lastEditRef = useRef(0);

  /**
   * 每次改动前调用:把当前 overlay 压进撤销栈。
   * 400ms 内的连续改动(拖拽/滑块)合并成同一步;force = 独立操作(加卡/导入/换卡)必压。
   */
  const pushHistory = (force = false) => {
    const now = performance.now();
    const coalesce = !force && now - lastEditRef.current < 400;
    lastEditRef.current = now;
    if (coalesce) return;
    undoRef.current.push(structuredClone(snapRef.current));
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
  };

  const applySnap = (s: Snap) => {
    setOverlay(s.overlay);
    setSrt(s.srt);
  };
  const undo = () => {
    if (!undoRef.current.length) return;
    redoRef.current.push(structuredClone(snapRef.current));
    applySnap(undoRef.current.pop()!);
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    undoRef.current.push(structuredClone(snapRef.current));
    applySnap(redoRef.current.pop()!);
  };

  // 编辑台总时长 = max(视频时长, 最后一张卡结束)
  const duration = useMemo(() => {
    const cardsEnd = overlay ? Math.max(...overlay.cards.map((c) => c.end), 0) : 0;
    return Math.max(cardsEnd, videoDur);
  }, [overlay, videoDur]);

  // 编排体检:密度(张/分钟)+ 同屏峰值,顶栏一眼看节奏够不够紧
  const overlayStats = useMemo(() => {
    if (!overlay || overlay.cards.length === 0) return null;
    const evs = overlay.cards
      .flatMap((c) => [[c.start, 1], [c.end, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let peak = 0;
    for (const [, d] of evs) {
      cur += d;
      if (cur > peak) peak = cur;
    }
    const span = Math.max(...overlay.cards.map((c) => c.end));
    return { peak, perMin: overlay.cards.length / Math.max(span / 60, 0.1) };
  }, [overlay]);

  // 时钟(仅编辑台):有视频跟视频走(rAF 读 currentTime),没视频自走
  useEffect(() => {
    if (tab !== "edit" || !playing) return;
    const v = videoRef.current;
    let raf = 0;
    let last = performance.now();
    // 播放被浏览器拒绝时(极少见)老实退回暂停,不让 UI 假装在播
    if (v) v.play().catch(() => setPlaying(false));
    const tick = (now: number) => {
      if (v) {
        setCurT(v.currentTime);
        if (v.ended || v.currentTime >= duration) {
          setPlaying(false);
          return;
        }
      } else {
        const dt = (now - last) / 1000;
        last = now;
        let done = false;
        setCurT((t) => {
          const nt = t + dt;
          if (nt >= duration) {
            done = true;
            return duration;
          }
          return nt;
        });
        if (done) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (v) v.pause();
    };
  }, [tab, playing, duration]);

  /**
   * 拖播放头之后,把**卡内录屏**也拉回正确位置。
   *
   * 卡内 <video> 是 autoPlay 自己走的,只在挂载时起播 —— 顺着播不会错,
   * 但一旦拖动播放头(卡片重新挂载 / 或本来就在播),它还停在"从挂载算起"的位置,
   * 时间轴显示 45s、画面其实是录屏的头几秒。导出端是按时间轴逐帧对位的,
   * 于是**编辑台里看到的和导出的对不上**(实际碰到过)。
   * 拖完拉一把,两边就一致了。
   */
  const alignCardVideos = (t: number) => {
    document.querySelectorAll<HTMLVideoElement>("video[data-fx-video]").forEach((v) => {
      const d = v.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const ts = Number(v.dataset.tStart) || 0;
      const clip = Number(v.dataset.fxClip) || 0;
      const rate = Number(v.dataset.fxRate) || 1;
      let want = clip + Math.max(0, t - ts) * rate;
      // 短素材循环:超出的部分按"素材可播长度"取模,和导出端同一套算法
      if (v.hasAttribute("data-fx-loop") && want > d) {
        const span = Math.max(d - clip, 0.1);
        want = clip + ((want - clip) % span);
      }
      const to = Math.min(Math.max(want, 0), d - 0.05);
      if (Math.abs(v.currentTime - to) > 0.2) v.currentTime = to;
    });
  };

  const seek = (t: number) => {
    setCurT(t);
    const v = videoRef.current;
    if (v) v.currentTime = t;
    // 刚跳过去的那一帧卡片可能还没挂上/元数据没到,补一次
    requestAnimationFrame(() => alignCardVideos(t));
    setTimeout(() => alignCardVideos(t), 260);
  };

  // 从效果库切回编辑台:把视频画面对回时间轴当前位置(效果库里它自己在循环)
  useEffect(() => {
    if (tab === "edit" && videoRef.current) {
      videoRef.current.currentTime = curTRef.current;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 最新播放状态存 ref,给全局快捷键读(避免每帧重挂监听)
  const curTRef = useRef(0);
  curTRef.current = curT;
  const selCardIdRef = useRef<string | null>(null);
  selCardIdRef.current = selCardId;
  const deleteRef = useRef<(id: string) => void>(() => {});
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const durRef = useRef(0);
  durRef.current = duration;

  // 全局快捷键(永远最高优先级;只在打字输入框里让位):
  // 空格 = 编辑台播放/暂停,效果库重放动画;← → = 快退/快进 0.5s,按住 Shift = 3s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      const typing =
        el.isContentEditable ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (tag === "INPUT" &&
          ["text", "number", "search"].includes((el as HTMLInputElement).type));
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        // ⌘Z 撤销 / ⇧⌘Z 重做(时间轴改动)
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (
        (e.code === "Backspace" || e.code === "Delete") &&
        tabRef.current === "edit" &&
        selCardIdRef.current
      ) {
        // Delete = 删除选中的卡
        e.preventDefault();
        deleteRef.current(selCardIdRef.current);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (tabRef.current === "edit") {
          if (durRef.current > 0) setPlaying((p) => !p);
        } else {
          setPlayToken((t) => t + 1);
        }
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        // 两个模式都可用:效果库里用它挪 ➕ 的插入位置
        e.preventDefault();
        const step = (e.shiftKey ? 3 : 0.5) * (e.code === "ArrowLeft" ? -1 : 1);
        const nt = Math.min(Math.max(0, curTRef.current + step), durRef.current);
        curTRef.current = nt; // 立刻同步,连按不丢步
        setCurT(nt);
        if (videoRef.current) videoRef.current.currentTime = nt;
        requestAnimationFrame(() => alignCardVideos(nt));   // ←/→ 步进也要拉卡内录屏
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleImportJson = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const { doc, error, dropped } = parseOverlay(text);
    if (error || !doc) {
      alert(`❌ JSON 导入失败:${error}`);
      return;
    }
    // 和「载入示例」一样先问一句。这个入口以前不问:拖错一个 JSON 进窗口,当前编排立刻被换掉,
    // 800ms 后自动存档也跟着被盖 —— ⌘Z 能救,刷新一次就救不回了。
    if (overlay?.cards.length && !confirm("导入这份编排会替换当前编排(可撤销),继续吗?")) return;
    pushHistory(true);
    camClearedRef.current = false; // 新编排:口播视频该挂还得挂
    setOverlay(doc);
    originRef.current = structuredClone(doc); // AI 初选快照,学习闭环用
    setSelCardId(doc.cards[0]?.id ?? null);
    setTab("edit");
    seek(0);
    setPlaying(false);
    // 自动体检:只提醒不阻断导入。
    // 认不出的卡已经被跳过了,在这儿补一条 error —— 跳过必须看得见,
    // 否则用户只会觉得「导进来好像少了点东西」却说不上少了什么。
    setLintIssues([
      ...(dropped ?? []).map((d) => ({
        level: "error" as const,
        rule: "unknown-kind",
        message: `跳过了 ${d.n} 张「${d.kind}」——  认不出这种卡,其余卡已正常导入。注意:再导出 JSON 时这几张不会带回去,原文件留好`,
      })),
      ...lintOverlay(doc, LINT_CFG, { duration: durRef.current || undefined }),
    ]);
    setLintCollapsed(false);
  };

  /** 检查面板「忽略」:有卡的问题把规则写进那张卡(用户主动决定,随 JSON 保存);
   *  没卡的问题(如 quiet-gap)只从本次列表移除 */
  const handleLintIgnore = (issue: LintIssue) => {
    if (!issue.cardId || !overlay) {
      setLintIssues((arr) => arr.filter((x) => x !== issue));
      return;
    }
    const next: OverlayDoc = {
      ...overlay,
      cards: overlay.cards.map((c) => {
        if (c.id !== issue.cardId || c.lintOff === true) return c;
        const off = Array.from(
          new Set([...(Array.isArray(c.lintOff) ? c.lintOff : []), issue.rule]),
        );
        return { ...c, lintOff: off };
      }),
    };
    pushHistory(true);
    setOverlay(next);
    setLintIssues(lintOverlay(next, LINT_CFG, { duration: durRef.current || undefined }));
  };

  /** 检查面板「定位」:有卡选中那张卡并跳到进场时刻;只有时间点(空白段)就直接跳时间 */
  const handleLintLocate = (issue: LintIssue) => {
    const c = issue.cardId ? overlay?.cards.find((x) => x.id === issue.cardId) : undefined;
    if (!c && issue.at == null) return;
    setTab("edit");
    if (c) {
      setSelCardId(c.id);
      seek(c.start + 0.01);
    } else {
      seek(issue.at! + 0.01);
    }
  };

  /** 载入内置演示编排(public/demo/):示例 SRT + 示例 JSON,不需要自己的视频 */
  const handleLoadDemo = async () => {
    if (overlay?.cards.length && !confirm("载入示例会替换当前编排(可撤销),继续吗?")) return;
    try {
      const [jsonText, srtText] = await Promise.all([
        fetch("/demo/demo-overlay.json").then((r) => r.text()),
        fetch("/demo/demo.srt").then((r) => r.text()),
      ]);
      const { doc, error, dropped } = parseOverlay(jsonText);
      if (error || !doc) {
        alert(`❌ 示例载入失败:${error}`);
        return;
      }
      // 内置示例是按本档生成的,理论上不该有认不出的卡。真出现了就是发行版做漏了 ——
      // 留这行 warn 当信号,别让示例悄悄少几张卡还没人发现。
      if (dropped?.length)
        console.warn("[示例] 跳过了认不出的卡:", dropped.map((d) => `${d.kind}×${d.n}`).join(", "));
      const lines = parseSrt(srtText);
      pushHistory(true);
      camClearedRef.current = false;
      setSrt(lines.length ? lines : null);
      setOverlay(doc);
      originRef.current = structuredClone(doc);
      setSelCardId(doc.cards[0]?.id ?? null);
      setTab("edit");
      seek(0);
      setPlaying(false);
      setLintIssues(lintOverlay(doc, LINT_CFG, { duration: durRef.current || undefined }));
      setLintCollapsed(false);
    } catch (e) {
      alert(`❌ 示例载入失败:${e}`);
    }
  };

  const handleImportSrt = async (file: File | null) => {
    if (!file) return;
    const lines = parseSrt(await file.text());
    if (!lines.length) {
      alert("❌ SRT 解析失败:没读到任何字幕条。");
      return;
    }
    setSrt(lines);
    // 已有编排且还没有字幕层卡:自动生成一张常驻双语字幕卡(中文先就位,
    // 英文和 *关键词* 由生成器或你在右栏字幕表里补)
    if (overlay && !overlay.cards.some((c) => c.kind === "caption-track")) {
      const def = EFFECTS.find((e) => e.id === "caption-track");
      const end = Math.ceil(Math.max(...lines.map((l) => l.end)));
      const linesText = lines
        .map(
          (l) =>
            `${l.start.toFixed(2)}|${l.end.toFixed(2)}|${l.text
              .replace(/\|/g, "/")
              .replace(/\s+/g, " ")
              .trim()}`,
        )
        .join("\n");
      pushHistory(true);
      setOverlay({
        ...overlay,
        cards: [
          ...overlay.cards,
          {
            id: `caption-track-${overlay.cards.length + 1}`,
            kind: "caption-track",
            start: 0,
            end,
            params: { ...(def?.defaults ?? {}), lines: linesText },
          },
        ],
      });
    }
    setTab("edit");
  };

  const handleExportJson = () => {
    if (!overlay) return;
    const blob = new Blob([JSON.stringify(overlay, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "overlay.json";
    a.click();
    URL.revokeObjectURL(a.href);
    // 学习闭环:AI 初选 + 用户终选 一起落盘(失败不打扰导出)
    fetch("/api/review-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedAt: new Date().toISOString(),
        origin: originRef.current,
        final: overlay,
      }),
    }).catch(() => {});
    maybeShowLearnTip();
  };

  const handleClearOverlay = () => {
    // 「清空」清的是这一条编排:卡片 + 字幕稿 + 自动存档。以前只清卡片,字幕稿原样留着,
    // 下一条片子的卡就长在上一条的字幕上 —— 这也是「清除不干净」的一份。
    // 导入的视频不在此列,它有自己的「清除」按钮,不该被这里顺手带走。
    if (!confirm("清空这条编排?\n\n卡片和字幕稿都会清掉(导入的视频不受影响)。\n可以用 ⌘Z 撤销。"))
      return;
    pushHistory(true);
    localStorage.removeItem(AUTOSAVE_KEY);
    setOverlay(null);
    setSrt(null);
    setPlaying(false);
    setSelCardId(null);
    seek(0);
  };

  loadDemoRef.current = handleLoadDemo;

  // 当前时间点应显示的卡片(编辑台)
  // 提前 0.05s 挂载:进场动画要等 2 帧才触发,提前量让"可见的出现"正卡在 start 上
  const activeCards = useMemo(
    () =>
      overlay
        ? overlay.cards.filter((c) => curT >= c.start - 0.05 && curT < c.end)
        : [],
    [overlay, curT],
  );

  const selCard = overlay?.cards.find((c) => c.id === selCardId) ?? null;
  // 「第几层」只在和它同时出现的卡里数 —— 全局第几张对观众没意义,同屏谁压谁才有
  const layerInfo = (() => {
    if (!overlay || !selCard) return undefined;
    const co = overlay.cards.filter(
      (c) => c.start < selCard.end && c.end > selCard.start,
    );
    return { index: co.findIndex((c) => c.id === selCard.id) + 1, total: co.length };
  })();

  // 编辑选中卡片的参数(编辑台)
  // 一次改一批参数(预设应用走这里):必须用函数式 setOverlay。
  // 以前是 setOverlay({...overlay, …}),循环里连着调 N 次会 N 次都从同一份旧
  // overlay 出发 —— 只有最后一个 key 生效,应用预设看着就像"点了没反应"。
  const patchCardParams = (patch: Record<string, unknown>) => {
    if (!selCardId) return;
    pushHistory();
    setOverlay((o) =>
      o
        ? {
            ...o,
            cards: o.cards.map((c) =>
              c.id === selCardId ? { ...c, params: { ...c.params, ...patch } } : c,
            ),
          }
        : o,
    );
  };
  const handleCardParamChange = (key: string, value: unknown) => {
    patchCardParams({ [key]: value });
  };

  // 更换选中卡片的特效类型(时间/落位保留,参数回到新卡默认值)
  const handleCardKindChange = (kind: string) => {
    if (!overlay || !selCardId) return;
    if (!EFFECTS.some((e) => e.id === kind)) return;
    pushHistory(true);
    setOverlay({
      ...overlay,
      cards: overlay.cards.map((c) =>
        c.id === selCardId
          ? {
              ...c,
              kind,
              params: { ...(EFFECTS.find((e) => e.id === kind)?.defaults ?? {}) },
            }
          : c,
      ),
    });
  };

  // 全局底色:一键统一所有卡片的亮/暗(覆盖每张卡的单独设置,可 ⌘Z 撤销)
  const handleGlobalTheme = (theme: "dark" | "light") => {
    if (!overlay) return;
    pushHistory(true);
    setOverlay({
      ...overlay,
      theme,
      cards: overlay.cards.map((c) => ({ ...c, params: { ...c.params, theme } })),
    });
  };

  // 删除卡片(时间轴选中后 Delete / 右栏按钮)
  const handleDeleteCard = (id: string) => {
    pushHistory(true);
    setOverlay((o) =>
      o ? { ...o, cards: o.cards.filter((c) => c.id !== id) } : o,
    );
    setSelCardId((cur) => (cur === id ? null : cur));
  };
  deleteRef.current = handleDeleteCard; // 给全局快捷键(Delete)用

  // 时间轴色块拖拽:直接写回某张卡的起止时间
  const handleCardTimes = (id: string, start: number, end: number) => {
    pushHistory();
    setOverlay((o) =>
      o
        ? {
            ...o,
            cards: o.cards.map((c) => (c.id === id ? { ...c, start, end } : c)),
          }
        : o,
    );
  };

  /**
   * 叠放:把选中卡片在 cards 数组里挪位置。
   * 画布是按数组顺序画的(backdropFirst 只把底幕类提到最前),**排在后面的压在上面**。
   * 只在"和它时间上有重叠"的卡之间挪 —— 跟不同时出现的卡换先后没有任何视觉意义,
   * 白白把数组搅乱。挪不动(上面/下面没有重叠的卡了)就原样返回。
   */
  const handleCardLayer = (dir: "up" | "down" | "top" | "bottom") => {
    if (!overlay || !selCardId) return;
    const cards = overlay.cards.slice();
    const i = cards.findIndex((c) => c.id === selCardId);
    if (i < 0) return;
    const me = cards[i];
    const hit = (c: OverlayCard) => c.id !== me.id && c.start < me.end && c.end > me.start;
    let j = -1;
    if (dir === "up") for (let k = i + 1; k < cards.length; k++) { if (hit(cards[k])) { j = k; break; } }
    if (dir === "top") for (let k = cards.length - 1; k > i; k--) { if (hit(cards[k])) { j = k; break; } }
    if (dir === "down") for (let k = i - 1; k >= 0; k--) { if (hit(cards[k])) { j = k; break; } }
    if (dir === "bottom") for (let k = 0; k < i; k++) { if (hit(cards[k])) { j = k; break; } }
    if (j < 0) return;
    pushHistory();
    cards.splice(i, 1);
    // 往上挪:插到目标后面(删掉自己后目标退了一格,插在 j 正好就是它后面)
    // 往下挪:插到目标前面(目标索引比自己小,删除不影响它,插在 j 就是它前面)
    cards.splice(j, 0, me);
    setOverlay({ ...overlay, cards });
  };

  // 编辑选中卡片的出现/消失时间(秒)
  const handleCardTimeChange = (key: "start" | "end", value: number) => {
    if (!overlay || !selCardId || !Number.isFinite(value)) return;
    pushHistory();
    setOverlay({
      ...overlay,
      cards: overlay.cards.map((c) => {
        if (c.id !== selCardId) return c;
        const next = { ...c, [key]: value };
        return next.end > next.start ? next : c;
      }),
    });
  };

  // 画布直接拖拽/滚轮:给卡片参数打补丁(不触发重放)
  const handleNudge = (cardId: string | null, patch: Record<string, number>) => {
    if (cardId) {
      pushHistory();
      setOverlay((o) =>
        o
          ? {
              ...o,
              cards: o.cards.map((c) =>
                c.id === cardId ? { ...c, params: { ...c.params, ...patch } } : c,
              ),
            }
          : o,
      );
    } else {
      setParamsById((prev) => ({
        ...prev,
        [selectedId]: { ...prev[selectedId], ...patch },
      }));
    }
  };

  const handleGlobalAspect = (aspect: StageAspect) => {
    if (!overlay) return;
    pushHistory(true);
    setOverlay({ ...overlay, aspect });
  };

  // 效果库 → 时间轴:把当前效果(带调好的参数)插到当前时刻
  const handleAddToTimeline = () => {
    const start = Math.round(curTRef.current * 10) / 10;
    const baseCards = overlay?.cards ?? [];
    let n = baseCards.length + 1;
    while (baseCards.some((c) => c.id === `card-${n}`)) n++;
    const card = {
      id: `card-${n}`,
      kind: selectedId,
      start,
      // 整段演示类的卡默认给足 15 秒,其他卡 5 秒
      end: start + addSecFor(selectedId),
      params: { ...paramsById[selectedId] },
    };
    pushHistory(true);
    setOverlay((o) =>
      o
        ? { ...o, cards: [...o.cards, card].sort((a, b) => a.start - b.start) }
        : { version: 1 as const, theme: paramsById[selectedId]?.theme, cards: [card] },
    );
    setSelCardId(card.id);
    // 以前这里 setTab("edit") 把人甩回编辑台:点一下整个界面就变了,是最容易
    // 让人失去方向的一种反馈,想连着加三张卡也得来回切。时间轴两个模式都常驻,
    // 新卡在轨道上直接看得见,不用换页确认。
  };

  const handleExport = async () => {
    if (exporting) return;
    if (tab === "edit" && (!overlay || overlay.cards.length === 0)) {
      alert("时间轴上还没有卡片:先 📥 导入 JSON,或去 ✨ 效果库 ➕ 加入卡片。");
      return;
    }
    setExporting(true);
    // 完成时发系统通知(切去别的应用也能收到);先申请权限
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission().catch(() => {});
    // 每秒轮询导出进度,驱动右下角进度浮窗
    const poll = window.setInterval(async () => {
      try {
        const r = await fetch("/api/export-status");
        const p = await r.json();
        if (p.running) setExportProg(p);
      } catch {
        /* 服务器重启等瞬时失败,忽略 */
      }
    }, 1000);
    // 学习闭环:定稿导出时也落一份「初选 vs 终选」日志
    if (tab === "edit" && overlay) {
      fetch("/api/review-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedAt: new Date().toISOString(),
          origin: originRef.current,
          final: overlay,
        }),
      }).catch(() => {});
      maybeShowLearnTip();
    }
    try {
      // 导出帧率:相机/手机拍的素材是 NTSC 29.97fps(30000/1001),动效层按 30 导会
      // 越走越快 —— 166s 累计漂移约 5 帧,片尾能看出动效和口型对不上
      const EXPORT_FPS = 29.97;
      // 导出整条 overlay(时长 = 最后一张卡结束 + 0.5s 尾巴)
      // 尾巴是留给末尾音效收干净的,别用 ceil 取整 —— 28.0s 的片子会被抬到 29s,
      // 白白多出整整一秒空帧(卡片走到 end 就卸掉了,尾巴里什么都没有)。
      if (!overlay) return; const body = { mode: "timeline", doc: overlay, scale: fxScale, speed: animSpeed, fps: EXPORT_FPS, duration: Math.max(...overlay.cards.map((c) => c.end)) + 0.5 };
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // 线上试玩版没有导出后端(逐帧渲染要本地无头 Chrome + ffmpeg):给友好提示,不甩报错。
      // 判断依据只能是「返回的不是 JSON」—— 静态托管会回 HTML(404 或 SPA 回退)。
      // 不能用 !res.ok:本地导出失败时服务端返回的是 500 + JSON,里面带着真正的
      // 失败原因,当成"线上版"会把这条信息直接丢掉,客户和你都不知道到底为什么失败。
      if (!(res.headers.get("content-type") ?? "").includes("json")) {
        alert(
          "🌐 当前是线上试玩版,不支持导出。\n\n导出透明 MOV 需要在本地运行:\n  git clone 仓库 → npm install → npm run dev\n\n完整步骤见 README「快速开始」。",
        );
        return;
      }
      const data = await res.json();
      if (data.ok) {
        if ("Notification" in window && Notification.permission === "granted")
          new Notification("✅ 动效层导出完成", {
            body: data.mov ? `MOV 已就绪:${String(data.mov).split("/").pop()}` : "PNG 序列已就绪",
          });
        if (!data.mov) {
          alert(
            "⚠️ 只导出了 PNG 序列,没有生成 MOV。\n\n" +
              "原因:本机没有装 ffmpeg(合成透明视频要用它)。\n\n" +
              "装好之后重新导出即可:\n" +
              "  macOS:   brew install ffmpeg\n" +
              "  Windows: winget install --id Gyan.FFmpeg -e\n\n" +
              `PNG 序列已经在这儿了:\n${data.dir}`,
          );
          return;
        }
        const files = [
          data.mov ? `🎞 透明 MOV(剪映直接拖):\n${data.mov}` : null,
          data.webm ? `🌐 透明 WebM(小体积):\n${data.webm}` : null,
          `🖼 PNG 序列 ${data.frames} 帧 @ ${data.fps}fps`,
        ]
          .filter(Boolean)
          .join("\n\n");
        alert(`✅ 导出完成!\n\n${files}\n\n文件夹:\n${data.dir}`);
      } else {
        const raw = String(data.error ?? "未知错误");
        const i = raw.lastIndexOf("【导出失败原因】");
        alert(`❌ 导出失败\n\n${i === -1 ? raw : raw.slice(i)}`);
      }
    } catch (e) {
      alert(`❌ 导出失败:${e}`);
    } finally {
      window.clearInterval(poll);
      setExporting(false);
      setExportProg(null);
    }
  };

  const handleVideo = async (file: File | null) => {
    if (videoBusy) return;
    camClearedRef.current = false; // 换了视频,之前那次「清除」不作数
    // 记住换之前的主视频:下面落盘成功后,如果全局「口播视频」(overlay.cam)就是它,要跟着换。
    // 以前不换 —— 自动挂载只在 cam 为空时生效,换视频后 cam 还指着上一条:预览里运镜卡
    // 圆窗放的是新视频(预览用 videoUrl),导出烤进去的却是旧的(导出用 doc.cam),而且没有任何提示。
    // 只在「cam 等于旧主视频」时换:用户在侧栏手动选过别的口播视频,那是他的选择,不动。
    const prevUrl = videoUrl;
    setVideoUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    if (!file) {
      setVideoDur(0);
      setPlaying(false);
      return;
    }
    setPlaying(false);
    setVideoBusy(true);
    // 先落盘换一个真实路径:刷新后能自动恢复,无头 Chrome 导出时也读得到。
    // 线上试玩版没有这个后端,退回 blob 地址 —— 那种情况下刷新仍需重新导入。
    try {
      const r = await fetch("/api/media", {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name) },
        body: file,
      });
      // 非 2xx 也要把响应体读出来:后台写盘失败时会认真回一句原因(500 + JSON),
      // 以前 `r.ok ? … : null` 直接把它扔了,页面一声不吭退回 blob,用户以为导入成功了
      const d = await r.json().catch(() => null);
      if (d?.ok && d.url) {
        setVideoUrl(d.url);
        setOverlay((o) => (o && o.cam && o.cam === prevUrl ? { ...o, cam: d.url } : o));
        return;
      }
      alert(
        `❌ 视频落盘失败:${d?.error ?? `HTTP ${r.status}`}\n\n` +
          "先用临时地址预览;这种情况下刷新要重新导入,导出时也带不上口播。",
      );
    } catch (e) {
      // 本地服务没在跑的时候会走到这儿。以前这里一声不吭地退回 blob,用户不知道后台已经
      // 掉线,只会觉得「刷新一次素材就没了」。和其他三个上传入口一样弹一句人话;
      // 顶部横幅交给心跳去判(它要连续两次探不到才报,这里一次失败就翻旗会闪一下又消失)。
      alert(`❌ 视频落盘失败:${uploadErrText(e)}`);
    } finally {
      setVideoBusy(false);
    }
    setVideoUrl(URL.createObjectURL(file));
  };

  // 效果库当前效果。selectedId 一直来自 EFFECTS,理论上找得到,
  // 但别再用 ! 假装 —— 真找不到就退回第一张,不要往下传 undefined。
  const effect = useMemo(
    () => EFFECTS.find((e) => e.id === selectedId) ?? EFFECTS[0],
    [selectedId],
  );
  const params = paramsById[selectedId];

  const handleParamChange = (key: string, value: unknown) => {
    setParamsById((prev) => ({
      ...prev,
      [selectedId]: { ...prev[selectedId], [key]: value },
    }));
    setPlayToken((t) => t + 1); // 改参数即重放,便于观察
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setPlayToken((t) => t + 1);
  };

  // 参数面板:编辑台改选中的卡,效果库改当前效果
  const inEdit = tab === "edit";
  const panelEffect =
    // 这里以前的 ! 是「整页白屏」的根因:编排里只要有一张本档没有的卡,
    // 查出来就是 undefined。现在照实传下去,由 ParamsPanel 说清楚是哪张。
    inEdit && selCard ? EFFECTS.find((e) => e.id === selCard.kind) : effect;
  const panelParams = inEdit && selCard ? selCard.params : params;
  const panelOnChange = inEdit && selCard ? handleCardParamChange : handleParamChange;
  // 批量改(预设):编辑台走一次 setOverlay,单卡预览合成一次 setParamsById
  const panelOnChangeMany = (patch: Record<string, unknown>) => {
    if (inEdit && selCard) return patchCardParams(patch);
    setParamsById((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], ...patch } }));
    setPlayToken((t) => t + 1);
  };

  return (
    <div
      className="app"
      /* 拖文件进窗口即导入:视频 → 垫底预览,JSON → 时间轴 */
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (!f) {
          alert("❌ 没有读到文件——请从「访达」把文件本体拖进来(从应用里直接拖可能拖不出文件)。");
          return;
        }
        if (f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name)) {
          handleVideo(f);
        } else if (f.type === "application/json" || /\.json$/i.test(f.name)) {
          handleImportJson(f);
        } else if (/\.srt$/i.test(f.name)) {
          handleImportSrt(f);
        } else {
          alert(`❌ 不认识的文件类型:${f.name}(支持视频 mp4/mov/webm、overlay JSON 和 SRT 字幕)`);
        }
      }}
    >
      {!online && (
        <div className="offline-bar">
          ⚠️ 本地服务已停止 —— 这个页面还开着,但导入、上传、导出都不会成功。
          回到启动时那个终端窗口,重新运行 <code>npm run dev</code>(或再双击一次启动器),然后刷新本页。
        </div>
      )}
      <TopBar
        tab={tab}
        onTab={setTab}
        curT={curT}
        duration={duration}
        playing={playing}
        shown={activeCards.length}
        total={overlay?.cards.length ?? 0}
        stats={overlayStats}
        selCardId={inEdit ? selCardId : null}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        onPlayPause={() => durRef.current > 0 && setPlaying((p) => !p)}
        onReset={() => {
          setPlaying(false);
          seek(0);
        }}
        onImportJson={handleImportJson}
        onLoadDemo={handleLoadDemo}
        effectName={effect.name}
        onReplay={() => setPlayToken((t) => t + 1)}
        exporting={exporting}
        hasVideo={videoUrl !== null}
        videoBusy={videoBusy}
        onVideo={handleVideo}
        onExport={handleExport}
        form={form}
        onForm={pickForm}
        palette={palette}
        onPalette={setPalette}
        hasDoc={!!overlay}
        font={overlay?.font ?? ""}
        onFont={(f) => {
          pushHistory(true);
          setOverlay((o) => (o ? { ...o, font: f || undefined } : o));
        }}
        glow={!!overlay?.glow}
        onToggleGlow={() => {
          pushHistory(true);
          setOverlay((o) => (o ? { ...o, glow: !o.glow } : o));
        }}
        inkColor={overlay?.inkColor ?? ""}
        onInkColor={(c) => {
          pushHistory(true);
          setOverlay((o) => (o ? { ...o, inkColor: c || undefined } : o));
        }}
        onUnifyAccent={(accent) => {
          // 批量改写:把每张卡的 accent 参数直接改掉(不是盖一层),
          // 改完各卡参数面板显示的就是新值,之后还能单张调回去。force 压一步撤销。
          pushHistory(true);
          setOverlay((o) =>
            o
              ? {
                  ...o,
                  cards: o.cards.map((c) =>
                    "accent" in (c.params ?? {})
                      ? { ...c, params: { ...c.params, accent } }
                      : c,
                  ),
                }
              : o,
          );
        }}
        showGuides={showGuides}
        onToggleGuides={() => setShowGuides((v) => !v)}
        showPerson={showPerson}
        onTogglePerson={() => setShowPerson((v) => !v)}
      />
      <div className="app-body">
      <Sidebar
        tab={tab}
        effects={EFFECTS}
        selectedId={selectedId}
        onSelect={handleSelect}
        onReplay={() => setPlayToken((t) => t + 1)}
        hasVideo={videoUrl !== null}
        fxScale={fxScale}
        videoScale={videoScale}
        onVideoScale={setVideoScale}
        animSpeed={animSpeed}
        onAnimSpeed={setAnimSpeed}
        exporting={exporting}
        overlay={overlay}
        selCardId={selCardId}
        onGlobalTheme={handleGlobalTheme}
        onGlobalAspect={handleGlobalAspect}
        skin={overlay?.skin ?? ""}
        onSkin={(s) => setOverlay((o) => (o ? { ...o, skin: s || undefined } : o))}
        docStyle={overlay?.style ?? ""}
        onDocStyle={(s) => setOverlay((o) => (o ? { ...o, style: s || undefined } : o))}
        sideColor={overlay?.sideColor ?? ""}
        onSideColor={(c) => setOverlay((o) => (o ? { ...o, sideColor: c || undefined } : o))}
        cam={overlay?.cam ?? ""}
        onSetCam={(src) => {
          camClearedRef.current = !src; // 清空 = 用户主动清过,自动挂载别再填回来
          setOverlay((o) => (o ? { ...o, cam: src || undefined } : o));
        }}
        srt={srt}
        curT={curT}
        onSeek={seek}
        onImportSrt={handleImportSrt}
        onSelectCard={(id) => {
          setSelCardId(id);
          const c = overlay?.cards.find((x) => x.id === id);
          if (c) seek(c.start + 0.01);
        }}
        onImportJson={handleImportJson}
        onExportJson={handleExportJson}
        onClearOverlay={handleClearOverlay}
        videoBusy={videoBusy}
        onVideo={handleVideo}
        onFxScale={setFxScale}
        onExport={handleExport}
      />

      <main className="stage-col">
        <Canvas
          effect={effect}
          params={params}
          playToken={playToken}
          showGuides={showGuides}
          showPerson={showPerson}
          videoUrl={videoUrl}
          fxScale={fxScale}
          aspect={overlay?.aspect}
          overlayCards={inEdit ? activeCards : null}
          now={curT}
          overlayTheme={overlay?.theme}
          glow={overlay?.glow ?? false}
          font={overlay?.font}
          skin={overlay?.skin}
          docStyle={overlay?.style}
          sideColor={overlay?.sideColor}
          inkColor={overlay?.inkColor}
          videoMuted={muted}
          videoScale={videoScale}
          animSpeed={animSpeed}
          videoElRef={(el) => (videoRef.current = el)}
          onVideoMeta={setVideoDur}
          onNudge={handleNudge}
          onPickCard={setSelCardId}
        />
        {/* 时间线两个模式都常驻:效果库里它标记 ➕ 的插入位置 */}
        <TimelineBar
          duration={duration}
          t={curT}
          cards={overlay?.cards ?? []}
          selectedId={selCardId}
          shown={activeCards.length}
          onSeek={seek}
          onSelect={setSelCardId}
          onTimes={handleCardTimes}
        />
      </main>

      <ParamsPanel
        effect={panelEffect}
        params={panelParams}
        onChange={panelOnChange}
        onChangeMany={panelOnChangeMany}
        card={inEdit ? selCard : null}
        editMode={inEdit}
        onLayer={handleCardLayer}
        layer={layerInfo}
        onTimeChange={handleCardTimeChange}
        onKindChange={handleCardKindChange}
        onDelete={handleDeleteCard}
        onAddToTimeline={handleAddToTimeline}
        addAt={curT}
        addSec={addSecFor(selectedId)}
      />
      </div>

      {/* 导出进度浮窗(右下角):渲染帧数 + 预计剩余 + 合成阶段 */}
      {exporting && <ExportProgress prog={exportProg} />}

      {/* 检查器浮窗(左下角):导入 JSON 自动体检的结果,只提醒不阻断 */}
      {lintIssues.length > 0 && (
        <LintPanel
          issues={lintIssues}
          collapsed={lintCollapsed}
          onToggle={() => setLintCollapsed((v) => !v)}
          onClose={() => setLintIssues([])}
          onLocate={handleLintLocate}
          onIgnore={handleLintIgnore}
        />
      )}
    </div>
  );
}

function LintPanel({
  issues,
  collapsed,
  onToggle,
  onClose,
  onLocate,
  onIgnore,
}: {
  issues: LintIssue[];
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLocate: (i: LintIssue) => void;
  onIgnore: (i: LintIssue) => void;
}) {
  const errors = issues.filter((i) => i.level === "error").length;
  return (
    <div className="lint-panel">
      <div className="lint-head" onClick={onToggle}>
        <span>
          🔍 体检:{errors > 0 && <b className="lint-err-count">{errors} 个必修</b>}
          {errors > 0 && issues.length > errors && " · "}
          {issues.length > errors && `${issues.length - errors} 个建议`}
        </span>
        <span className="lint-head-btns">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {collapsed ? "展开" : "收起"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            ✕
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="lint-list">
          {issues.map((i, idx) => (
            <div key={idx} className={`lint-item lint-${i.level}`}>
              <span className="lint-msg">
                {i.level === "error" ? "❌" : "⚠️"} {i.message}
              </span>
              <span className="lint-btns">
                {(i.cardId || i.at != null) && <button onClick={() => onLocate(i)}>定位</button>}
                <button title={i.cardId ? "写进这张卡,以后不再提醒" : "本次不再显示"} onClick={() => onIgnore(i)}>
                  忽略
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportProgress({
  prog,
}: {
  prog: { stage: string; frame: number; total: number; startedAt: number; framesAt: number } | null;
}) {
  let pct = 2;
  let text = "准备中(启动渲染器)…";
  if (prog) {
    if (prog.stage === "extract") {
      text = "预处理素材:把卡片里的视频抽成帧(长录屏要几分钟)…";
    } else if (prog.stage === "frames" && prog.total > 0) {
      // 渲染帧占进度的前 80%,后面是合成/混音
      pct = Math.max(2, Math.round((prog.frame / prog.total) * 80));
      // ⚠️ 只按「逐帧渲染开跑之后」的耗时算(framesAt,不是 startedAt)。
      // 用任务启动时刻的话,前面抽帧/启浏览器那几分钟会被摊进每帧耗时,
      // 第一次报数(第 30 帧)能报出几十分钟,然后一路往下掉 —— 纯属吓人。
      const elapsed = (Date.now() - (prog.framesAt || prog.startedAt)) / 1000;
      const eta =
        prog.frame > 0
          ? Math.round((elapsed / prog.frame) * (prog.total - prog.frame))
          : 0;
      const fmt =
        eta >= 60 ? `${Math.floor(eta / 60)} 分 ${eta % 60} 秒` : `${eta} 秒`;
      text = `渲染帧 ${prog.frame}/${prog.total} · 预计还需 ${fmt}`;
    } else if (prog.stage === "mov") {
      pct = 84;
      text = "合成透明 MOV(长视频这步要几分钟)…";
    } else if (prog.stage === "webm") {
      pct = 93;
      text = "合成 WebM 小体积版…";
    } else if (prog.stage === "sfx") {
      pct = 98;
      text = "把音效混进 MOV…";
    }
  }
  return (
    <div className="export-prog">
      <div className="export-prog-head">
        <span>🎞 导出中</span>
        <b>{pct}%</b>
      </div>
      <div className="export-prog-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="export-prog-sub">{text}</div>
    </div>
  );
}
