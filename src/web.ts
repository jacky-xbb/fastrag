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
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai'
import { MessageList } from '@mastra/core/agent/message-list'
import { mastra, memory, GENERATE_MAX_STEPS } from './mastra/index.js'
import { loadCorpusFresh } from './lib/corpus.js'
import { aggregateLibrary } from './lib/library.js'
import { firstUserText, deriveThreadTitle } from './lib/threads.js'
import { safePdfName } from './lib/ingest-upload.js'
import { ensureIndex, cachedOcrPages, chunkPages, upsertRecords } from './lib/ingest-pipeline.js'

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

// 上传的 PDF 是二进制，按 Buffer 收集（按字符串拼会损坏字节）。
function readBodyBuffer(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const agent = mastra.getAgent('standardsAgent')

// 取某会话的历史消息，转成 AI SDK v6 UIMessage（便于前端 seed useChat，ADR-0006）。
// recall 按时间升序返回（user→assistant…），MessageList 再桥接成 ui parts。
async function threadUIMessages(threadId: string) {
  const { messages } = await memory.recall({ threadId, resourceId: RESOURCE_ID, perPage: false })
  const list = new MessageList({ threadId, resourceId: RESOURCE_ID })
  list.add(messages, 'memory')
  return list.get.all.aiV6.ui()
}

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

  // PDF 上传入库（#10）：原始 PDF 字节为请求体，文件名走 ?name=。
  // 复用入库管线（OCR→指标行切块→embed→upsert，ADR-0003/0004），按 NDJSON 逐阶段推真实进度：
  //   {type:'stage', stage:'upload'|'ocr'|'chunk'|'embed'|'upsert'} … {type:'done', pages, chunks} | {type:'error', message}
  // 上传的 PDF 落到 pdf/（与语料源同处，OCR 缓存按 basename，重复上传命中缓存 + id 幂等覆盖、不重复块）。
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/api/ingest') {
    const t0 = Date.now()
    let fileName = ''
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    })
    const send = (ev: Record<string, unknown>) => res.write(JSON.stringify(ev) + '\n')
    try {
      const rawName = new URL(req.url || '', 'http://localhost').searchParams.get('name') || ''
      fileName = safePdfName(rawName)
      const buf = await readBodyBuffer(req)
      if (buf.length === 0) throw new Error('上传内容为空')

      send({ type: 'stage', stage: 'upload' })
      const pdfPath = join(process.cwd(), 'pdf', fileName)
      await writeFile(pdfPath, buf)
      await ensureIndex()

      send({ type: 'stage', stage: 'ocr' })
      const pages = await cachedOcrPages(pdfPath)

      send({ type: 'stage', stage: 'chunk' })
      const records = chunkPages(pages, fileName)

      let lastStage = ''
      await upsertRecords(records, (stage) => {
        if (stage !== lastStage) {
          lastStage = stage
          send({ type: 'stage', stage })
        }
      })

      send({ type: 'done', pages: pages.length, chunks: records.length })
      console.log(
        `[ingest] ${Date.now() - t0}ms ${fileName}：${pages.length} 页 / ${records.length} 块入库`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ingest] ${Date.now() - t0}ms 出错 file=${JSON.stringify(fileName)}:`, err)
      send({ type: 'error', message: msg })
    } finally {
      res.end()
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

  // 历史会话列表（#12）：列出 web-user 的会话，标题由首条用户消息派生，按更新时间倒序。
  // 标题在库里为空（未开 generateTitle），故逐会话取消息派生；无用户消息的空会话剔除。
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/api/threads') {
    try {
      const { threads } = await memory.listThreads({
        filter: { resourceId: RESOURCE_ID },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: false,
      })
      const summaries = await Promise.all(
        threads.map(async (t) => {
          const ui = await threadUIMessages(t.id)
          const text = firstUserText(ui)
          if (!text) return null // 空会话（无用户消息）不进列表
          return {
            id: t.id,
            title: deriveThreadTitle(text),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          }
        }),
      )
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(summaries.filter(Boolean)))
    } catch (err) {
      console.error('[threads] 出错:', err)
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
    return
  }

  // 某会话的历史消息（#12）：AI SDK v6 UIMessage 形状，前端用来 seed useChat。
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/api/messages') {
    try {
      const threadId = new URL(req.url || '', 'http://localhost').searchParams.get('threadId')
      if (!threadId) throw new Error('缺少 threadId')
      const ui = await threadUIMessages(threadId)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(ui))
    } catch (err) {
      console.error('[messages] 出错:', err)
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
