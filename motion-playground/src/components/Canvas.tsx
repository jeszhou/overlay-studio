import { inkVars } from "../effects/hud/accent";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { EffectDef } from "../effects/types";
import { EFFECTS } from "../effects/registry";
import { STAGE } from "../stage";
import { PZ_ORIGIN, camFrameGeom, focusCamGeom } from "../effects/hud/camGeom";
import { backdropFirst, outroFade, type OverlayCard } from "../overlay/types";
import { useEnter } from "../effects/useAnimation";
import { FxSpeedScope } from "../effects/FxSpeedScope";

/** 拖拽/滚轮时对卡片参数打补丁;cardId=null 表示单特效预览模式 */
export type NudgeFn = (cardId: string | null, patch: Record<string, number>) => void;

interface CanvasProps {
  effect: EffectDef<any>;
  params: any;
  playToken: number;
  showGuides: boolean;
  showPerson: boolean;
  videoUrl: string | null;
  fxScale: number;
  /** 时间轴模式:当前时间点应显示的卡片(null = 单特效预览模式) */
  overlayCards?: OverlayCard[] | null;
  /** 时间轴模式:当前播放头时刻(秒),注入给时间感知卡(章节条/字幕层) */
  now?: number;
  overlayTheme?: "dark" | "light";
  /** 文字可读性光晕(默认关) */
  glow?: boolean;
  /** 全局字体(doc.font):空 = 默认 */
  font?: string;
  /** 皮肤(doc.skin):hud.css 的 data-skin 令牌组,空 = 默认配色 */
  skin?: string;
  /** 风格骨架(doc.style):hud.css 的 data-style 令牌组,空 = HUD 现状 */
  docStyle?: string;
  /** 侧边色块(doc.sideColor,仅 sketch):写进 --hud-side */
  sideColor?: string;
  /** 全局文字色(doc.inkColor):盖住皮肤的 --hud-ink,次要文字同色降透明度 */
  inkColor?: string;
  /** 时间轴模式下是否静音(单特效模式恒静音,自动播放要求) */
  videoMuted?: boolean;
  /** 视频画面缩放:源视频带黑边时放大充满画布 */
  videoScale?: number;
  /** 动画速度倍率(1 = 原速) */
  animSpeed?: number;
  videoElRef?: (el: HTMLVideoElement | null) => void;
  /** 视频元数据加载后上报时长(编辑台时间轴用) */
  onVideoMeta?: (duration: number) => void;
  onNudge?: NudgeFn;
  onPickCard?: (id: string) => void;
}

/* 画布尺寸见 src/stage.ts */

/**
 * 卡片交互壳:display:contents 不产生盒子,不影响卡片自身定位;
 * 拖动 = 改 offsetX/offsetY,滚轮 = 改 scale(CSS 变量透过它继承下去)。
 */
/** 拖拽时的对齐吸附上下文:舞台元素 + 辅助线上报 */
interface SnapCtx {
  stageEl: () => HTMLDivElement | null;
  setGuides: (g: { v: number[]; h: number[] }) => void;
}

/** 吸附阈值(舞台像素) */
const SNAP_PX = 12;

