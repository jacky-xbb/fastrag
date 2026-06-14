// 混合检索的纯逻辑（ADR-0004 硬约束②③）：
// RRF 融合多路召回 + 元数据过滤 + 命中结果格式化（废止块显式标「已作废」，硬约束⑥）。
// 元数据用中文 key，libSQL 的 filter 解析不了中文 key（会报 Invalid field key），
// 故过滤在内存里做，绕开这个 bug。纯函数，可单测。

export interface ChunkMeta {
  标准号: string
  表名: string
  指标名: string
  页码: number
  状态: string
  [k: string]: unknown
}

export interface ChunkFilter {
  标准号?: string
  表名?: string
  指标名?: string
  页码?: number
  状态?: string
}

/** Reciprocal Rank Fusion：多路排名按 1/(k+rank) 累加重排，k=60 为常用默认。 */
export function rrfFuse(rankings: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

/** 归一化：小写 + 去掉空格/标点等非字母数字与非中文字符。
 *  让「jc684」对上库里「JC 684-1997」、「GB/T 23457」对上「GB/T 23457-2017」。 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '')
}

/** 元数据过滤：页码按数值精确；字符串字段归一化后大小写/标点无关子串匹配。 */
export function matchesFilter(meta: ChunkMeta, filter: ChunkFilter): boolean {
  for (const [key, want] of Object.entries(filter)) {
    if (want == null || want === '') continue
    const got = meta[key]
    if (typeof want === 'number') {
      if (got !== want) return false
    } else if (!norm(String(got ?? '')).includes(norm(String(want)))) {
      return false
    }
  }
  return true
}

/** 收窄过滤器，给不可控的调用方（如 LLM 填参）兜底（硬约束⑥）：
 *  状态只允许「废止」作正向收窄（专门查作废标准）；现行/有效等反向排除一律丢弃，
 *  防止模型默认填 状态=现行 把废止标准漏掉。其余字段原样保留。 */
export function sanitizeFilter(filter: ChunkFilter): ChunkFilter {
  const out: ChunkFilter = { ...filter }
  if (out.状态 != null && !norm(out.状态).includes('废止')) delete out.状态
  return out
}

/** 把命中块整理成给 Agent 读的文本：每条带来源锚点，废止块显式标「已作废」。 */
export function formatHits(hits: { text: string; metadata: ChunkMeta }[]): string {
  if (hits.length === 0) return '【国标库】未检索到相关内容。'
  const lines = ['【国标库检索结果 · 国标库来源】']
  hits.forEach((h, i) => {
    const m = h.metadata
    const deprecated = m.状态 === '废止' ? '（该标准已作废）' : ''
    const where = `${m.标准号}${deprecated}｜${m.表名 || '正文'}｜第 ${m.页码} 页`
    lines.push(`${i + 1}. [${where}]\n${h.text}`)
  })
  return lines.join('\n\n')
}
