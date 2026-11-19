import {overlayFile} from './vite-plugins/overlay-file.js'
import {randomUUID} from 'node:crypto'
import {projectBundlePlugin} from './scripts/project-bundle.mjs'
import {projectSavePlugin} from './scripts/project-save.mjs'
import { lineReader, progressConsumer, progressWatchdog } from './scripts/export-progress.mjs'
import { stopProcessTree } from './scripts/process-tree.mjs'
import {resolveExportFolder} from './scripts/export-folder.mjs'
import {chooseExportFolder,projectFolderPlugin} from './project-folder.js'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 上传落盘:写草稿 → 誊正。两件事必须守住 ——
 *
 *  一、草稿名要唯一。以前草稿固定叫「素材名.part」,同一个素材传两遍(前一遍还没传完
 *  又点了一次)时两次写的是同一份草稿,先完成的把它改名拿走,后完成的 renameSync 抛
 *  ENOENT。Mac 和 Windows 上都栽过这个坑。
 *
 *  二、誊正失败不许把服务带走。这个异常在流的回调里,中间件外面的 try/catch 兜不住,
 *  Vite 也没注册 uncaughtException —— 于是整个开发服务器进程直接退出。页面还在内存里,
 *  看着一切正常,但后台没了,此后每一次导入都失败。用户看到的就是这一幕。
 */
let uploadSeq = 0
function saveUpload(
  req: IncomingMessage,
  res: ServerResponse,
  dest: string,
  urlPath: string,
) {
  const tmp = `${dest}.${process.pid}-${Date.now()}-${++uploadSeq}.part`
  const ws = fs.createWriteStream(tmp)
  let settled = false
  // 所有出口都走这一个函数,而且整个包在 try 里。
  // 第二条守则的教训是「流回调里抛出的异常没人接」—— 那就不许任何一行裸奔:
  // rmSync 的 force 只忽略「文件不存在」,Windows 上文件被杀毒/索引器占着时照样抛 EPERM,
  // 以前 catch 里那句 rmSync 就是这么把服务带走的。
  const reply = (code: number, body: Record<string, unknown>) => {
    if (settled) return
    settled = true
    try {
      if (code !== 200) fs.rmSync(tmp, { force: true })
    } catch (e) {
      console.error(`[upload] 草稿删不掉(留着,下次启动再清):${tmp}`, e)
    }
    try {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    } catch (e) {
      console.error('[upload] 回应失败(多半是浏览器那头已断开):', e)
    }
  }
  // 先把写流关干净、等它真的关掉,再删草稿:Windows 上文件句柄还开着时删不掉
  const fail = (why: string) => {
    const done = () => reply(500, { ok: false, error: why })
    if (ws.closed) done()
    else {
      ws.once('close', done)
      ws.destroy()
    }
  }
  // 浏览器那头中途断开(刷新 / 关标签页 / 断网):pipe 只会解绑,finish 和 error 都不会来,
  // 草稿会永远留在磁盘上,而且改成唯一草稿名之后每断一次就多留一份。这里自己收尾。
  req.on('close', () => {
    if (!req.complete) fail('上传中断')
  })
  req.on('error', (e) => fail(String(e)))
  ws.on('error', (e) => fail(String(e)))
  ws.on('finish', () => {
    void (async () => {
      try {
        await renameWithRetry(tmp, dest)
        // 地址带上文件的修改时间:同名素材换了新版,地址跟着变,浏览器才会去拿新的。
        // 不带的话地址一个字都没变,页面会一直显示旧素材 —— 而导出的成片却是新的。
        const v = Math.floor(fs.statSync(dest).mtimeMs)
        // 两个接口的字段名不一样(/api/media 取 url,/api/upload-demo 取 src),都给,各取各的
        reply(200, { ok: true, url: `${urlPath}?v=${v}`, src: `${urlPath}?v=${v}` })
      } catch (e) {
        fail(`写入失败:${e}`)
      }
    })()
  })
  req.pipe(ws)
}

