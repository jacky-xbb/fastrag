// 共享路由：HTTP 处理逻辑收口在这里，由 Node 入口（src/server.ts）注入外部能力后复用。
// 对外部能力（对象存储 / 入库任务 / 静态资源）只依赖下方 AppEnv 最小结构接口，
// 入口用本地实现（fs-bucket / ingest-runner / serveStatic）结构满足它。
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { MessageList } from '@mastra/core/agent/message-list'
import { getMastra, getMemory, GENERATE_MAX_STEPS } from './mastra/index.js'
import { loadCorpusFresh } from './lib/corpus.js'
import { aggregateLibrary } from './lib/library.js'
import { firstUserText, deriveThreadTitle } from './lib/threads.js'
import { safePdfName } from './lib/ingest-upload.js'
import {
  authConfigured,
  checkCredentials,
  issueToken,
  authedUser,
  sessionCookie,
  clearedCookie,
} from './lib/auth.js'

/** 入口注入的外部能力（结构最小化，入口用本地实现满足）。 */
export interface AppEnv {
  BUCKET: {
    put(key: string, value: Uint8Array | string): Promise<unknown>
    get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>
  }
  INGEST_WORKFLOW: {
    create(o: { id: string; params: { fileName: string; r2Key: string; statusKey: string } }): Promise<unknown>
    get(id: string): Promise<{ status(): Promise<{ status: string }> }>
  }
  ASSETS: { fetch(req: Request): Promise<Response> }
}

const RESOURCE_ID = 'web-user'
const JSON_CT = { 'content-type': 'application/json; charset=utf-8' }
// 单文件上限 100MB：整份 PDF 会读进内存（机器 2G），超限直接拒，别等 OOM。
const MAX_PDF_MB = 100
const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024

const json = (code: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status: code, headers: JSON_CT })

// 取某会话历史消息，转成 AI SDK v6 UIMessage（前端 seed useChat，ADR-0006）。
async function threadUIMessages(threadId: string) {
  const { messages } = await getMemory().recall({ threadId, resourceId: RESOURCE_ID, perPage: false })
  const list = new MessageList({ threadId, resourceId: RESOURCE_ID })
  list.add(messages, 'memory')
  return list.get.all.aiV6.ui()
}

// 从 useChat 发来的 body 里取最后一条用户消息的纯文本（前端只发最新一条，服务端记忆为准）。
function lastUserText(messages: any[]): string {
  const u = [...messages].reverse().find((m) => m?.role === 'user')
  if (!u) return ''
  const fromParts = (u.parts ?? [])
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => p.text)
    .join('')
  return fromParts || u.content || ''
}

async function handleChat(req: Request): Promise<Response> {
  const t0 = Date.now()
  let q = ''
  try {
    const body = (await req.json()) as { threadId?: string; messages?: any[] }
    const threadId = body.threadId
    const text = lastUserText(body.messages ?? [])
    if (!text || !threadId) return json(400, { error: '缺少 message 或 threadId' })
    q = text

    // Mastra 1.42 的 agent.stream 返回 MastraModelOutput（非 AI SDK 格式），
    // 用 ai 的 createUIMessageStream 把 fullStream 桥接成 UI-message 流（ADR-0006）。
    const agent = getMastra().getAgent('standardsAgent')
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
            const p = chunk.payload
            writer.write({
              type: 'tool-input-available',
              toolCallId: p.toolCallId,
              toolName: p.toolName,
              input: p.args ?? {},
            })
          } else if (chunk.type === 'tool-result') {
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

    return createUIMessageStreamResponse({ stream })
  } catch (err) {
    console.error(`[chat] ${Date.now() - t0}ms 出错 q=${JSON.stringify(q)}:`, err)
    return json(500, { error: err instanceof Error ? err.message : String(err) })
  }
}

// PDF 上传入库（#10）：PDF 字节为请求体，文件名走 ?name=。
// 存进对象存储 → 启动入库任务（OCR→切块→embed→upsert，自带持久/重试）→ 返回 instanceId。
// 前端轮询 /api/ingest/status 读入库任务写的进度。
async function handleIngest(req: Request, env: AppEnv, url: URL): Promise<Response> {
  let fileName = ''
  try {
    fileName = safePdfName(url.searchParams.get('name') || '')
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : String(err) })
  }
  // Content-Length 预检：超限早拒，避免把超大上传整个读进内存。
  const declared = Number(req.headers.get('content-length') || 0)
  const tooBig = (n: number) => json(413, { error: `文件过大（${(n / 1048576).toFixed(1)}MB），上限 ${MAX_PDF_MB}MB` })
  if (declared > MAX_PDF_BYTES) return tooBig(declared)
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength === 0) return json(400, { error: '上传内容为空' })
  if (bytes.byteLength > MAX_PDF_BYTES) return tooBig(bytes.byteLength) // 无 content-length 时的兜底

  const id = crypto.randomUUID()
  const r2Key = `pdf/${fileName}`
  const statusKey = `ingest_status/${id}.json`
  await env.BUCKET.put(r2Key, bytes)
  await env.BUCKET.put(statusKey, JSON.stringify({ stage: 'upload' }))
  await env.INGEST_WORKFLOW.create({ id, params: { fileName, r2Key, statusKey } })
  return json(200, { id, fileName })
}

