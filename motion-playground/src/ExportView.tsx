import { inkVars } from "./effects/hud/accent";
import { useEffect, useState } from "react";
import "./fonts"; // 自定义字体注册:导出端也要有 @font-face,成片字体才和预览一致
import { EFFECTS } from "./effects/registry";
import { FxSpeedScope } from "./effects/FxSpeedScope";
import { backdropFirst, outroFade, parseOverlay, type OverlayDoc } from "./overlay/types";
import { STAGE } from "./stage";
import "./effects/hud/hud.css";
import "./App.css";

/**
 * 导出专用视图(?export=1)
 * 只渲染动效本体:透明背景、无视频、无人物、无参考线、无UI。
 * 两种模式:
 *  - timeline:整条时间轴(&mode=timeline&doc=<overlay json>),卡片按 start/end 出现
 * 动效在导出脚本调用 window.__startExport() 后才开始,
 * 无头浏览器用「虚拟时间」从 t=0 逐帧精确推进。
 */

function renderCard(
  card: {
    id: string;
    kind: string;
    start?: number;
    end?: number;
    params: Record<string, unknown>;
  },
  fxScale: number,
  jobSpeed: number,
  t?: number,
  cam?: string,
) {
  const def = EFFECTS.find((e) => e.id === card.kind);
  if (!def) return null;
  const C = def.Component;
  const side = (card.params.side as string) ?? "left";
  // __start:让卡内视频(screen-demo 录屏)知道自己相对整条时间轴的起点
  // __t/__end:让时间感知卡(章节条/字幕层)拿到时间轴当前秒和自己的终点
  const params: Record<string, unknown> = { ...card.params, __start: card.start ?? 0, __t: t, __end: card.end };
  // 运镜卡的口播:单卡没传就用全局口播(doc.cam),按时间轴自动对位
  if (cam && !params.camSrc) params.camSrc = cam;
  // 每卡缩放/倍速 × 全局值,和 Studio 预览一致
  const scale = fxScale * (Number(card.params.scale) || 1);
  const speed = jobSpeed * (Number(card.params.speed) || 1);
  // 讲过变浅:时间轴过了 dimAt 秒后整卡压暗让位(仍在场,不退场)
  const dimAt = Number(card.params.dimAt) || 0;
  const past = dimAt > 0 && t !== undefined && t >= dimAt;
  // 退场淡出:卡片走到 end 就被卸掉,先在这最后一小段把它淡走(与 Studio 预览一致)
  const outro =
    t === undefined || card.end === undefined
      ? 1
      : outroFade(t, { start: card.start ?? 0, end: card.end });
  return (
    <div
      key={card.id}
      style={{
        display: "contents",
        ["--hud-scale" as string]: scale,
        ["--fx-outro" as string]: outro < 1 ? outro : undefined,
      }}
      /* 逐卡主题:与 Studio 预览一致 */
      data-card-theme={(card.params.theme as string) || undefined}
      data-past={past ? "1" : undefined}
      data-outro={outro < 1 ? "1" : undefined}
      data-dim-mode={(card.params.dimMode as string) || undefined}
    >
      <FxSpeedScope speed={speed}>
        {def.selfPosition ? (
          <C params={params} playToken={1} />
        ) : (
          <div className={`slot slot-${side}`}>
            <C params={params} playToken={1} />
          </div>
        )}
      </FxSpeedScope>
    </div>
  );
}

const stageStyle = (scale: number) => {
  const { w, h } = STAGE;
  return {
    position: "fixed",
    left: 0,
    top: 0,
    width: w,
    height: h,
    ["--hud-scale" as string]: scale,
  } as React.CSSProperties;
};