/**
 * 草稿誊正,失败了等一下再试。
 * Windows 上杀毒/索引器会短暂占住刚写完的文件,改名报 EPERM/EBUSY,过几百毫秒基本都能过。
 * 以前这里的退路是 copyFileSync:草稿和目标永远在同一个目录,「跨盘」根本不会发生;
 * 文件被占时复制一样失败;真跑起来还是几百 MB 的同步复制,会把单线程的服务卡死几十秒。
 */
async function renameWithRetry(tmp: string, dest: string) {
  const waits = [0, 200, 500, 1000]
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]))
    try {
      fs.renameSync(tmp, dest)
      return
    } catch (e) {
      if (i === waits.length - 1) throw e
    }
  }
}

/** 导出透明动效层:POST /api/export → 起无头 Chrome 逐帧渲染 PNG 序列到 exports/ */
/** 音效:public/sfx/ 里放了同名文件就用它,没放就用随仓库附带的 CC0 默认音效(public/sfx-default/)。
 *  默认音效单独放一个文件夹,是为了不和你自己放进 public/sfx/ 的文件撞名 —— 撞名的话 git pull 会直接失败。 */
function sfxFallback(): Plugin {
  return {
    name: 'sfx-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/sfx\/([^/?#]+\.mp3)(?:[?#].*)?$/.exec(req.url ?? '')
        if (!m) return next()
        let name: string
        try { name = path.basename(decodeURIComponent(m[1])) } catch { return next() }
        const pub = path.join(server.config.root, 'public')
        if (fs.existsSync(path.join(pub, 'sfx', name))) return next()
        const fallback = path.join(pub, 'sfx-default', name)
        if (!fs.existsSync(fallback)) return next()
        res.setHeader('Content-Type', 'audio/mpeg')
        fs.createReadStream(fallback).pipe(res)
      })
    },
  }
}

function localApiGuard(): Plugin {
  return {
    name: 'local-api-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!/^\/api(?:\/|\?|$)/.test(req.url ?? '')) return next()
        const origin = req.headers.origin
        let allowed = req.headers['sec-fetch-site'] !== 'cross-site'
        if (origin) {
          try {
            const protocol = server.config.server.https ? 'https:' : 'http:'
            allowed = allowed && new URL(origin).origin === `${protocol}//${req.headers.host}`
          } catch { allowed = false }
        }
        // 没有 Origin 的本机 CLI/启动器请求继续可用。
        if (allowed) return next()
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: '只允许从本地编辑台访问此接口' }))
      })
    },
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  if (!req.headers.origin) return true
  try { return new URL(req.headers.origin).host === req.headers.host }
  catch { return false }
}

