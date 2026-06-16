// 读取 libSQL 里已入库的全部块（text + 元数据），供 BM25 关键词召回用。
// LibSQLVector 没有「列出全部」的 public API，直接读其存储表（standards）：
// 列 vector_id = 块 id，metadata = 入库时写的 JSON（含 text 与中文元数据字段）。
// 进程内缓存：同一次运行只读一次库。集成/IO，不做 TDD。

import { createClient } from '@libsql/client'
import { VECTOR_DB_URL, INDEX_NAME } from './openrouter.js'
import type { ChunkMeta } from './hybrid.js'

export interface CorpusChunk {
  id: string
  text: string
  metadata: ChunkMeta
}

let cache: Promise<CorpusChunk[]> | undefined

export function loadCorpus(): Promise<CorpusChunk[]> {
  if (!cache) cache = fetchCorpus()
  return cache
}

/** 不走缓存，直读最新库（供资料库列表 /api/library 用：入库后无须重启即反映新标准）。 */
export function loadCorpusFresh(): Promise<CorpusChunk[]> {
  return fetchCorpus()
}

async function fetchCorpus(): Promise<CorpusChunk[]> {
  const client = createClient({ url: VECTOR_DB_URL })
  const res = await client.execute(`SELECT vector_id, metadata FROM ${INDEX_NAME}`)
  return res.rows.map((r) => {
    const metadata = JSON.parse(r.metadata as string) as ChunkMeta & { text?: string }
    return { id: r.vector_id as string, text: metadata.text ?? '', metadata }
  })
}