// 入库进度：先读入库任务写在对象存储的进度 JSON；缺失则回退查任务实例状态。
async function handleIngestStatus(env: AppEnv, url: URL): Promise<Response> {
  const id = url.searchParams.get('id')
  if (!id) return json(400, { error: '缺少 id' })
  const obj = await env.BUCKET.get(`ingest_status/${id}.json`)
  if (obj) return new Response(await obj.text(), { headers: JSON_CT })
  try {
    const inst = await env.INGEST_WORKFLOW.get(id)
    const st = await inst.status()
    const stage = st.status === 'complete' ? 'done' : st.status === 'errored' ? 'error' : 'running'
    return json(200, { stage })
  } catch {
    return json(404, { error: '未找到入库任务' })
  }
}

export async function handleApi(req: Request, env: AppEnv, url: URL): Promise<Response> {
  const path = url.pathname
  const method = req.method
  const cookie = req.headers.get('cookie')

  // —— 鉴权（ADR-0007）：单 admin、httpOnly 签名 cookie ——
  if (method === 'POST' && path === '/api/login') {
    if (!authConfigured())
      return json(500, { error: '鉴权未配置：请设置 ADMIN_USER/ADMIN_PASSWORD/SESSION_SECRET' })
    try {
      const { user, password } = (await req.json()) as { user?: string; password?: string }
      if (!checkCredentials(String(user ?? ''), String(password ?? '')))
        return json(401, { error: '账号或密码错误' })
      return new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { ...JSON_CT, 'set-cookie': sessionCookie(issueToken()) },
      })
    } catch {
      return json(400, { error: '请求格式错误' })
    }
  }
  if (method === 'POST' && path === '/api/logout') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...JSON_CT, 'set-cookie': clearedCookie() },
    })
  }
  if (path === '/api/me') {
    const user = authedUser(cookie)
    return user ? json(200, { user }) : json(401, { error: '未登录' })
  }
  // 其余 /api/* 一律要登录。
  if (!authedUser(cookie)) return json(401, { error: '未登录' })

  if (method === 'POST' && path === '/api/chat') return handleChat(req)
  if (method === 'POST' && path === '/api/ingest') return handleIngest(req, env, url)
  if (method === 'GET' && path === '/api/ingest/status') return handleIngestStatus(env, url)

  // 资料库列表（#11）：直读 libSQL，按标准号聚合。
  if (method === 'GET' && path === '/api/library') {
    try {
      const library = aggregateLibrary(await loadCorpusFresh())
      return json(200, library)
    } catch (err) {
      console.error('[library] 出错:', err)
      return json(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // 历史会话列表（#12）：标题优先用存储的，否则从首条提问派生；空会话剔除。
  if (method === 'GET' && path === '/api/threads') {
    try {
      const { threads } = await getMemory().listThreads({
        filter: { resourceId: RESOURCE_ID },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: false,
      })
      const summaries = await Promise.all(
        threads.map(async (t) => {
          const ui = await threadUIMessages(t.id)
          const text = firstUserText(ui)
          if (!text) return null
          return {
            id: t.id,
            title: t.title && t.title.trim() ? t.title.trim() : deriveThreadTitle(text),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          }
        }),
      )
      return json(200, summaries.filter(Boolean))
    } catch (err) {
      console.error('[threads] 出错:', err)
      return json(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // 改会话标题：PATCH /api/threads/:id，body {title}。
  if (method === 'PATCH' && path.startsWith('/api/threads/')) {
    try {
      const id = decodeURIComponent(path.slice('/api/threads/'.length))
      if (!id) return json(400, { error: '缺少 threadId' })
      const { title } = (await req.json()) as { title?: string }
      const clean = deriveThreadTitle(String(title ?? ''))
      if (!clean || clean === '新会话') return json(400, { error: '标题不能为空' })
      const thread = await getMemory().getThreadById({ threadId: id })
      if (!thread) return json(404, { error: '会话不存在' })
      await getMemory().updateThread({ id, title: clean, metadata: thread.metadata ?? {} })
      return json(200, { id, title: clean })
    } catch (err) {
      console.error('[threads:patch] 出错:', err)
      return json(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // 删会话：DELETE /api/threads/:id。
  if (method === 'DELETE' && path.startsWith('/api/threads/')) {
    try {
      const id = decodeURIComponent(path.slice('/api/threads/'.length))
      if (!id) return json(400, { error: '缺少 threadId' })
      await getMemory().deleteThread(id)
      return json(200, { id })
    } catch (err) {
      console.error('[threads:delete] 出错:', err)
      return json(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // 某会话历史消息（#12）：AI SDK v6 UIMessage 形状。
  if (method === 'GET' && path === '/api/messages') {
    try {
      const threadId = url.searchParams.get('threadId')
      if (!threadId) return json(400, { error: '缺少 threadId' })
      return json(200, await threadUIMessages(threadId))
    } catch (err) {
      console.error('[messages] 出错:', err)
      return json(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  return json(404, { error: 'Not Found' })
}

// 分发：/api/* 进 handleApi，其余交给 ASSETS（SPA 回退 index.html）。两个入口共用。
export async function dispatch(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) return handleApi(req, env, url)
  return env.ASSETS.fetch(req)
}
