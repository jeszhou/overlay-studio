import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
      // 所以它同时可以当运镜卡的「口播视频」用。同名同大小就直接复用,不重复拷。
      server.middlewares.use('/api/media', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{"ok":false}'); return }
        const raw = String(req.headers['x-filename'] ?? 'video')
        const size = Number(req.headers['content-length'] ?? 0)
        // 文件名只留安全字符,防止 ../ 之类写到目录外
        const safe = decodeURIComponent(raw).replace(/[^\w.\-\u4e00-\u9fff]/g, '_').slice(-80)
        const dir = path.join(server.config.root, 'public', '_media')
        fs.mkdirSync(dir, { recursive: true })
        const dest = path.join(dir, safe)
        const url = `/_media/${encodeURIComponent(safe)}`
        if (fs.existsSync(dest) && size && fs.statSync(dest).size === size) {
          res.end(JSON.stringify({ ok: true, url, reused: true }))
          req.resume()
          return
        }
        const tmp = `${dest}.part`
        const ws = fs.createWriteStream(tmp)
        req.pipe(ws)
        ws.on('finish', () => {
          fs.renameSync(tmp, dest)
          res.end(JSON.stringify({ ok: true, url }))
        })
        ws.on('error', (e) => {
          fs.rmSync(tmp, { force: true })
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        })
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
            child.stdout.on('data', (d) => {
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
            child.stderr.on('data', (d) => (err += d))
            child.on('close', (code) => {
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
          const dest = path.join(dir, name)
          // 先写临时文件再改名:用户在文件选择器里选中 public/demo 里的同名文件时,
          // 直接写 dest 会一边读一边截断源文件(自毁);临时文件+rename 则安全覆盖
          const tmp = `${dest}.uploading`
          const ws = fs.createWriteStream(tmp)
          req.pipe(ws)
          ws.on('finish', () => {
            fs.renameSync(tmp, dest)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, src: `/demo/${name}` }))
          })
          ws.on('error', (e) => {
            fs.rmSync(tmp, { force: true })
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          })
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
