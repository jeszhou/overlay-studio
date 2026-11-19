interface ExportFailureResponse {
  error?: unknown;
  details?: unknown;
  mov?: unknown;
  webm?: unknown;
  dir?: unknown;
}

/** Also keep legacy server errors intact: diagnostics can precede the final summary marker. */
export function exportFailureMessage(data: ExportFailureResponse): string {
  const summary = String(data.error ?? "未知错误");
  const details = typeof data.details === "string" && data.details.trim() ? data.details.trim() : "";
  const saved = [data.mov, data.webm, data.dir].filter((value) => typeof value === "string" && value).join("\n");
  return `❌ 导出失败\n\n${summary}${details ? `\n\n错误详情:\n${details}` : ""}${saved ? `\n\n已保留的文件/帧目录:\n${saved}` : ""}`;
}