/** 整条时间轴导出:虚拟时钟推进,卡片按时间窗挂载/卸载 */
function TimelineExport({ doc, scale, speed }: { doc: OverlayDoc; scale: number; speed: number }) {
  const [t, setT] = useState(-1);

  useEffect(() => {
    (window as unknown as { __startExport: () => void }).__startExport = () => {
      const t0 = performance.now();
      let raf0: number | null = null;
      const tick = (rafTs: number) => {
        const p = performance.now();
        // 实测 CSS 动画钟(rAF 时间戳)相对虚拟时钟的快慢,写进 __fxClockRate,
        // 各卡的 FxSpeedScope 每帧用它校正 CSS 动画/过渡的 playbackRate
        if (raf0 === null) raf0 = rafTs;
        else if (rafTs - raf0 > 50) {
          const r = (p - t0) / (rafTs - raf0);
          if (Number.isFinite(r) && r > 0.01 && r < 100)
            (window as unknown as { __fxClockRate?: number }).__fxClockRate = r;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setT(0);
    };
    // 时间轴时间由导出脚本每帧显式下发:页面时钟(performance.now)在帧图
    // 加载时会被 Chrome 的虚拟时间偷偷快进(实测约 +10ms/帧),不可信——
    // 用它推 t 会让视频段之后的所有卡片提前进场
    (window as unknown as { __setExportT?: (sec: number) => void }).__setExportT = (sec) => {
      // 卡内计时钩子的权威时钟(见 useAnimation.clockNow)
      (window as unknown as { __fxExportMs?: number }).__fxExportMs = sec * 1000;
      setT(sec);
    };
  }, []);

  // 提前 0.05s 挂载:进场动画等 2 帧才触发,让"可见的出现"卡在 start 上(与 Studio 预览一致)
  const active = backdropFirst(
    t < 0 ? [] : doc.cards.filter((c) => t >= c.start - 0.05 && t < c.end),
  );
  // 同 seg 的卡进左列自动顺排容器(与 Canvas 预览一致);容器位置 = 段头(首成员)offset
  const rendered: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (const c of active) {
    if (!c.seg) {
      rendered.push(renderCard(c, scale, speed, t, doc.cam));
      continue;
    }
    if (seen.has(c.seg)) continue;
    seen.add(c.seg);
    const members = active.filter((m) => m.seg === c.seg);
    const head = members[0];
    rendered.push(
      <div
        key={`seg-${c.seg}`}
        className="seg-stack"
        style={{
          transform: `translate(${Number(head.params.offsetX) || 0}px, ${Number(head.params.offsetY) || 0}px)`,
        }}
      >
        {members.map((m) => renderCard(m, scale, speed, t, doc.cam))}
      </div>,
    );
  }
  return (
      <div
        className={`stage is-hud is-export${doc.glow ? "" : " no-glow"}`}
        data-theme={doc.theme ?? "dark"}
        data-skin={doc.skin || undefined}
        data-style={doc.style || undefined}
        style={{
          ...stageStyle(scale),
          ...(doc.font ? { ["--hud-font" as string]: `"${doc.font}"` } : {}),
          ...(doc.sideColor ? { ["--hud-side" as string]: doc.sideColor } : {}),
          ...inkVars(doc.inkColor),
        }}
      >
        {rendered}
      </div>
  );
}


export function ExportView() {
  const q = new URLSearchParams(location.search);
  useEffect(() => {
    document.documentElement.classList.add("export-mode");
    // 导出脚本每帧调用:把卡内视频画面对位到该帧时刻。
    // 虚拟时钟下 Chrome 媒体管线完全冻结(<video> 加载/seek 永远不完成),
    // 所以导出脚本先用 ffmpeg 把视频预抽成 JPEG 帧序列(清单注入 __VID_FRAMES),
    // 这里只换 img.src——普通图片加载在真实时间里照常落地,不受虚拟时钟影响
    (window as any).__seekVideos = (t: number) => {
      const man = ((window as any).__VID_FRAMES ?? {}) as Record<
        string,
        { dir: string; fps: number; count: number; dur: number }
      >;
      document.querySelectorAll<HTMLImageElement>("img[data-fx-vidimg]").forEach((im) => {
        const m = man[im.getAttribute("data-fx-src") ?? ""];
        if (!m || !m.count) return;
        const start = parseFloat(im.getAttribute("data-t-start") || "0");
        // 倍速:窗口过了 1 秒,素材要往前走 rate 秒
        const rate = parseFloat(im.getAttribute("data-fx-rate") || "1") || 1;
        let target = Math.max(0, (t - start) * rate);
        // 循环短素材(证据小窗):按素材时长取模,播完从头再来
        if (im.dataset.fxLoop && m.dur > 0) target = target % m.dur;
        const idx = Math.min(m.count - 1, Math.floor(target * m.fps));
        const want = `${m.dir}/f_${String(idx + 1).padStart(5, "0")}.jpg`;
        if (im.getAttribute("src") !== want) im.setAttribute("src", want);
      });
    };
    // 换 src 后图片需要几毫秒真实时间落地:导出脚本轮询到 0 再截图
    (window as any).__pendingVidFrames = () =>
      Array.from(document.querySelectorAll<HTMLImageElement>("img[data-fx-vidimg]")).filter(
        (im) => im.getAttribute("src") && (!im.complete || !im.naturalWidth),
      ).length;
  }, []);

  const speed = Number(q.get("spd") ?? 1) || 1;
  if (q.get("mode") === "timeline") {
    // 编排优先读导出脚本注入的 __EXPORT_DOC(整份编排走 URL 会超长 → HTTP 431);
    // URL 的 ?doc= 仅作短编排/手工调试的兜底
    const injected = (window as unknown as { __EXPORT_DOC?: string }).__EXPORT_DOC;
    const { doc, error } = parseOverlay(injected ?? q.get("doc") ?? "{}");
    if (error || !doc) return <div style={{ color: "red" }}>{error}</div>;
    // 烤入人物的卡:这几段导出后在剪映里要盖掉原始口播轨,否则会看到两层人。
    // 判断依据是卡有没有 camSrc 控件(不写死卡名,以后新加的卡自动算进来)。
    // 时间段挂到 window,导出脚本读了在成品旁边生成一份「合成说明」——
    // 用户打开 exports/output/ 拿 MOV 的那一刻,正好是他要去剪映的前一秒。
    (window as unknown as { __CAM_SEGMENTS?: unknown }).__CAM_SEGMENTS = doc.cards
      .filter((c) => {
        const def = EFFECTS.find((e) => e.id === c.kind);
        const takesCam = def?.controls?.some((x) => (x as { key?: string }).key === "camSrc");
        return takesCam && (c.params.camSrc || doc.cam);
      })
      .map((c) => ({ kind: c.kind, start: c.start, end: c.end }));
    return <TimelineExport doc={doc} scale={Number(q.get("fx") ?? 1)} speed={speed} />;
  }
  return <div style={{ color: "red" }}>unknown export mode</div>;
}
