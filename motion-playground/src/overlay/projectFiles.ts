export async function saveProjectFile(
  kind: "json" | "pack" | "autosave",
  dir: string,
  doc: unknown,
  keepalive = false,
): Promise<string> {
  const response = await fetch("/api/project-save/" + kind, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir, doc }),
    keepalive,
  });
  if (!(response.headers.get("content-type") ?? "").includes("json"))
    throw new Error("本地工程保存服务不可用");
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "工程保存失败");
  return data.file;
}
