/**
 * 上传失败时给人看的话。
 *
 * fetch 请求不通时浏览器抛的是 `TypeError: Failed to fetch` —— 对客户是天书,
 * 而它的真实含义几乎永远只有一个:本地服务没在跑。以前直接把这行英文弹出去,
 * 客户只能理解成「这软件坏了」。
 */
export function uploadErrText(e: unknown): string {
  const raw = String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw))
    return (
      "本地服务已停止(页面还开着,但后台没了)。\n\n" +
      "回到启动时那个终端窗口,重新运行 npm run dev(或再双击一次启动器),然后刷新本页。"
    );
  return raw;
}
