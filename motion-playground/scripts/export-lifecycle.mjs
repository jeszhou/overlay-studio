/** Close Chromium without leaving the timeout alive after a successful close. */
export async function closeBrowser(browser, { timeoutMs = 10_000 } = {}) {
  if (!browser) return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => browser.close()),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch {
    // A disconnected or unresponsive browser still needs process cleanup.
  } finally {
    clearTimeout(timer);
    try { browser.process()?.kill("SIGKILL"); } catch { /* Already exited. */ }
  }
}
