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
function overlayExport(): Plugin {
  let busy = false
  // 导出进度(GET /api/export-status 轮询用):从脚本 stdout 解析
  let prog: {
    running: boolean
    stage: string // prep | extract | frames | mov | webm | sfx | done
    frame: number
    total: number
    startedAt: number
    framesAt: number // 逐帧渲染开跑的时刻(0 = 还没开始),「预计还需」从这里起算
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
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{"ok":false}'); return }
        const raw = String(req.headers['x-filename'] ?? 'video')
        // 文件名只留安全字符,防止 ../ 之类写到目录外
        const safe = decodeURIComponent(raw).replace(/[^\w.\-\u4e00-\u9fff]/g, '_').slice(-80)
        const dir = path.join(server.config.root, 'public', '_media')
        fs.mkdirSync(dir, { recursive: true })
        // 以前这儿有一条「同名 + 大小一样就当同一个文件,直接复用旧的」的近路。
        // 它把「换了一版、恰好差不多大」的素材挡在门外:界面报成功,用的还是旧文件。
        // 省下的那点时间不值这个误判,老老实实每次都写。
        saveUpload(req, res, path.join(dir, safe), `/_media/${encodeURIComponent(safe)}`)
      })

      server.middlewares.use('/api/export-status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(prog))
      })
      server.middlewares.use('/api/export', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        if (busy) {
          res.statusCode = 429
          res.end(JSON.stringify({ ok: false, error: '已有导出任务在进行中' }))
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          busy = true
          try {
            const job = JSON.parse(body || '{}')
            job.base = `http://localhost:${server.config.server.port ?? 5177}`
            const jobFile = path.join(os.tmpdir(), `overlay-export-${Date.now()}.json`)
            fs.writeFileSync(jobFile, JSON.stringify(job))

            const child = spawn('node', ['scripts/export-frames.mjs', jobFile], {
              cwd: server.config.root,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
            prog = { running: true, stage: 'prep', frame: 0, total: 0, startedAt: Date.now(), framesAt: 0 }
            let out = ''
            let err = ''
            // 看门狗:子进程 15 分钟没有任何输出就当它假死,强制停掉。不设的话 busy 永远是 true,
            // 之后每次点导出都是「已有导出任务在进行中」,只能重启服务。15 分钟留给最慢的静默
            // 阶段(长视频抽帧、ProRes 合成都不打进度);脚本内部另有 30 秒的单帧超时兜常见情况。
            const IDLE_MS = 15 * 60_000
            const giveUp = () => {
              err +=
                '\n【导出失败原因】导出 15 分钟没有任何进展,已强制停止。多半是渲染器假死了:' +
                '重新导出一次;还不行就重启 npm run dev。'
              child.kill('SIGKILL')
            }
            let idle = setTimeout(giveUp, IDLE_MS)
            const kick = () => {
              clearTimeout(idle)
              idle = setTimeout(giveUp, IDLE_MS)
            }
            child.stdout.on('data', (d) => {
              kick()
              out += d
              process.stdout.write(`[export] ${d}`)
              // 从累计输出的尾部解析进度(行可能被分块截断,所以每次都从全文找最后一条)
              const m = [...out.matchAll(/progress (\d+)\/(\d+)/g)].pop()
              if (m) {
                prog.frame = Number(m[1])
                prog.total = Number(m[2])
                prog.stage = 'frames'
              }
              // 视频抽帧(长录屏要几分钟):单独一个阶段,别一直显示「启动渲染器」
              if (prog.stage === 'prep' && out.includes('extracting video frames'))
                prog.stage = 'extract'
              // 逐帧渲染开跑:记下时刻,「预计还需」只按这之后的耗时算
              if (!prog.framesAt && out.includes('rendering frames:')) {
                prog.framesAt = Date.now()
                prog.stage = 'frames'
              }
              if (out.includes('composing MOV')) prog.stage = 'mov'
              if (out.includes('composing WebM')) prog.stage = 'webm'
              if (out.includes('baking')) prog.stage = 'sfx'
            })
            child.stderr.on('data', (d) => {
              kick()
              err += d
            })
            child.on('close', (code) => {
              clearTimeout(idle)
              busy = false
              prog = { ...prog, running: false, stage: 'done', ok: code === 0 }
              fs.rmSync(jobFile, { force: true })
              res.setHeader('Content-Type', 'application/json')
              if (code === 0) {
                // 取脚本最后一行 JSON 作为结果
                const lines = out.trim().split('\n')
                res.end(lines[lines.length - 1])
              } else {
                res.statusCode = 500
                res.end(JSON.stringify({ ok: false, error: err.slice(-800) }))
              }
            })
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
          const name = path.basename(raw).replace(/[^\w.一-龥()-]/g, '_')
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
  plugins: [react(), overlayExport(), demoUpload(), reviewLog()],
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
