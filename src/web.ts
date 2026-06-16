// 后端服务：API + 托管前端（#7）。串起混合检索（#4）+ 多轮记忆（#5）+ 联网兜底（#6）。
// 复用已有 standardsAgent，Node 内置 http：
//   POST /api/chat  → {message, threadId} → 调 Agent，返回流式答案（SSE）
//   GET  /*         → 托管 ui/dist 的静态前端（SPA，未构建时给提示）
// 前端代码在 ui/（Vite + React，专业暗色三栏工作台）。
//   开发：npm run dev（本服务 :4111 + Vite :5173，/api 由 Vite 代理过来）
//   生产：npm run ui:build 出 ui/dist，再 npm run web，本页直接托管
// 同一会话用一个 threadId 贯穿多轮，记忆落在与向量库同一个 libSQL 文件。

import 'dotenv/config'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai'
import { mastra, GENERATE_MAX_STEPS } from './mastra/index.js'
import { loadCorpusFresh } from './lib/corpus.js'
import { aggregateLibrary } from './lib/library.js'

const PORT = Number(process.env.PORT) || 4111
const RESOURCE_ID = 'web-user'

const DIST = join(process.cwd(), 'ui', 'dist')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

// 托管 ui/dist；找不到具体文件时回退 index.html（SPA）。未构建时给一句提示。
async function serveStatic(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  if (!existsSync(join(DIST, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h1>前端尚未构建</h1><p>开发：<code>npm run dev</code>（Vite :5173）。<br>生产：<code>npm run ui:build</code> 后再访问本页。</p>')
    return
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = join(DIST, normalize(urlPath))
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (urlPath === '/' || !existsSync(filePath)) filePath = join(DIST, 'index.html')
  try {
    const data = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const agent = mastra.getAgent('standardsAgent')

// 从 useChat 发来的 body 里取出最后一条用户消息的纯文本。
// 前端 transport 只发 {messages:[最新一条], threadId}（服务端记忆为准，ADR-0006）；
// 这里取最后一条 user 消息，无论前端发整段还是只发最新都成立。
function lastUserText(messages: any[]): string {
  const u = [...messages].reverse().find((m) => m?.role === 'user')
  if (!u) return ''
  const fromParts = (u.parts ?? [])
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => p.text)
    .join('')
  return fromParts || u.content || ''
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    const t0 = Date.now()
    let q = ''
    try {
      const body = JSON.parse(await readBody(req))
      const threadId: string | undefined = body.threadId
      const text = lastUserText(body.messages ?? [])
      if (!text || !threadId) throw new Error('缺少 message 或 threadId')
      q = text

      // Mastra 1.42 的 agent.stream 返回 MastraModelOutput（非 AI SDK 格式），
      // 故用 ai 的 createUIMessageStream 把 fullStream 桥接成 AI SDK UI-message 流，
      // 再 pipe 到 Node res，让前端 useChat / ai-elements 原生消费（ADR-0006）。
      const result = await agent.stream(text, {
        memory: { thread: threadId, resource: RESOURCE_ID },
        maxSteps: GENERATE_MAX_STEPS,
      })

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const id = 'txt'
          let started = false
          let full = ''
          for await (const chunk of result.fullStream as AsyncIterable<any>) {
            if (chunk.type === 'text-delta') {
              const delta = chunk.payload?.text ?? ''
              if (!delta) continue
              if (!started) {
                writer.write({ type: 'text-start', id })
                started = true
              }
              full += delta
              writer.write({ type: 'text-delta', id, delta })
            } else if (chunk.type === 'tool-call') {
              // 工具调用 → tool part（证据面板/ai-elements Tool 渲染检索/联网轨迹）
              const p = chunk.payload
              writer.write({
                type: 'tool-input-available',
                toolCallId: p.toolCallId,
                toolName: p.toolName,
                input: p.args ?? {},
              })
            } else if (chunk.type === 'tool-result') {
              // 工具结果 → tool output（前端解析其中的「标准号｜表名｜第X页」生成来源 chips）
              const p = chunk.payload
              writer.write({ type: 'tool-output-available', toolCallId: p.toolCallId, output: p.result })
            }
          }
          // 检索步数用尽时 text 为空，补一句兜底，别留空气泡。
          if (!full.trim()) {
            if (!started) {
              writer.write({ type: 'text-start', id })
              started = true
            }
            writer.write({
              type: 'text-delta',
              id,
              delta: '这次没能整理出答案（检索步数可能用尽）。把问题问得更具体些，或再试一次。',
            })
          }
          if (started) writer.write({ type: 'text-end', id })
          console.log(`[chat] ${Date.now() - t0}ms len=${full.length} q=${JSON.stringify(text)}`)
        },
        onError: (err) => {
          console.error('[chat] stream 出错:', err)
          return err instanceof Error ? err.message : String(err)
        },
      })

      pipeUIMessageStreamToResponse({ response: res, stream })
    } catch (err) {
      console.error(`[chat] ${Date.now() - t0}ms 出错 q=${JSON.stringify(q)}:`, err)
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: msg }))
      } else {
        res.end()
      }
    }
    return
  }

  // 资料库列表（#11）：直读 libSQL，按标准号聚合（一行一标准，含页数/块数/状态）。
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/api/library') {
    try {
      const corpus = await loadCorpusFresh()
      const library = aggregateLibrary(corpus)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(library))
    } catch (err) {
      console.error('[library] 出错:', err)
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
    return
  }

  if (req.method === 'GET') {
    await serveStatic(req, res)
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
})

server.listen(PORT, () => {
  console.log(`[web] 国标问答服务已启动：http://localhost:${PORT}`)
})
