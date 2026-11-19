import fs from "node:fs";
import { startFfmpeg, ffmpegFailure } from "./ffmpeg-process.mjs";
import { videoAudioInputArgs, videoOutputArgs } from "./export-codecs.mjs";

/** One PNG in flight per encoder; each write waits for the OS pipe to accept it. */
export function createPngStream({ files, fps, durationSec, totalFrames, onProgress, audioFile,
  processOptions = {}, onCleanupError = (error) => console.error(error.message) }) {
  const outputs = {};
  let busy = false;
  let submitted = 0;
  let ended = false;
  const sinks = Object.entries(files).map(([format, file]) => {
    const process = startFfmpeg([
      "-y", "-probesize", "32", "-analyzeduration", "0", "-f", "image2pipe", "-c:v", "png", "-framerate", String(fps), "-i", "pipe:0",
      ...videoAudioInputArgs(format, audioFile),
      ...videoOutputArgs(format, file, audioFile),
    ], { ...processOptions, pipeInput: true, stage: format, durationSec, total: totalFrames,
      onProgress: (event) => onProgress?.(format, event) });
    const sink = { format, file, process, result: null, error: null, rejectWrite: null, frames: 0 };
    // Always attach before any writes; an early exit must never become an unhandled EPIPE.
    process.input.on("error", (error) => {
      sink.error = error;
      sink.rejectWrite?.(error);
    });
    process.done.then((result) => {
      sink.result = result;
      sink.rejectWrite?.(ffmpegFailure(result, `${format} 在送帧完成前退出`));
    });
    return sink;
  });
  const retainCompleted = () => {
    for (const sink of sinks) {
      if (sink.result?.status === 0 && sink.frames === totalFrames && sink.result.encodedFrames === totalFrames && fs.existsSync(sink.file))
        outputs[sink.format] = sink.file;
      else {
        delete outputs[sink.format];
        try { fs.rmSync(sink.file, { force: true }); }
        catch (error) { onCleanupError(error); }
      }
    }
  };
  const abort = async (reason = "流式导出取消") => {
    ended = true;
    await Promise.all(sinks.map(async (sink) => { sink.result = await sink.process.abort(reason); }));
    retainCompleted();
  };
  return {
    outputs,
    get submitted() { return submitted; },
    async write(frame) {
      if (ended || busy || submitted >= totalFrames) throw new Error("流式送帧状态错误：必须依次提交且不能超过总帧数");
      if (!(frame instanceof Uint8Array) || !frame.length) throw new Error("截图没有返回 PNG 数据");
      busy = true;
      try {
        await Promise.all(sinks.map(async (sink) => {
          if (sink.result || sink.error) throw sink.error ?? ffmpegFailure(sink.result, `${sink.format} 提前退出`);
          await new Promise((resolve, reject) => {
            sink.rejectWrite = reject;
            sink.process.input.write(frame, (error) => {
              sink.rejectWrite = null;
              if (error) reject(error); else resolve();
            });
          });
          sink.frames++;
          // Real input was accepted, not a timer heartbeat. Backpressure bounds this work.
          sink.process.inputAdvanced();
        }));
        submitted++;
      } catch (error) {
        await abort(String(error.message ?? error));
        const failed = sinks.find((sink) => sink.result?.status !== 0 && !sink.result?.signal)
          ?? sinks.find((sink) => sink.result?.stderr || sink.result?.error);
        throw failed ? ffmpegFailure(failed.result, "流式送帧失败") : error;
      } finally { busy = false; }
    },
    async finish() {
      if (ended || busy || submitted !== totalFrames) {
        await abort("流式输入帧数不完整");
        throw new Error(`流式输入帧数不完整：${submitted}/${totalFrames}`);
      }
      ended = true;
      // EOF allows FFmpeg to flush delayed frames and finish the seekable MOV file.
      for (const sink of sinks) sink.process.input.end();
      await Promise.all(sinks.map(async (sink) => { sink.result = await sink.process.done; }));
      retainCompleted();
      const failed = sinks.find((sink) => !outputs[sink.format]);
      if (failed) throw ffmpegFailure(failed.result, `${failed.format} 流式编码失败（实际 ${failed.result?.encodedFrames ?? 0}/${totalFrames} 帧）`);
      return outputs;
    },
    abort,
  };
}
