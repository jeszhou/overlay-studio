/** Keep the bundled renderer and its animation settings consistent across exports. */
export function exportBrowserOptions(platform = process.platform, compatibilityMode = false) {
  return {
    headless: true,
    args: [
      // Some Windows Chromium builds expose a blank native headless window.
      // Position it outside the desktop without minimizing or pausing rendering.
      ...(platform === 'win32' ? ['--window-position=-32000,-32000'] : []),
      // This switches Skia backends, not all GPU acceleration.
      ...(platform === 'win32' && compatibilityMode === true ? ['--disable-skia-graphite'] : []),
      '--force-color-profile=srgb',
      '--disable-background-timer-throttling',
      '--run-all-compositor-stages-before-draw',
      '--disable-lcd-text',
    ],
  };
}

/** Best-effort evidence from the actual export browser, without device IDs or paths. */
export async function exportBrowserDiagnostics(browser, compatibilityMode, platform = process.platform) {
  const mode = { compatibilityMode, compatibilityApplied: platform === 'win32' && compatibilityMode, platform };
  let timer;
  const inspect = async () => {
    const session = await browser.target().createCDPSession();
    try {
      const [version, { gpu }] = await Promise.all([
        browser.version(), session.send('SystemInfo.getInfo'),
      ]);
      const attributes = gpu?.auxAttributes ?? {};
      const features = gpu?.featureStatus ?? {};
      return { ...mode, version, skiaBackendType: attributes.skiaBackendType ?? null,
        skiaGraphite: features.skia_graphite ?? null, gpuCompositing: features.gpu_compositing ?? null,
        rasterization: features.rasterization ?? null, glRenderer: attributes.glRenderer ?? null };
    } finally { await session.detach().catch(() => {}); }
  };
  try {
    return await Promise.race([
      inspect(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('diagnostic timeout')), 3000); }),
    ]);
  } catch {
    // A diagnostic protocol failure must never prevent an otherwise valid export.
    return { ...mode, diagnosticUnavailable: true };
  } finally { clearTimeout(timer); }
}
