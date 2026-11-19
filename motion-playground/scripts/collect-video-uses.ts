import { EFFECTS } from "../src/effects/registry";
type Fields = Record<string, unknown>;
type Definition = { id: string; defaults: Fields; controls: { key: string }[] };
type Job = {
  mode?: string;
  effectId?: string;
  duration?: number;
  params?: Fields;
  doc?: { cam?: string; cards?: { kind: string; start: number; end: number; params?: Fields }[] } | null;
};

function mediaUses(job: Job, definitions: Definition[]) {
  const duration = job.duration ?? 6;
  const cards =
    job.mode === "single"
      ? [{ kind: job.effectId, start: 0, end: duration, params: job.params }]
      : (job.doc?.cards ?? []);
  const uses: { src: string; start: number; end: number; camera: boolean }[] = [];
  const isVideo = (src: unknown): src is string =>
    typeof src === "string" && /\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(src);
  for (const card of cards) {
    const def = definitions.find((d) => d.id === card.kind);
    if (!def || card.start - 0.05 >= duration || card.end <= 0) continue;
    const fields = { ...def.defaults, ...card.params };
    const end = Math.min(card.end, duration);
    const cam = fields.camSrc || job.doc?.cam;
    if (def.controls.some((c) => c.key === "camSrc") && isVideo(cam))
      uses.push({ src: cam, start: Math.max(0, card.start - 0.05), end, camera: true });
    for (const { key } of def.controls) {
      const mediaSlot = /^(?:videoSrc|img)(\d*)$/.exec(key);
      const value = fields[key];
      if (!mediaSlot || !isVideo(value)) continue;
      const slot = mediaSlot[1];
      const clip = Math.max(0, Number(fields["clipStart" + slot] ?? fields["clip" + slot]) || 0);
      uses.push({
        src: value,
        start: 0,
        end: clip + (end - card.start) * (Number(fields.vidRate) || 1),
        camera: false,
      });
    }
  }
  return uses;
}

export function collectVideoUses(job: Job, definitions: Definition[] = EFFECTS) {
  const need = new Map<string, number>();
  for (const use of mediaUses(job, definitions)) need.set(use.src, Math.max(need.get(use.src) ?? 0, use.end));
  return need;
}

export function collectCameraIntervals(job: Job, definitions: Definition[] = EFFECTS) {
  const intervals = new Map<string, [number, number][]>();
  if (job.mode !== "timeline") return intervals;
  const uses = mediaUses(job, definitions);
  for (const use of uses) {
    if (use.camera) intervals.set(use.src, [...(intervals.get(use.src) ?? []), [use.start, use.end]]);
  }
  for (const use of uses) if (!use.camera) intervals.delete(use.src);
  return intervals;
}
