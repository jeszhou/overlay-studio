import type { SrtLine } from "./srt";
import { parseOverlay, type OverlayDoc } from "./types";

interface AutosaveEnvelope {
  overlay?: unknown;
  origin?: unknown;
  srt?: unknown;
  videoUrl?: unknown;
}

export interface ParsedOverlayAutosave {
  doc?: OverlayDoc;
  dropped?: { kind: string; n: number }[];
  error?: string;
  origin: OverlayDoc | null;
  srt: SrtLine[] | null;
  videoUrl?: string;
}

function isSrtLine(value: unknown): value is SrtLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.start === "number" &&
    typeof line.end === "number" &&
    line.end > line.start &&
    typeof line.text === "string"
  );
}

/** Parse the autosave boundary without ever returning its unvalidated overlay object. */
export function parseOverlayAutosave(raw: string): ParsedOverlayAutosave {
  const empty = { origin: null, srt: null };
  try {
    const value = JSON.parse(raw) as AutosaveEnvelope;
    if (!value || typeof value !== "object") return { ...empty, error: "自动存档格式非法" };

    const parsed = parseOverlay(value.overlay);
    if (!parsed.doc) return { ...empty, error: parsed.error ?? "自动存档里的编排无法读取" };

    const origin = value.origin == null ? null : (parseOverlay(value.origin).doc ?? null);
    const srt = Array.isArray(value.srt) && value.srt.every(isSrtLine) ? value.srt : null;
    const videoUrl =
      typeof value.videoUrl === "string" && value.videoUrl.startsWith("/_media/")
        ? value.videoUrl
        : undefined;

    return {
      doc: parsed.doc,
      dropped: parsed.dropped,
      origin,
      srt,
      videoUrl,
    };
  } catch (error) {
    return { ...empty, error: `自动存档解析失败: ${String(error)}` };
  }
}
