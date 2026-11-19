// Free v1.2.0 sound assignments. Unlisted effects use the public pop-light sound.
const defaults = {
  "stat-proof": "rise",
  odometer: "rise",
  "ring-metric": "rise",
  "rank-bars": "rise",
  "growth-curve": "rise",
  "versus-card": "impact",
  "focus-card": "whoosh",
  "ui-callout": "shutter",
  "terminal-3d": "type",
  "type-shift": "type",
  "chapter-bar": "chime",
  checklist: "ding",
  "step-timeline": "click",
  "entity-chips": "click",
  "caption-track": null,
};

function sourceFile(name, custom) {
  if (name !== "custom-file") return name && /^[a-z0-9-]+$/.test(name) ? "/sfx/" + name + ".mp3" : null;
  if (typeof custom !== "string") return null;
  return /^\/(?:_media|demo)\/[^/?#]+(?:\?v=\d+)?$/.test(custom) ||
    /^\/_projects\/[\w-]+\/assets\/[\w.-]+$/.test(custom)
    ? custom
    : null;
}

function appendHit(events, card, name, file, start, end, level) {
  const p = card.params ?? {};
  const t = Math.max(0, start + Math.max(-3, Math.min(3, Number(p.sfxOffset) || 0)));
  const duration = Math.min(3.2, Number.isFinite(end) ? end - t : 3.2);
  if (duration <= 0) return;
  const volume =
    level != null && Number.isFinite(Number(level)) ? Math.max(0, Math.min(1, Number(level))) : 0.45;
  events.push({
    kind: card.kind,
    t,
    duration,
    file,
    sfx: name,
    volume,
    fadeIn: Math.max(0, Math.min(duration, Number(p.sfxFadeIn) || 0)),
    fadeOut: Math.max(0, Math.min(duration, p.sfxFadeOut == null ? 0.05 : Number(p.sfxFadeOut) || 0)),
  });
}

// An explicit cue sound can use the installed public sounds or a project file.
function appendCaptionHits(events, card) {
  const p = card.params ?? {};
  const name = p.captionSound;
  if (card.kind !== "caption-track" || !name || name === "none" || name === "auto") return;
  const aliases = { "caption-pop": "pop", "caption-type": "type", "caption-swish": "whoosh-soft" };
  const file = sourceFile(Object.hasOwn(aliases, name) ? aliases[name] : name, p.captionSoundFile);
  if (!file) return;
  for (const line of String(p.lines ?? "").split(/\r?\n/)) {
    const [a, b, text] = line.split("|");
    const start = Number(a),
      end = Number(b);
    if (
      !text?.trim() ||
      !a.trim() ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    )
      continue;
    if (start < card.end && end > card.start)
      appendHit(
        events,
        card,
        name,
        file,
        Math.max(start, card.start),
        Math.min(end, card.end),
        p.captionVolume,
      );
  }
}

export function cardSoundEvents(cards) {
  const events = [];
  for (const card of cards) {
    const p = card.params ?? {};
    appendCaptionHits(events, card);
    const assigned = Object.hasOwn(defaults, card.kind) ? defaults[card.kind] : "pop-light";
    const name = !p.sfx || p.sfx === "auto" ? assigned : p.sfx;
    const file = sourceFile(name, p.sfxFile);
    if (name === "none" || !file) continue;
    const times =
      card.kind === "pin-board"
        ? String(p.times ?? "").trim() || p.itemTimes
        : p.itemTimes || p.stepTimes || p.times;
    let hits = [0];
    if (p.sfxSync === "steps" && typeof times === "string" && times.trim())
      hits = times
        .split("|")
        .map((t) => Number(t.trim()))
        .filter((t) => Number.isFinite(t) && t >= 0);
    else if (p.sfxSync === "steps" && card.kind === "pin-board")
      hits = String(p.items ?? "")
        .split("|")
        .filter(Boolean)
        .map((_, i) => 0.4 + (i * (Number(p.stepMs) || 4000)) / 1000);
    for (const relative of hits)
      appendHit(events, card, name, file, card.start + relative, card.end, p.sfxVolume);
  }
  return events.sort((a, b) => a.t - b.t);
}
