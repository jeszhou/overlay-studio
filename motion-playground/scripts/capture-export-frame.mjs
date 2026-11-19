/** Capture remains a transparent, lossless PNG at the already configured viewport. */
export async function captureExportFrame(page, file, fastPng) {
  try {
    return await page.screenshot({
      type: "png",
      path: file,
      omitBackground: true,
      // Omit the option entirely when fast PNG is off, preserving the old CDP request.
      ...(fastPng ? { optimizeForSpeed: true } : {}),
    });
  } catch (error) {
    if (!fastPng) throw error;
    throw new Error(
      `快速帧截图失败。请关闭「加快帧截图（实验）」后重试（CLI 设置 fastPng: false）。原始原因:${String(error?.message ?? error)}`,
      { cause: error },
    );
  }
}