function CardShell({
  cardId,
  params,
  stageScale,
  fxScale,
  animSpeed,
  past,
  outro,
  onNudge,
  onPick,
  snapCtx,
  children,
}: {
  cardId: string | null;
  params: any;
  stageScale: number;
  fxScale: number;
  animSpeed: number;
  /** 讲过变浅:时间轴过了该卡 dimAt 后压暗让位 */
  past?: boolean;
  /** 退场淡出:临近 end 的整卡不透明度(0~1),1 或缺省 = 不淡 */
  outro?: number;
  onNudge?: NudgeFn;
  onPick?: (id: string) => void;
  snapCtx?: SnapCtx;
  children: ReactNode;
}) {
  const { w: STAGE_W, h: STAGE_H } = STAGE;
  const scale = fxScale * (Number(params.scale) || 1);
  // 有效倍速 = 全局「动画速度」×该卡自己的「动画速度(此卡)」
  const speed = animSpeed * (Number(params.speed) || 1);
  return (
    <div
      style={{
        display: "contents",
        cursor: onNudge ? "grab" : undefined,
        ["--hud-scale" as string]: scale,
        ["--fx-outro" as string]: outro,
      }}
      /* 逐卡主题:这张卡自己选的亮/暗覆盖全局(未选则继承) */
      data-card-theme={(params.theme as string) || undefined}
      /* 逐卡投影:挂在这个 display:contents 的壳上,靠后代选择器落到卡根元素,
         所以每一张卡都能用,不必逐卡加参数 */
      data-past={past ? "1" : undefined}
      /* 退场淡出:同样靠后代选择器落到卡根元素,不必逐卡加参数 */
      data-outro={outro === undefined ? undefined : "1"}
      /* 讲过之后的让位方式:both 变浅+缩小(默认)/ fade 只变浅 / shrink 只缩小 */
      data-dim-mode={(params.dimMode as string) || undefined}
      onPointerDown={(e) => {
        if (!onNudge || e.button !== 0) return;
        if (cardId && onPick) onPick(cardId);
        e.preventDefault();
        // 卡内分件拖拽:卡片自己给某块标 data-drag-x/y = 该块的坐标参数名
        // (如手托展示的左右两块),拖它就只改那两个参数,不动整卡 offset。
        const partEl = (e.target as HTMLElement).closest<HTMLElement>("[data-drag-x]");
        const keyX = partEl?.dataset.dragX || "offsetX";
        const keyY = partEl?.dataset.dragY || "offsetY";
        const start = {
          x: e.clientX,
          y: e.clientY,
          ox: Number(params[keyX]) || 0,
          oy: Number(params[keyY]) || 0,
        };
        // 对齐吸附:拖动开始时量一次"被拖元素"(段头=整段容器)和其他元素的舞台坐标
        interface Box { l: number; t: number; r: number; b: number }
        let snap: { m0: Box; others: Box[] } | null = null;
        const stageEl = partEl ? null : snapCtx?.stageEl();
        if (stageEl) {
          const sr = stageEl.getBoundingClientRect();
          const k = sr.width / STAGE_W || 1;
          const toStage = (r: DOMRect): Box => ({
            l: (r.left - sr.left) / k,
            t: (r.top - sr.top) / k,
            r: (r.right - sr.left) / k,
            b: (r.bottom - sr.top) / k,
          });
          const contents = e.currentTarget as HTMLElement;
          const anchor = contents.querySelector<HTMLElement>(".hud-anchor");
          const stack = anchor?.closest<HTMLElement>(".seg-stack") ?? null;
          const isHead = !!stack && stack.firstElementChild === contents;
          const moved = isHead ? stack : anchor;
          if (moved) {
            const others: Box[] = [];
            stageEl.querySelectorAll<HTMLElement>(".hud-anchor, .seg-stack").forEach((el) => {
              if (el === moved || moved.contains(el) || el.contains(moved)) return;
              others.push(toStage(el.getBoundingClientRect()));
            });
            snap = { m0: toStage(moved.getBoundingClientRect()), others };
          }
        }
        const move = (ev: PointerEvent) => {
          let dx = (ev.clientX - start.x) / stageScale;
          let dy = (ev.clientY - start.y) / stageScale;
          const g = { v: [] as number[], h: [] as number[] };
          if (snap) {
            const { m0, others } = snap;
            // 吸附目标:左列脊柱线 x120 / 画布中线 x960 / 段头基线 y96 / 画布中线 y540 + 其他元素的边和中心
            const vCands = [120, STAGE_W / 2, ...others.flatMap((o) => [o.l, (o.l + o.r) / 2, o.r])];
            const hCands = [96, STAGE_H / 2, ...others.flatMap((o) => [o.t, (o.t + o.b) / 2, o.b])];
            const pick = (edges: number[], cands: number[]) => {
              let best: { d: number; adj: number; at: number } | null = null;
              for (const ed of edges)
                for (const c of cands) {
                  const d = Math.abs(ed - c);
                  if (d < SNAP_PX && (!best || d < best.d)) best = { d, adj: c - ed, at: c };
                }
              return best;
            };
            const bx = pick([m0.l + dx, (m0.l + m0.r) / 2 + dx, m0.r + dx], vCands);
            if (bx) {
              dx += bx.adj;
              g.v.push(bx.at);
            }
            const by = pick([m0.t + dy, (m0.t + m0.b) / 2 + dy, m0.b + dy], hCands);
            if (by) {
              dy += by.adj;
              g.h.push(by.at);
            }
          }
          snapCtx?.setGuides(g);
          onNudge(cardId, {
            [keyX]: Math.round(start.ox + dx),
            [keyY]: Math.round(start.oy + dy),
          });
        };
        const up = () => {
          snapCtx?.setGuides({ v: [], h: [] });
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onWheel={(e) => {
        if (!onNudge) return;
        const cur = Number(params.scale) || 1;
        const next = Math.min(2, Math.max(0.4, cur - Math.sign(e.deltaY) * 0.05));
        onNudge(cardId, { scale: Number(next.toFixed(2)) });
      }}
    >
      <FxSpeedScope speed={speed}>{children}</FxSpeedScope>
    </div>
  );
}

export function Canvas({
  effect,
  params,
  playToken,
  showGuides,
  showPerson,
  videoUrl,
  fxScale,
  overlayCards,
  now,
  overlayTheme,
  glow,
  font,
  skin,
  docStyle,
  sideColor,
  inkColor,
  videoMuted,
  videoScale,
  animSpeed,
  videoElRef,
  onVideoMeta,
  onNudge,
  onPickCard,
}: CanvasProps) {
  // 画布逻辑尺寸:1920×1080
  const { w: STAGE_W, h: STAGE_H } = STAGE;
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoNodeRef = useRef<HTMLVideoElement | null>(null);
  const [scale, setScale] = useState(0.5);
  // 拖拽对齐辅助线(青色虚线,吸附时出现)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const snapCtx: SnapCtx = { stageEl: () => stageRef.current, setGuides };
  // 运镜:播放后从满屏缩到左侧
  const camIn = useEnter(playToken);

  // 把 1920×1080 逻辑画布等比缩放塞进可用空间
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min(width / STAGE_W, height / STAGE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [STAGE_W, STAGE_H]);

  const side = params.side ?? "left";
  const Effect = effect.Component;
  const overlayMode = overlayCards != null;

  // 模式切换时接管视频播放:效果库=静音循环背景;编辑台=停住等播放键
  useEffect(() => {
    const v = videoNodeRef.current;
    if (!v) return;
    if (!overlayMode) {
      v.muted = true;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [overlayMode, videoUrl]);
  const isHud = overlayMode || effect.selfPosition === true;
  const theme = overlayMode ? (overlayTheme ?? "dark") : (params.theme ?? "dark");

  // 满屏运镜卡激活时,口播画面缩进对应落位框:
  // screen-demo → 角落 3:4 小窗;focus-card → 左侧圆角方框
  // 落位靠 class 的用 cls;几何由参数算出来的(cam-frame)再给一份 style,
  // 和卡片自己用的是同一个 camFrameGeom,预览和导出不会各画各的
  const PIP_KINDS: Record<string, (p: any) => { cls: string; style?: CSSProperties }> = {
    "screen-demo": (p) => ({ cls: `is-pip-${(p?.corner as string) ?? "br"}` }),
    "focus-card": (p) => ({
      cls: p?.side === "right" ? "is-pip-focus is-pip-focus-r" : "is-pip-focus",
    }),
    "punch-zoom": () => ({ cls: "is-punch-zoom" }),
    // demo-tour 的口播圆窗:和 .dtr-cam / .dtr-camring 同一份几何
    // 蹲左下角
    "demo-tour": () => ({
      cls: "is-pip-dtr",
      style: { left: 56, top: STAGE_H - 48 - 252, width: 252, height: 252, borderRadius: "50%" },
    }),
    "cam-frame": (p) => {
      const g = camFrameGeom(p ?? {});
      return {
        cls: "is-pip-frame",
        style: { left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: g.r },
      };
    },
  };
  const pipCard = overlayMode
    ? overlayCards.find((c) => c.kind in PIP_KINDS)
    : effect.id in PIP_KINDS
      ? { kind: effect.id, params }
      : null;
  const pip = overlayMode ? pipCard != null : pipCard != null && camIn;
  const pipRes = pipCard ? PIP_KINDS[pipCard.kind](pipCard.params) : null;
  const pipClass = pipRes?.cls ?? "";
  const pipStyle = pipRes?.style;

  // 会改人像落位的运镜(推近不算)
  const framingPip = pip && pipCard != null && pipCard.kind !== "punch-zoom";


  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div
        ref={stageRef}
        className={`stage${isHud ? " is-hud" : ""}${glow ? "" : " no-glow"}`}
        data-theme={theme}
        data-skin={skin || undefined}
        data-style={docStyle || undefined}
        data-pip={framingPip ? (pipCard?.kind ?? "1") : undefined}
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          ["--hud-scale" as string]: fxScale,
          ...(font ? { ["--hud-font" as string]: `"${font}"` } : {}),
          ...(sideColor ? { ["--hud-side" as string]: sideColor } : {}),
          ...inkVars(inkColor),
        }}
      >
        {/* 全屏视频垫底:导入真实口播画面实时预览 */}
        {videoUrl && (
          <video
            ref={(el) => {
              videoNodeRef.current = el;
              videoElRef?.(el);
            }}
            className={`stage-video${pip ? ` is-pip ${pipClass}` : ""}`}
            src={videoUrl}
            /* 缩角小窗时不叠加缩放,保证和落位框对齐;
               punch-zoom 把推近参数交给 CSS 变量 */
            style={
              pip
                ? pipCard?.kind === "punch-zoom"
                  ? ({
                      ["--pz-amount" as string]: pipCard.params.amount ?? 1.15,
                      ["--pz-ms" as string]: `${pipCard.params.pushMs ?? 1400}ms`,
                      transformOrigin:
                        PZ_ORIGIN[(pipCard.params.focus as string) ?? "center"],
                    } as React.CSSProperties)
                  : pipCard?.kind === "focus-card"
                    ? (() => {
                        // 口播框几何走 camGeom 里那一份,和卡自己用的是同一个函数
                        const g = focusCamGeom(pipCard.params as any);
                        return {
                          left: g.x,
                          top: g.y,
                          width: g.w,
                          height: g.h,
                          borderRadius: g.r,
                        } as React.CSSProperties;
                      })()
                    : (pipStyle as React.CSSProperties | undefined)
                : { transform: `scale(${videoScale ?? 1})` }
            }
            autoPlay={!overlayMode}
            loop={!overlayMode}
            muted={overlayMode ? (videoMuted ?? false) : true}
            playsInline
            onLoadedMetadata={(e) =>
              onVideoMeta?.((e.target as HTMLVideoElement).duration || 0)
            }
            onError={(e) => {
              const el = e.target as HTMLVideoElement;
              const err = el.error;
              // 错误码 4 有两种截然不同的原因,却长得一模一样:一是编码真的放不了,
              // 二是文件根本没读全 —— 大视频写盘要时间,上传还没落完就点播放就会撞上。
              // 以前一律赖 H.265,客户就跑去重导一遍格式,白折腾。
              // 拿浏览器自己的解码能力来分辨:它连 H.265 都放得了,那锅就不在编码上。
              const hevcOk =
                el.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "" &&
                el.canPlayType('video/mp4; codecs="hvc1.2.4.L120.B0"') !== "";
              const msg =
                err?.code !== 4
                  ? `视频加载失败(错误码 ${err?.code ?? "?"})`
                  : hevcOk
                    ? "这个视频读不出来。多半是还没传完就点了播放 —— 大文件写盘要几十秒。等一会儿刷新页面重新选一次;要是刷新后还这样,换个视频试试。"
                    : "浏览器不支持这个视频的编码(常见于 H.265/HEVC)。用剪映导出时选 H.264,或换 Chrome 试试。";
              alert(`❌ ${msg}`);
            }}
          />
        )}

        {/* 没有真实视频时的人物占位:提醒别把卡放到脸上 */}
        {showPerson && !videoUrl && (
          <div className="person">
            <div className="person-body" />
            <span className="person-tag">人物安全区</span>
          </div>
        )}

        {/* 参考线:安全区边界 */}
        {showGuides && (
          <>
            <div className="guide guide-safe" />
            <div className="guide guide-slot guide-slot-left" />
            <div className="guide guide-slot guide-slot-right" />
          </>
        )}

        {/* 拖拽对齐辅助线:吸附命中时出现(左列脊柱/中线/其他卡的边和中心) */}
        {guides.v.map((x, i) => (
          <div key={`agv-${i}`} className="align-guide align-guide-v" style={{ left: x }} />
        ))}
        {guides.h.map((y, i) => (
          <div key={`agh-${i}`} className="align-guide align-guide-h" style={{ top: y }} />
        ))}

        {/* 时间轴模式:渲染当前时间点的所有卡片(同 seg 的进左列自动顺排容器) */}
        {overlayMode
          ? (() => {
              const renderOne = (card: OverlayCard) => {
                const def = EFFECTS.find((e) => e.id === card.kind);
                if (!def) return null;
                const C = def.Component;
                const cardSide = (card.params.side as string) ?? "left";
                // __t/__start/__end:时间感知卡据此高亮当前章、切字幕行、卡内翻页
                const cardParams: Record<string, unknown> = {
                  ...card.params,
                  __t: now,
                  __start: card.start,
                  __end: card.end,
                };
                // demo-tour 口播圆窗:预览时没填 camSrc 就用导入的口播视频(与导出的全局口播注入对齐)
                if (card.kind === "demo-tour" && videoUrl && !cardParams.camSrc)
                  cardParams.camSrc = videoUrl;
                // 退场淡出:卡片走到 end 就被卸掉,先在这最后一小段把它淡走
                const outro = now === undefined ? 1 : outroFade(now, card);
                return (
                  <CardShell
                    key={card.id}
                    cardId={card.id}
                    params={card.params}
                    stageScale={scale}
                    fxScale={fxScale}
                    animSpeed={animSpeed ?? 1}
                    past={(Number(card.params.dimAt) || 0) > 0 && (now ?? 0) >= Number(card.params.dimAt)}
                    outro={outro < 1 ? outro : undefined}
                    onNudge={onNudge}
                    onPick={onPickCard}
                    snapCtx={snapCtx}
                  >
                    {def.selfPosition ? (
                      <C params={cardParams} playToken={1} />
                    ) : (
                      <div className={`slot slot-${cardSide}`}>
                        <C params={cardParams} playToken={1} />
                      </div>
                    )}
                  </CardShell>
                );
              };
              // 分组:同 seg 的卡进一个竖排容器;容器位置 = 段头(首成员)的 offset,拖段头即拖整段
              const out: ReactNode[] = [];
              const seen = new Set<string>();
              const ordered = backdropFirst(overlayCards);
              for (const card of ordered) {
                if (!card.seg) {
                  out.push(renderOne(card));
                  continue;
                }
                if (seen.has(card.seg)) continue;
                seen.add(card.seg);
                const members = ordered.filter((c) => c.seg === card.seg);
                const head = members[0];
                out.push(
                  <div
                    key={`seg-${card.seg}`}
                    className="seg-stack"
                    style={{
                      transform: `translate(${Number(head.params.offsetX) || 0}px, ${Number(head.params.offsetY) || 0}px)`,
                    }}
                  >
                    {members.map(renderOne)}
                  </div>,
                );
              }
              return out;
            })()
          : /* 单特效预览:HUD 族自锚定;极简族落进左右槽 */
            (() => {
              // demo-tour 口播圆窗:预览时没填 camSrc 就用导入的口播视频(与导出的全局口播注入对齐)
              const previewParams =
                effect.id === "demo-tour" && videoUrl && !(params as Record<string, unknown>).camSrc
                  ? { ...params, camSrc: videoUrl }
                  : params;
              return (
                <CardShell
                  cardId={null}
                  params={params}
                  stageScale={scale}
                  fxScale={fxScale}
                  animSpeed={animSpeed ?? 1}
                  onNudge={onNudge}
                  snapCtx={snapCtx}
                >
                  {effect.selfPosition ? (
                    <Effect params={previewParams} playToken={playToken} />
                  ) : (
                    <div className={`slot slot-${side}`}>
                      <Effect params={previewParams} playToken={playToken} />
                    </div>
                  )}
                </CardShell>
              );
            })()}
      </div>
    </div>
  );
}
