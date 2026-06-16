// 国标问答工作台 —— 专业暗色 · 三栏（IDE 式）。
// 设计语言：深底、高密度、等宽数字、证据前置。三屏：登录(split) → 导入(库+日志) → 三栏对话(含证据面板)。
// 对话 /api/chat、上传入库 /api/ingest、资料库 /api/library、历史 /api/threads 均已接真。
import { useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Loader } from '@/components/ai-elements/loader'
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { useIngest } from './lib/useIngest'
import { useLibrary } from './lib/useLibrary'
import { useThreads } from './lib/useThreads'
import { SUGGESTIONS, INGEST_STAGES } from './lib/mockData'

export function Workbench() {
  const [authed, setAuthed] = useState(false)
  const [screen, setScreen] = useState<'chat' | 'upload'>('chat')

  if (!authed) return <Landing onLogin={() => setAuthed(true)} />

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-200">
      <header className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2 text-sm">
        <span className="flex items-center gap-2 font-semibold text-zinc-100">
          <span className="grid h-6 w-6 place-items-center rounded bg-emerald-500 text-xs text-zinc-950">标</span>
          国标问答 <span className="text-zinc-600">workbench</span>
        </span>
        <nav className="ml-2 flex gap-1">
          <TabBtn active={screen === 'chat'} onClick={() => setScreen('chat')}>检索台</TabBtn>
          <TabBtn active={screen === 'upload'} onClick={() => setScreen('upload')}>入库</TabBtn>
        </nav>
        <span className="ml-auto text-xs text-zinc-600">libSQL · text-embedding-3-small</span>
        <button onClick={() => setAuthed(false)} className="text-xs text-zinc-500 hover:text-zinc-200">退出</button>
      </header>
      {screen === 'chat' ? <Chat /> : <Upload />}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded px-2.5 py-1 ${active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
      {children}
    </button>
  )
}

function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-zinc-950 text-zinc-200 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-900/40 to-zinc-900 p-10 md:flex">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded bg-emerald-500 text-zinc-950">标</span>
          fastrag
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-snug text-zinc-50">防水卷材国标<br />检索工作台</h1>
          <p className="mt-3 max-w-sm text-sm text-zinc-400">混合检索（向量 + BM25 + 元数据过滤），指标行级命中，逐条标注标准号与页码。</p>
          <div className="mt-6 flex gap-6 font-mono text-sm text-zinc-500">
            <div><div className="text-2xl text-emerald-400">5</div>已入库标准</div>
            <div><div className="text-2xl text-emerald-400">726</div>指标块</div>
            <div><div className="text-2xl text-emerald-400">98</div>页</div>
          </div>
        </div>
        <div className="text-xs text-zinc-600">本地运行 · 数据不出库</div>
      </div>
      <div className="grid place-items-center p-8">
        <form
          onSubmit={(e) => { e.preventDefault(); onLogin() }}
          className="w-full max-w-sm space-y-4"
        >
          <h2 className="text-xl font-semibold text-zinc-100">登录</h2>
          <div>
            <label className="text-xs text-zinc-500">账号</label>
            <input className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" defaultValue="engineer@fastrag" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">密码</label>
            <input type="password" className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" defaultValue="demo" />
          </div>
          <button className="w-full rounded-md bg-emerald-500 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400">进入工作台</button>
          <p className="text-center text-xs text-zinc-600">原型演示 · 随便填直接进</p>
        </form>
      </div>
    </div>
  )
}

