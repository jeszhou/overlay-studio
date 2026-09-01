import type { CSSProperties } from "react";
import { imgRetry } from "./imgRetry";

/** 导出模式下视频不自动播,由导出脚本逐帧 seek */
const IS_EXPORT =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("export") === "1";

export const isVideoSrc = (src: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(src);

/**
 * 卡内视频通用槽:预览用 <video> 静音循环自动播;
 * 导出用 <img> 逐帧换预抽好的帧图(虚拟时钟下 Chrome 媒体管线完全冻结,
 * <video> 永远解不出画面——导出脚本先用 ffmpeg 把视频抽成 JPEG 序列,
 * __seekVideos 按时间轴换 img.src,图片加载不受虚拟时钟影响)。
 * loop = 短素材循环:导出按素材时长取模对位(data-fx-loop)。
 */
export function FxVideo({
  src,
  className,
  tStart,
  clipStart,
  loop,
  rate,
  style,
}: {
  src: string;
  className?: string;
  tStart?: number;
  /** 从素材的第几秒开始播(同一条视频切出不同片段时用) */
  clipStart?: number;
  loop?: boolean;
  /** 播放倍速:1.5 / 2 …(长录屏塞进短窗口用);导出侧按倍速换算帧号 */
  rate?: number;
  style?: CSSProperties;
}) {
  const clip = clipStart && clipStart > 0 ? clipStart : 0;
  const spd = rate && rate > 0 ? rate : 1;
  if (IS_EXPORT) {
    return (
      <img
        className={className}
        data-fx-vidimg
        data-fx-src={src}
        /* 片段偏移:把卡片起点往前挪 clip 秒,导出取帧就落在素材的 clip 秒处 */
        data-t-start={(tStart ?? 0) - clip / spd}
        {...(spd !== 1 ? { "data-fx-rate": String(spd) } : {})}
        {...(loop ? { "data-fx-loop": "1" } : {})}
        style={style}
        alt=""
      />
    );
  }
  return (
    <video
      className={className}
      data-fx-video
      data-t-start={tStart ?? 0}
      /* 拖播放头后要把卡内录屏拉回正确位置,得知道素材起播秒和倍速(见 App.tsx alignCardVideos) */
      data-fx-clip={clip}
      data-fx-rate={spd}
      {...(loop ? { "data-fx-loop": "1" } : {})}
      src={src}
      muted
      playsInline
      preload="auto"
      autoPlay
      loop
      style={style}
      /* 刚上传完的文件偶发第一次请求落空:自动重试加载几次 */
      /* 片段偏移:预览里加载完直接跳到 clip 秒;循环回 0 时再跳回去 */
      onLoadedMetadata={(e) => {
        e.currentTarget.playbackRate = spd;
        if (clip) e.currentTarget.currentTime = clip;
      }}
      onCanPlay={(e) => { e.currentTarget.playbackRate = spd; }}
      onTimeUpdate={
        clip
          ? (e) => {
              const v = e.currentTarget;
              if (v.currentTime < clip - 0.05) v.currentTime = clip;
            }
          : undefined
      }
      onError={(e) => {
        const v = e.currentTarget;
        const n = Number(v.dataset.retry || 0);
        if (n < 3) {
          v.dataset.retry = String(n + 1);
          setTimeout(() => v.load(), 400);
        }
      }}
    />
  );
}

/**
 * 图/视频通用媒体槽:同一个参数位,填图片路径出图,填视频路径出会动的小窗
 * (参考片心得:证据素材本身要是活的)。
 * 视频预览时静音循环;导出时由 __seekVideos 按时间轴对位,data-fx-loop 表示循环短素材。
 */
export function MediaImg({
  src,
  className,
  tStart,
}: {
  src: string;
  className?: string;
  /** 时间轴导出用:所在卡片的 start(秒),循环素材按 (t-start)%时长 对位 */
  tStart?: number;
}) {
  if (isVideoSrc(src)) {
    return <FxVideo src={src} className={className} tStart={tStart} loop />;
  }
  return <img className={className} src={src} alt="" onError={imgRetry(src)} />;
}
