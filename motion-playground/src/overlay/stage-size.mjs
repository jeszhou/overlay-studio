const SIZES = { h: { w: 1920, h: 1080 }, v: { w: 1080, h: 1920 }, "4:3": { w: 1440, h: 1080 } };
export function stageSize(ratio) {
  return SIZES[ratio === "v" || ratio === "4:3" ? ratio : "h"];
}