function Upload() {
  const { entries, error, refresh } = useLibrary()
  const { job, start, clear } = useIngest(refresh) // 入库完成后刷新资料库列表
  return (
    <div className="flex flex-1 overflow-hidden">
      <section className="w-72 flex-none overflow-y-auto border-r border-zinc-800 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          已入库 {entries && <span className="normal-case text-zinc-600">（{entries.length}）</span>}
        </div>
        {error && <div className="mb-1 rounded-md border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-400">加载失败：{error}</div>}
        {!entries && !error && <div className="text-xs text-zinc-600">加载中…</div>}
        {entries && entries.length === 0 && (
          <div className="rounded-md border border-dashed border-zinc-800 p-3 text-xs text-zinc-600">库内暂无标准，右侧上传 PDF 入库。</div>
        )}
        {entries?.map((d) => (
          <div key={d.code} className="mb-1 rounded-md border border-zinc-800 bg-zinc-900 p-2.5 text-sm">
            <div className="truncate font-medium text-zinc-200">{d.code}</div>
            <div className="truncate text-xs text-zinc-500">{d.name}</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-zinc-600">
              <span>{d.pages}p</span><span>·</span><span>{d.chunks} chunks</span>
              <span className={`ml-auto rounded px-1.5 ${d.status === '废止' ? 'bg-zinc-800 text-zinc-500' : 'bg-emerald-500/15 text-emerald-400'}`}>{d.status}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex-1 overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-zinc-100">入库新标准</h2>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 py-10 text-center hover:border-emerald-500/60">
          <span className="text-2xl">⬆</span>
          <span className="text-sm text-zinc-300">拖拽 PDF 或点击选择</span>
          <span className="font-mono text-xs text-zinc-600">pdf/*.pdf → OCR → chunk → embed → upsert</span>
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = '' }} />
        </label>

        {job && (
          <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 font-mono text-sm">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-zinc-300">
              <span className="truncate">$ ingest "{job.fileName}"</span>
              <button onClick={clear} className="text-xs text-zinc-500 hover:text-zinc-300">clear</button>
            </div>
            <div className="space-y-1 p-4">
              {INGEST_STAGES.map((s, i) => {
                const state = job.stage > i || job.done ? 'done' : job.stage === i ? 'active' : 'todo'
                return (
                  <div key={s.key} className="flex items-start gap-2 text-[13px]">
                    <span className={state === 'done' ? 'text-emerald-400' : state === 'active' ? 'text-amber-400' : 'text-zinc-700'}>
                      {state === 'done' ? '✓' : state === 'active' ? '▸' : '·'}
                    </span>
                    <div>
                      <span className={state === 'todo' ? 'text-zinc-700' : 'text-zinc-200'}>{s.label}</span>
                      {state === 'active' && <span className="ml-2 animate-pulse text-amber-400">running…</span>}
                      <div className="text-[11px] text-zinc-600">{s.detail}</div>
                    </div>
                  </div>
                )
              })}
              {job.done && <div className="mt-2 text-emerald-400">✓ done — upserted {job.chunks} chunks / {job.pages} pages</div>}
              {job.error && <div className="mt-2 text-red-400">✗ 入库失败：{job.error}</div>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// 时间戳 → 简短中文（今天显示时:分，往前显示月-日）。
function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// —— UIMessage parts 工具函数 ——
type AnyPart = { type: string; text?: string; toolName?: string; state?: string; input?: unknown; output?: unknown; errorText?: string }

const textOf = (m: UIMessage) =>
  (m.parts as AnyPart[]).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')

const toolPartsOf = (m: UIMessage) =>
  (m.parts as AnyPart[]).filter((p) => p.type === 'dynamic-tool' || p.type.startsWith('tool-'))

const toolNameOf = (p: AnyPart) => (p.type === 'dynamic-tool' ? p.toolName ?? '' : p.type.replace(/^tool-/, ''))

interface Source { code: string; table: string; page: string; web: boolean }

// 从 tool-output 字符串解析来源（hybridQueryTool 的 formatHits 是确定格式 `[标准号｜表名｜第X页]`，
// 比解析模型自由措辞稳；ADR-0006）。webSearchTool 命中则记一条「联网」。
function parseSources(parts: AnyPart[]): Source[] {
  const out: Source[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const web = toolNameOf(p) === 'webSearchTool'
    if (web) {
      if (p.output && !seen.has('web')) {
        seen.add('web')
        out.push({ code: '联网结果', table: '', page: '', web: true })
      }
      continue
    }
    const output = typeof p.output === 'string' ? p.output : ''
    const re = /\[([^｜\]]+)｜([^｜\]]+)｜第\s*([\d、,，\-]+)\s*页\]/g
    let mt: RegExpExecArray | null
    while ((mt = re.exec(output))) {
      const code = mt[1].trim()
      const table = mt[2].trim()
      const page = mt[3].trim()
      const key = code + '|' + page
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ code, table, page, web: false })
    }
  }
  return out
}

const newThreadId = () => 'web-' + Math.random().toString(36).slice(2)

function Chat() {
  const threadId = useRef(newThreadId())
  const transport = useRef(
    new DefaultChatTransport({
      api: '/api/chat',
      // 服务端记忆为准（ADR-0006）：只发最新一条 + threadId，历史靠后端 Mastra memory 续。
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages: messages.slice(-1), threadId: threadId.current },
      }),
    }),
  )
  // 首条用户消息落库后会派生出标题，发完刷新左栏让新会话冒出来（#12）。
  const { threads, refresh: refreshThreads } = useThreads()
  const { messages, status, sendMessage, setMessages } = useChat({
    transport: transport.current,
    onFinish: () => refreshThreads(),
  })
  const [activeId, setActiveId] = useState(threadId.current)

  // 切到某历史会话：把它的消息 seed 进 useChat，并把 threadId 切过去续聊（多轮记忆延续到该 thread）。
  async function openThread(id: string) {
    threadId.current = id
    setActiveId(id)
    try {
      const res = await fetch('/api/messages?threadId=' + encodeURIComponent(id))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMessages((await res.json()) as UIMessage[])
    } catch {
      setMessages([])
    }
  }

  // 新会话：开一个新 threadId、清空对话。
  function newChat() {
    threadId.current = newThreadId()
    setActiveId(threadId.current)
    setMessages([])
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastTools = lastAssistant ? toolPartsOf(lastAssistant) : []
  const sources = parseSources(lastTools)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左：会话 + 库 */}
      <aside className="w-56 flex-none overflow-y-auto border-r border-zinc-800 p-3 text-sm">
        <button onClick={newChat} className="mb-3 w-full rounded-md border border-zinc-700 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">+ 新会话</button>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">历史</div>
        {!threads && <div className="px-2 text-xs text-zinc-600">加载中…</div>}
        {threads && threads.length === 0 && <div className="px-2 text-xs text-zinc-600">暂无历史会话。</div>}
        {threads?.map((s) => (
          <button
            key={s.id}
            onClick={() => openThread(s.id)}
            className={`mb-0.5 block w-full truncate rounded px-2 py-1.5 text-left hover:bg-zinc-800 ${s.id === activeId ? 'bg-zinc-800' : ''}`}
          >
            <span className="text-zinc-300">{s.title}</span>
            <span className="block truncate text-xs text-zinc-600">{fmtWhen(s.updatedAt)}</span>
          </button>
        ))}
      </aside>

      {/* 中：对话（ai-elements） */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 && (
              <div className="mx-auto max-w-lg pt-10">
                <div className="mb-2 text-sm text-zinc-500">试试这些：</div>
                <Suggestions>
                  {SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={(t) => sendMessage({ text: t })} />
                  ))}
                </Suggestions>
              </div>
            )}
            {messages.map((m) => (
              <Message from={m.role} key={m.id}>
                <MessageContent>
                  {m.role === 'assistant' ? <MessageResponse>{textOf(m)}</MessageResponse> : textOf(m)}
                </MessageContent>
              </Message>
            ))}
            {status === 'submitted' && <Loader />}
          </ConversationContent>
        </Conversation>
        <div className="border-t border-zinc-800 p-3">
          <PromptInput
            onSubmit={(msg) => {
              if (msg.text?.trim()) sendMessage({ text: msg.text })
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder="检索国标…（Enter 发送）" />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputSubmit status={status} className="ml-auto" />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>

      {/* 右：证据面板（接原生 tool parts） */}
      <aside className="w-80 flex-none overflow-y-auto border-l border-zinc-800 bg-zinc-900/40 p-4 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">检索轨迹</div>
        {lastTools.length > 0 ? (
          <div className="mt-2 space-y-2">
            {lastTools.map((p, i) => (
              <Tool key={i} defaultOpen={false}>
                <ToolHeader type={p.type as `tool-${string}`} state={p.state as never} />
                <ToolContent>
                  <ToolInput input={p.input} />
                  <ToolOutput output={p.output} errorText={p.errorText} />
                </ToolContent>
              </Tool>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-zinc-600">提问后这里显示库内/联网检索过程。</p>
        )}

        <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">来源引用</div>
        {sources.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {sources.map((s, i) => (
              <li key={i} className={`rounded-md border px-2.5 py-2 text-xs ${s.web ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
                <div className="font-medium">{s.web ? '🌐 联网' : '📑 国标库'}</div>
                <div className="font-mono">{s.code}{s.page ? ` · 第 ${s.page} 页` : ''}{s.table ? ` · ${s.table}` : ''}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-600">答案里的标准号/页码会自动汇到这里。</p>
        )}
      </aside>
    </div>
  )
}
