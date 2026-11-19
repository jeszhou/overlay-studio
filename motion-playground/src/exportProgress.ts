export interface ExportProgressState {
  stage: string;
  workers?: number;
  frame: number;
  total: number;
  startedAt: number;
  framesAt: number;
  encodedFrame?: number;
  outTimeSec?: number;
  durationSec?: number;
  perFrame?: { render: number; anim: number; shot: number; feed?: number };
}

const stageNames: Record<string, string> = {
  prep: "准备导出",
  extract: "预处理视频",
  frames: "渲染画面",
  encode: "完成视频编码",
  mov: "合成透明 MOV",
  webm: "合成 WebM",
  sfx: "处理音效",
};

function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return whole >= 60 ? `${Math.floor(whole / 60)} 分 ${whole % 60} 秒` : `${whole} 秒`;
}

/** Progress is for the current stage; unknown later stages are not included in its ETA. */
export function exportProgressView(prog: ExportProgressState | null, now = Date.now()) {
  let pct: number | null = null;
  let text = "准备中(启动渲染器)…";
  if (prog) {
    text = `${stageNames[prog.stage] ?? "导出"}…`;
    if (prog.stage === "frames" && prog.total > 0) {
      pct = Math.max(0, Math.min(100, Math.round(prog.frame / prog.total * 100)));
      const elapsed = Math.max(0, now - (prog.framesAt || prog.startedAt)) / 1000;
      text = `渲染帧 ${prog.frame}/${prog.total}`;
      if (prog.workers) text += prog.workers === 2 ? " · 两页并行" : " · 单页";
      if (prog.frame > 0) {
        const eta = elapsed / prog.frame * Math.max(0, prog.total - prog.frame);
        text += ` · 本阶段预计还需 ${timeLabel(eta)}`;
      }
    } else if (["extract", "encode", "mov", "webm", "sfx"].includes(prog.stage)) {
      const processed = prog.outTimeSec;
      if (processed !== undefined && Number.isFinite(processed) && processed >= 0) {
        text = `${stageNames[prog.stage]} · 已处理 ${timeLabel(processed)}`;
        if (prog.durationSec !== undefined && Number.isFinite(prog.durationSec) && prog.durationSec > 0) {
          pct = Math.min(100, Math.max(0, Math.round(processed / prog.durationSec * 100)));
          text += ` / ${timeLabel(prog.durationSec)}`;
        }
      }
    }
    if (prog.perFrame) {
      const { render, anim, shot, feed = 0 } = prog.perFrame;
      text += ` · ${prog.workers === 2 ? "每页平均每帧" : "平均每帧"} ${render + anim + shot + feed}ms(推帧 ${render} / 动画 ${anim} / 截图 ${shot}${feed ? ` / 送帧 ${feed}` : ""})`;
    }
  }
  return { pct, text, label: pct === null ? "进行中" : `本阶段 ${pct}%` };
}
