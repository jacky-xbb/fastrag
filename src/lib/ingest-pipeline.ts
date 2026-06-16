// 入库管线（CLI src/ingest.ts 与 web POST /api/ingest 共用）：
// OCR（带缓存）→ 指标行切块（ADR-0004）→ embedMany(OpenRouter) → upsert 到 libSQL。
// id 用 `${文件名}#${序号}` 稳定标识：同份标准重跑按 id 覆盖、不重复入库（幂等）。

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { embedMany } from 'ai'
import { ocrPdfToPages } from './ocr.js'
import { chunkOcrPages, type IndicatorChunk } from './indicator-chunk.js'
import type { PageText } from './chunk.js'
import { embedModel, EMBED_DIMENSION, INDEX_NAME } from './openrouter.js'
import { libsqlVector } from '../mastra/index.js'

export const OCR_CACHE_DIR = 'ocr_cache'
const EMBED_BATCH = 256

/** 确保向量索引存在（维度与 embedding 模型一致）。入库前调用一次。 */
export async function ensureIndex() {
  await libsqlVector.createIndex({ indexName: INDEX_NAME, dimension: EMBED_DIMENSION })
}

/** OCR 结果缓存到 ocr_cache/<basename>.json：OCR ~30s/份且结果 URL 仅 7 天，缓存后重跑免费。 */
export async function cachedOcrPages(pdfPath: string): Promise<PageText[]> {
  await mkdir(OCR_CACHE_DIR, { recursive: true })
  const cachePath = join(OCR_CACHE_DIR, `${basename(pdfPath)}.json`)
  if (existsSync(cachePath)) {
    console.log(`[ingest] 命中 OCR 缓存 ${cachePath}`)
    return JSON.parse(await readFile(cachePath, 'utf8')) as PageText[]
  }
  const pages = await ocrPdfToPages(pdfPath)
  await writeFile(cachePath, JSON.stringify(pages))
  console.log(`[ingest] OCR 结果已缓存到 ${cachePath}`)
  return pages
}

/** 逐页 markdown → 指标行块（ADR-0004，表名/指标名/页码作锚点）。 */
export function chunkPages(pages: PageText[], fileName: string): IndicatorChunk[] {
  const records = chunkOcrPages(pages, { fileName, size: 800, overlap: 100 })
  const tableChunks = records.filter((r) => r.metadata.指标名).length
  console.log(
    `[ingest] ${fileName}：${pages.length} 页 → ${records.length} 块（含 ${tableChunks} 指标行）`,
  )
  return records
}

/** 单份 PDF → 指标行块。走 PaddleOCR-VL（缓存命中则免费）。 */
export async function chunkPdf(pdfPath: string): Promise<IndicatorChunk[]> {
  console.log(`[ingest] OCR 读取 ${pdfPath}`)
  const pages = await cachedOcrPages(pdfPath)
  return chunkPages(pages, basename(pdfPath))
}

/**
 * 把一份标准的块算向量后 upsert（分批，避免单次 embed 输入过多）。
 * id 幂等覆盖：同份标准重跑无须先删库。onStage 在每批 embed/upsert 前回调（供 web 推真实进度）。
 */
export async function upsertRecords(
  records: IndicatorChunk[],
  onStage?: (stage: 'embed' | 'upsert') => void,
) {
  for (let i = 0; i < records.length; i += EMBED_BATCH) {
    const batch = records.slice(i, i + EMBED_BATCH)
    onStage?.('embed')
    const { embeddings } = await embedMany({ model: embedModel, values: batch.map((r) => r.text) })
    // metadata 带上 text，检索时 Agent 才读得到原文并据此引用来源。
    onStage?.('upsert')
    await libsqlVector.upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      metadata: batch.map((r) => ({ text: r.text, ...r.metadata })),
      ids: batch.map((r, j) => `${r.metadata.fileName}#${i + j}`),
    })
  }
}
