import type { SyntheticEvent } from "react";

/**
 * 图片加载失败自动重试(最多 3 次,带 cache-buster)。
 * 刚上传进 public/demo/ 的文件,dev server 第一次请求偶发落空——
 * 所有带图位的卡都应该挂上这个 onError。
 */
export function imgRetry(src: string) {
  return (e: SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    const n = Number(im.dataset.retry || 0);
    if (n < 3) {
      im.dataset.retry = String(n + 1);
      setTimeout(() => {
        im.src = `${src}${src.includes("?") ? "&" : "?"}r=${n + 1}`;
      }, 400);
    }
  };
}
