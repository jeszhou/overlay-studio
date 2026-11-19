import type { OverlayDoc } from "./types";
import type { SrtLine } from "./srt";

export function newProject(): OverlayDoc {
  return { version: 1, projectId: crypto.randomUUID(), cards: [] };
}

export function projectDocument(
  doc: OverlayDoc,
  srt: SrtLine[] | null,
  preview: string | null,
  origin: OverlayDoc | null,
): OverlayDoc {
  return {
    ...doc,
    layerOrder: "manual",
    srt: srt ?? [],
    previewVideo: preview?.startsWith("/") ? preview : undefined,
    reviewOrigin: origin ? { ...origin, reviewOrigin: undefined } : undefined,
  };
}

export async function projectFolder(body?: { dir: string; browse?: boolean }): Promise<string | null> {
  const response = await fetch(
    "/api/project-folder",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "无法访问保存文件夹");
  return result.cancelled ? null : result.dir;
}
