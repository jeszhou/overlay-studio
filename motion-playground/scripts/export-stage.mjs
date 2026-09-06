const EXPORT_STAGES = Object.freeze({
  "16:9": Object.freeze({ w: 1920, h: 1080 }),
  "9:16": Object.freeze({ w: 1080, h: 1920 }),
});

/** Keep the renderer viewport on the same two-value whitelist as OverlayDoc. */
export function exportStageForDoc(doc) {
  const aspect = doc?.aspect === "9:16" ? "9:16" : "16:9";
  return EXPORT_STAGES[aspect];
}
