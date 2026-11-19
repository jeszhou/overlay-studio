export const EXPORT_IDLE_MS: number;
export function lineReader(onLine: (line: string) => void, maxLength?: number): {
  write(chunk: string): void;
  end(): void;
};
export function progressWatchdog(onStall: () => void, options?: { idleMs?: number }): {
  advance(): void;
  stop(): void;
};
export interface ExportProgressStatus {
  stage: string;
  workers?: number;
  frame?: number;
  total?: number;
  operation?: string;
  framesAt?: number;
  stageStartedAt?: number;
  encodedFrame?: number;
  outTimeSec?: number;
  durationSec?: number;
  totalSize?: number;
  perFrame?: { render: number; anim: number; shot: number; feed?: number };
}
export function progressConsumer(status: ExportProgressStatus, now?: () => number): (event: unknown) => boolean;

export function frameProgressReporter(
  send: (event: { state: string; frame: number; [key: string]: unknown }) => void,
  options?: { intervalMs?: number; now?: () => number },
): (event: { state: string; frame: number; [key: string]: unknown }) => boolean;
