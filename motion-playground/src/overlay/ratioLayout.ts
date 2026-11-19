import type { OverlayCard } from "./types";

const LAYOUT_KEYS = ["offsetX", "offsetY", "scale", "captionY"] as const;

/** Keep edits made in one canvas ratio when switching to another ratio. */
export function switchRatioLayout(cards: OverlayCard[], from: string, to: string): OverlayCard[] {
  if (from === to) return cards;
  return cards.map((card) => {
    const saved =
      card.params.layoutByRatio && typeof card.params.layoutByRatio === "object"
        ? (card.params.layoutByRatio as Record<string, Record<string, unknown>>)
        : {};
    const current = Object.fromEntries(
      LAYOUT_KEYS.filter((key) => card.params[key] !== undefined).map((key) => [key, card.params[key]]),
    );
    const next = saved[to] ?? current;
    return { ...card, params: { ...card.params, ...next, layoutByRatio: { ...saved, [from]: current } } };
  });
}
