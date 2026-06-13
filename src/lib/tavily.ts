// 联网兜底（#6）：知识库检索不到时，Agent 调 Tavily 搜索补充。
// 用 Node 全局 fetch 直连 Tavily REST API，不引第三方 SDK（Simplicity First）。
// 所有联网结果都打「联网来源」标记，便于 Agent 在答案里区分库内/联网渠道。

export interface TavilyResult {
  title: string
  url: string
  content: string
}

export interface TavilyResponse {
  answer?: string | null
  results: TavilyResult[]
}

/** 把 Tavily 返回整理成给 Agent 读的文本，并显式标注「联网来源」。纯函数，可单测。 */
export function formatTavilyResults(data: TavilyResponse): string {
  const { answer, results } = data

  if (!results || results.length === 0) {
    return '【联网搜索（联网来源）】未找到相关网页。'
  }

  const lines: string[] = ['【联网搜索结果 · 联网来源】']
  if (answer) {
    lines.push(`综述：${answer}`)
  }
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}\n   链接：${r.url}\n   摘要：${r.content}`)
  })
  return lines.join('\n')
}

/** 调 Tavily Search API 并返回整理后的文本。网络调用，不做 TDD，集成时手测。 */
export async function tavilySearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('缺少 TAVILY_API_KEY（见 .env.example）')
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: true,
    }),
  })

  if (!res.ok) {
    throw new Error(`Tavily 请求失败：${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as TavilyResponse
  return formatTavilyResults(data)
}
