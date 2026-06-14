// 混合检索编排（集成层，含 embedding 网络 + 库读取，不做 TDD）。
// 流程：query embedding → 向量召回（over-fetch 后内存过滤，绕开 libSQL 中文 key filter）
//      + BM25 关键词召回（在过滤后的语料上）→ RRF 融合 → 取 topK。
// 元数据过滤对两路都生效，让指标问答能按 {标准号,表名,指标名,页码,状态} 收窄。

import { embed } from 'ai'
import { embedModel, INDEX_NAME } from './openrouter.js'
import { loadCorpus, type CorpusChunk } from './corpus.js'
import { buildBm25, bm25Search } from './bm25.js'
import { rrfFuse, matchesFilter, sanitizeFilter, type ChunkFilter, type ChunkMeta } from './hybrid.js'

const VEC_RECALL = 40
const BM25_RECALL = 40

export interface HybridHit {
  id: string
  text: string
  metadata: ChunkMeta
}

interface VectorStore {
  query(args: { indexName: string; queryVector: number[]; topK: number }): Promise<{ id: string }[]>
}

export async function hybridSearch(
  vectorStore: VectorStore,
  opts: { query: string; filter?: ChunkFilter; topK?: number },
): Promise<HybridHit[]> {
  const { query, topK = 6 } = opts
  // 收窄过滤器：禁止用 状态=现行 反向排除（否则会漏掉废止标准，违反硬约束⑥）。
  const filter = sanitizeFilter(opts.filter ?? {})
  const corpus = await loadCorpus()

  // 向量召回与过滤无关：query 不变，embedding/向量查询只做一次，过滤回退时复用。
  const { embedding } = await embed({ model: embedModel, value: query })
  const vec = await vectorStore.query({ indexName: INDEX_NAME, queryVector: embedding, topK: VEC_RECALL })

  // 过滤先行：BM25 在过滤后的语料上 build（语料小，每次 build 开销可忽略），
  // 向量路用同一份 byId 过滤，两路口径一致。
  const run = (f: ChunkFilter): HybridHit[] => {
    const filtered: CorpusChunk[] = corpus.filter((c) => matchesFilter(c.metadata, f))
    const byId = new Map(filtered.map((c) => [c.id, c]))
    const vecIds = vec.map((r) => r.id).filter((id) => byId.has(id))
    const bm25 = buildBm25(filtered.map((c) => ({ id: c.id, text: c.text })))
    const kwIds = bm25Search(bm25, query, BM25_RECALL).map((r) => r.id)
    return rrfFuse([vecIds, kwIds])
      .slice(0, topK)
      .map(({ id }) => {
        const c = byId.get(id)!
        return { id, text: c.text, metadata: c.metadata }
      })
  }

  const hits = run(filter)
  // 过滤命中为空（多半是 LLM 把标准号/表名猜错），自动回退无过滤检索，靠混合召回保底。
  if (hits.length === 0 && Object.keys(filter).length > 0) return run({})
  return hits
}
