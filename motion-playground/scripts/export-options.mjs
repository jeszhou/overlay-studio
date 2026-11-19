/**
 * Direct CLI jobs that omit outputs retain the historical MOV + WebM contract.
 * The editor explicitly sends ["mov"] and can add WebM. MOV remains required:
 * audio, import guidance and recovery behavior are built around the MOV output.
 */
export function resolveExportOutputs(value) {
  if (value === undefined) return ["mov", "webm"];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((format) => format !== "mov" && format !== "webm") ||
    new Set(value).size !== value.length ||
    !value.includes("mov")
  ) {
    throw new Error('outputs 必须是 ["mov"] 或 ["mov", "webm"]；MOV 为必选，暂不支持单独导出 WebM');
  }
  return value.includes("webm") ? ["mov", "webm"] : ["mov"];
}

/** Opt-in until the supported renderer has passed complete animation RGBA checks. */
export function resolveFastPng(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("fastPng 必须是 true 或 false");
  return value;
}

/** Explicitly preserving PNG files always selects the recoverable sequence path. */
export function resolveExportMode(value, keepFrames = false) {
  if (value !== undefined && value !== "sequence" && value !== "stream")
    throw new Error('exportMode 必须是 "sequence" 或 "stream"');
  return keepFrames ? "sequence" : (value ?? "sequence");
}

/** Windows renderer workaround; omitted jobs preserve the default backend. */
export function resolveCompatibilityMode(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("compatibilityMode 必须是 true 或 false");
  return value;
}