function overlayExport(): Plugin {
  let busy = false
  let folderPickerBusy = false
  let activePid: number | undefined
  let cancelled = false
  let lastResult: Record<string, unknown> | undefined
  // 导出进度(GET /api/export-status 轮询用):从脚本 stdout 解析
  let prog: {
    running: boolean
    stage: string // prep | extract | frames | mov | webm | sfx | done
    frame: number
    total: number
    startedAt: number
    requestId?: string
    framesAt: number // 逐帧渲染开跑的时刻(0 = 还没开始),「预计还需」从这里起算
    perFrame?: { render: number; anim: number; shot: number } // 每帧三步平均毫秒(脚本 progress 行带出)
    operation?: string
    stageStartedAt?: number
    encodedFrame?: number
    outTimeSec?: number
    durationSec?: number
    totalSize?: number
    ok?: boolean
  } = { running: false, stage: 'done', frame: 0, total: 0, startedAt: 0, framesAt: 0 }
  return {
    name: 'overlay-export',
    configureServer(server) {
      // 导入的视频落盘成一个真实路径:blob 地址刷新即失效,每次都要重新导入。
      // 存进 public/_media/ 之后,刷新后按 URL 自动恢复;这个路径无头 Chrome 也能读,
      // 所以它同时可以当运镜卡的「口播视频」用。
      server.middlewares.use('/api/media', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('{"ok":false}')
          return
        }
        const raw = String(req.headers['x-filename'] ?? 'video')
        // 文件名只留安全字符,防止 ../ 之类写到目录外
        let decoded: string
        try {
          decoded = decodeURIComponent(raw)
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: '文件名编码无效' }))
          return
        }
        const safe = randomUUID() + '-' + decoded.replace(/[^\w.\-\u4e00-\u9fff]/g, '_').slice(-80)
        const dir = path.join(server.config.root, 'public', '_media')
        fs.mkdirSync(dir, { recursive: true })
        // 以前这儿有一条「同名 + 大小一样就当同一个文件,直接复用旧的」的近路。
        // 它把「换了一版、恰好差不多大」的素材挡在门外:界面报成功,用的还是旧文件。
        // 省下的那点时间不值这个误判,老老实实每次都写。
        saveUpload(req, res, path.join(dir, safe), `/_media/${encodeURIComponent(safe)}`)
      })

      server.middlewares.use('/api/export-status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ...prog, result: lastResult }))
      })
      server.middlewares.use('/api/export-folder', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (!sameOrigin(req)) {
          res.statusCode = 403
          res.end(JSON.stringify({ ok: false, error: '只允许从本地编辑台选择文件夹' }))
          return
        }
        const fallback = path.join(server.config.root, 'exports', 'output')
        if (req.method === 'GET') {
          res.end(JSON.stringify({ ok: true, dir: fallback }))
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'GET or POST only' }))
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          void (async () => {
            try {
              const { initialDir, dir } = JSON.parse(body || '{}')
              if (typeof dir === 'string') {
                if (dir === fallback) fs.mkdirSync(fallback, { recursive: true })
                res.end(JSON.stringify({ ok: true, dir: resolveExportFolder(server.config.root, dir) }))
                return
              }
              if (folderPickerBusy) throw new Error('已有文件夹选择窗口，请先完成或取消')
              let initial = fallback
              try {
                initial = resolveExportFolder(server.config.root, initialDir)
              } catch {
                /* Stale preference: open at the default folder. */
              }
              if (!fs.existsSync(initial)) initial = server.config.root
              folderPickerBusy = true
              let chosen: string | null
              try {
                chosen = await chooseExportFolder(initial)
              } finally {
                folderPickerBusy = false
              }
              if (!chosen) {
                res.end(JSON.stringify({ ok: false, cancelled: true }))
                return
              }
              res.end(JSON.stringify({ ok: true, dir: resolveExportFolder(server.config.root, chosen) }))
            } catch (error) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(error) }))
            }
          })()
        })
      })
      server.middlewares.use('/api/export-cancel', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST' || !sameOrigin(req)) {
          res.statusCode = 403
          res.end(JSON.stringify({ ok: false, error: '无效请求' }))
          return
        }
        const expected = new URL(req.url || '/', 'http://localhost').searchParams.get('startedAt')
        if (expected !== null && Number(expected) !== prog.startedAt) {
          res.statusCode = 409
          res.end(JSON.stringify({ ok: false, error: '导出任务已切换' }))
          return
        }
        if (!busy || !activePid) {
          res.end(JSON.stringify({ ok: false, error: '没有正在导出的任务' }))
          return
        }
        cancelled = true
        void stopProcessTree(activePid)
          .then(() => res.end(JSON.stringify({ ok: true })))
          .catch((e: Error) => {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: e.message }))
          })
      })
      server.middlewares.use('/api/export-open', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST' || !sameOrigin(req)) {
          res.statusCode = 403
          res.end(JSON.stringify({ ok: false }))
          return
        }
        const file = lastResult?.mov
        if (typeof file !== 'string' || !fs.existsSync(file)) {
          res.statusCode = 404
          res.end(JSON.stringify({ ok: false, error: '成品文件不存在' }))
          return
        }
        const command =
          process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        const args =
          process.platform === 'win32'
            ? ['/select,', file]
            : process.platform === 'darwin'
              ? ['-R', file]
              : [path.dirname(file)]
        const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
        child.once('error', () => {})
        child.unref()
        res.end(JSON.stringify({ ok: true }))
      })
      server.middlewares.use('/api/export', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        if (!sameOrigin(req)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: '只允许从本地编辑台导出' }))
          return
        }
        if (busy) {
          res.statusCode = 429
          res.end(JSON.stringify({ ok: false, error: '已有导出任务在进行中' }))
          return
        }
        busy = true
        cancelled = false
        lastResult = undefined
        let body = ''
        let rejected = false
        req.on('close', () => {
          if (!req.complete && !rejected) busy = false
        })
        req.on('data', (c) => {
          if (rejected) return
          body += c
          if (body.length > 32 * 1024 * 1024 && !rejected) {
            rejected = true
            busy = false
            res.statusCode = 413
            res.end(JSON.stringify({ ok: false, error: '工程数据超过 32 MB' }))
          }
        })
        req.on('end', () => {
          if (rejected) return
          try {
            const job = JSON.parse(body || '{}')
            if (!Number.isFinite(job.duration) || job.duration <= 0 || job.duration > 86400)
              throw new Error('导出时长必须在 0 到 86400 秒之间')
            if (job.outputDir) job.outputDir = resolveExportFolder(server.config.root, job.outputDir)
            job.mode ??= job.doc ? 'timeline' : 'single'
            if (
              job.mode !== 'timeline' &&
              (job.mode !== 'single' || !/^[a-z0-9][a-z0-9-]*$/.test(job.effectId ?? ''))
            )
              throw Error('无效的卡片或模式')
            job.runId = randomUUID()
            const address = server.httpServer?.address()
            job.base = `http://localhost:${typeof address === 'object' && address ? address.port : (server.config.server.port ?? 5177)}`
            const jobFile = path.join(os.tmpdir(), `overlay-export-${job.runId}.json`)
            fs.writeFileSync(jobFile, JSON.stringify(job))

            const child = spawn(process.execPath, ['scripts/export-frames.mjs', jobFile], {
              cwd: server.config.root,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            })
            activePid = child.pid
            const requestId =
              typeof job.requestId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(job.requestId)
                ? job.requestId
                : undefined
            prog = {
              running: true,
              stage: 'prep',
              frame: 0,
              total: 0,
              startedAt: Date.now(),
              requestId,
              framesAt: 0,
            }
            let err = ''
            let failureReason = ''
            let result: Record<string, unknown> | undefined
            let finished = false
            const consume = progressConsumer(prog)
            // 真实帧数/输出时间/已写字节增加才延长等待,重复日志不能掩盖冻结。
            const watchdog = progressWatchdog(() => {
              failureReason = '导出 15 分钟没有实际进展,已停止本次任务。请检查素材或重新导出。'
              void stopProcessTree(child.pid).catch((error: Error) => {
                failureReason += ` 停止子进程失败:${error.message}`
                child.kill('SIGKILL')
              })
            })
            const lines = lineReader((line: string) => {
              try {
                const event = JSON.parse(line)
                if (event?.event === 'progress') {
                  if (consume(event)) watchdog.advance()
                  return // Machine progress updates status, not terminal scrollback.
                } else if (typeof event?.ok === 'boolean') result = event
              } catch {
                /* Human-readable logs are not progress events. */
              }
              process.stdout.write(`[export] ${line}\n`)
            })
            child.stdout.setEncoding('utf8')
            child.stderr.setEncoding('utf8')
            child.stdout.on('data', (d) => {
              lines.write(d)
            })
            child.stderr.on('data', (d) => {
              err = (err + d).slice(-16_384)
            })
            const finish = (code: number | null, signal?: NodeJS.Signals | null) => {
              if (finished) return
              finished = true
              lines.end()
              watchdog.stop()
              busy = false
              activePid = undefined
              if (cancelled) {
                const stem = (job.mode === 'timeline' ? 'timeline' : job.effectId) + '-' + job.runId
                const final = job.outputDir || path.join(server.config.root, 'exports', 'output')
                try {
                  for (const suffix of ['.mov', '.webm', '-音效清单.txt', '-音效轨.m4a', '-合成说明.txt'])
                    fs.rmSync(path.join(final, stem + suffix), { force: true })
                  fs.rmSync(path.join(server.config.root, 'exports', stem), { force: true, recursive: true })
                } catch (error) {
                  console.error('清理已取消导出的临时文件失败', error)
                }
              }
              const ok = !cancelled && code === 0 && !signal && !failureReason && result?.ok === true
              const finalError = cancelled
                ? '用户已取消导出'
                : failureReason || String(result?.error || err.slice(-800) || '导出未完成')
              lastResult = { ...result, ok, cancelled, ...(!ok ? { error: finalError } : {}) }
              prog = { ...prog, running: false, stage: 'done', ok }
              try {
                fs.rmSync(jobFile, { force: true })
              } catch (error) {
                console.error('[export] 临时任务文件清理失败:', error)
              }
              try {
                res.setHeader('Content-Type', 'application/json')
                if (ok || cancelled) res.end(JSON.stringify(lastResult))
                else {
                  res.statusCode = 500
                  const fallback = signal
                    ? `导出进程被 ${signal} 停止`
                    : `导出进程退出码 ${code},未返回有效成品`
                  const error = failureReason || String(result?.error || err.slice(-800) || fallback)
                  // Structured diagnostics and retained paths must survive a non-zero exit.
                  res.end(JSON.stringify({ ...result, ok: false, error }))
                }
              } catch (error) {
                console.error('[export] 回应失败:', error)
              }
            }
            child.once('error', (error) => {
              failureReason = `无法启动导出进程:${error.message}`
              finish(1)
            })
            child.once('close', finish)
          } catch (e) {
            busy = false
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      })
    },
  }
}

