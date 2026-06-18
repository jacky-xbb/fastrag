// 入库管线（CLI src/ingest.ts 与 Workers 入库 Workflow 共用，Workers-bundle 安全：不碰 node:fs）：
// OCR（带缓存）→ 指标行切块（ADR-0004）→ embedMany(OpenRouter) → upsert 到 libSQL。
// id 用 `${文件名}#${序号}` 稳定标识：同份标准重跑按 id 覆盖、不重复入库（幂等）。

import { embedMany } from 'ai'
import { createClient } from '@libsql/client'
import { ocrPdfToPages } from './ocr.js'
import { chunkOcrPages, type IndicatorChunk, type ProseMode } from './indicator-chunk.js'
import type { PageText } from './chunk.js'
import { embedModel, EMBED_DIMENSION, INDEX_NAME, VECTOR_DB_URL, VECTOR_DB_AUTH_TOKEN } from './openrouter.js'
import { getLibsqlVector } from '../mastra/index.js'

const EMBED_BATCH = 256

/** OCR 结果缓存：用 fs（ocr-cache-fs.ts）落 ${DATA_DIR}/ocr_cache。
 *  OCR ~30s/份且结果 URL 仅 7 天，缓存后重跑免费。key 用文件名（不含目录）。 */
export interface OcrCache {
  get(fileName: string): Promise<PageText[] | null>
  put(fileName: string, pages: PageText[]): Promise<void>
}

/** 确保存储表存在。入库前调用一次。
 *  去 DiskANN 向量索引：本库规模小，检索走 vector_distance_cos 暴力扫（见调研 corpus.vectorSearchIds）。
 *  表结构与 Mastra LibSQLVector 一致（vector_id 唯一，供 upsert 的 ON CONFLICT 幂等覆盖）。 */
export async function ensureTable() {
  const client = createClient({ url: VECTOR_DB_URL, authToken: VECTOR_DB_AUTH_TOKEN })
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${INDEX_NAME} (
      id SERIAL PRIMARY KEY,
      vector_id TEXT UNIQUE NOT NULL,
      embedding F32_BLOB(${EMBED_DIMENSION}),
      metadata TEXT DEFAULT '{}'
    )`,
  )
}

/** 取一份 PDF 的逐页 OCR 结果，命中缓存则免费、免重跑。 */
export async function cachedOcrPages(
  pdfBytes: Uint8Array,
  fileName: string,
  cache: OcrCache,
): Promise<PageText[]> {
  const hit = await cache.get(fileName)
  if (hit) {
    console.log(`[ingest] 命中 OCR 缓存 ${fileName}`)
    return hit
  }
  const pages = await ocrPdfToPages(pdfBytes, fileName)
  await cache.put(fileName, pages)
  console.log(`[ingest] OCR 结果已缓存 ${fileName}`)
  return pages
}

/** 逐页 markdown → 指标行块（ADR-0004，表名/指标名/页码作锚点）。
 *  表外正文切法由 PROSE_MODE 环境变量选（fixed/recursive/markdown），默认 markdown：
 *  国标正文是 `## N 条款` 结构，markdown 沿条款边界切，「原理/步骤/术语」不被切散，
 *  正文召回 84.4% > fixed 81.3%（见 scripts/compare-prose.sh，严格更优、无回退）。
 *  正文块大小默认 1500（给整条款留整块空间），可由 PROSE_MAX_SIZE 覆盖。 */
export async function chunkPages(pages: PageText[], fileName: string): Promise<IndicatorChunk[]> {
  const proseMode = (process.env.PROSE_MODE as ProseMode) ?? 'markdown'
  const size = Number(process.env.PROSE_MAX_SIZE) || 1500
  const records = await chunkOcrPages(pages, { fileName, size, overlap: 200, proseMode })
  const tableChunks = records.filter((r) => r.metadata.指标名).length
  console.log(
    `[ingest] ${fileName}：${pages.length} 页 → ${records.length} 块（含 ${tableChunks} 指标行）`,
  )
  return records
}

/** 删掉某份 PDF 的全部旧块（vector_id 前缀 `${fileName}#`）。
 *  用前缀精确比对而非 LIKE，免去文件名里 _/% 被当通配符的坑。 */
async function deleteFileChunks(fileName: string) {
  const client = createClient({ url: VECTOR_DB_URL, authToken: VECTOR_DB_AUTH_TOKEN })
  const prefix = `${fileName}#`
  await client.execute({
    sql: `DELETE FROM ${INDEX_NAME} WHERE substr(vector_id, 1, ?) = ?`,
    args: [prefix.length, prefix],
  })
}

/**
 * 把一份标准的块算向量后 upsert（分批，避免单次 embed 输入过多）。
 * 先按文件名前缀清掉旧块再写新块：同份标准重灌是一次干净替换，
 * 即使新版块数变少也不留孤儿块（id 幂等覆盖只覆盖同 id，删不掉多出来的旧块）。
 * onStage 在每批 embed/upsert 前回调（供 web 推真实进度）。
 */
export async function upsertRecords(
  records: IndicatorChunk[],
  onStage?: (stage: 'embed' | 'upsert') => void,
) {
  if (records.length) await deleteFileChunks(records[0].metadata.fileName)
  for (let i = 0; i < records.length; i += EMBED_BATCH) {
    const batch = records.slice(i, i + EMBED_BATCH)
    onStage?.('embed')
    const { embeddings } = await embedMany({ model: embedModel, values: batch.map((r) => r.text) })
    // metadata 带上 text，检索时 Agent 才读得到原文并据此引用来源。
    onStage?.('upsert')
    await getLibsqlVector().upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      metadata: batch.map((r) => ({ text: r.text, ...r.metadata })),
      ids: batch.map((r, j) => `${r.metadata.fileName}#${i + j}`),
    })
  }
}