/** 录屏上传:POST /api/upload-demo?name=xxx.mp4(原始字节流)→ 存进 public/demo/,返回可用路径 */
function demoUpload(): Plugin {
  return {
    name: 'demo-upload',
    configureServer(server) {
      server.middlewares.use('/api/upload-demo', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        try {
          const q = new URL(req.url ?? '', 'http://x').searchParams
          // 只留文件名本体,防路径穿越;空格等字符统一成下划线
          const raw = decodeURIComponent(q.get('name') || 'demo.mp4')
          const name = randomUUID() + '-' + path.basename(raw).replace(/[^\w.一-龥()-]/g, '_')
          const dir = path.join(server.config.root, 'public', 'demo')
          fs.mkdirSync(dir, { recursive: true })
          // 先写临时文件再改名:用户在文件选择器里选中 public/demo 里的同名文件时,
          // 直接写 dest 会一边读一边截断源文件(自毁);临时文件+rename 则安全覆盖
          saveUpload(req, res, path.join(dir, name), `/demo/${name}`)
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
      })
    },
  }
}

/** 学习闭环:POST /api/review-log → 把「AI 初选 vs 用户终选」存进 exports/review-logs/,供「学一下」用 */
function reviewLog(): Plugin {
  return {
    name: 'review-log',
    configureServer(server) {
      server.middlewares.use('/api/review-log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            JSON.parse(body) // 只校验是合法 JSON,原样落盘
            const dir = path.join(server.config.root, 'exports', 'review-logs')
            fs.mkdirSync(dir, { recursive: true })
            const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
            const dest = path.join(dir, `${stamp}-review-log.json`)
            fs.writeFileSync(dest, body)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, file: dest }))
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [localApiGuard(),projectFolderPlugin(), overlayFile(), projectBundlePlugin(), projectSavePlugin(), react(), sfxFallback(), overlayExport(), demoUpload(), reviewLog()],
  server: {
    port: 5177, // Overlay Studio 固定端口,避免和其他项目的 5173/5174 混淆
    // 端口被占时**报错退出**,不许自己顺延到 5178。
    // 顺延是个隐蔽的坑:localStorage 按 origin 隔离,5177 和 5178 是两套存档,
    // 编排会"看起来丢了";启动器又是写死 curl/open 5177 的,顺延后浏览器还会打不开。
    // 宁可起不来报一句"5177 被占了",也不要静悄悄换个门牌。
    strictPort: true,
    open: true, // 启动后自动打开浏览器
  },
})
