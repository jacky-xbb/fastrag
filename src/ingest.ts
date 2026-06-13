// 入库脚本：PDF → 按页切块 → embedMany(OpenRouter) → upsert 到 libSQL。
// 用法：npm run ingest -- "pdf/GBT 18242-2025 弹性体塑性体改性沥青防水卷材.pdf"
// 不带参数则默认入库 GBT 18242-2025（tracer-bullet 标的）。

import 'dotenv/config'
import { basename } from 'node:path'
import { embedMany } from 'ai'
import { extractPages } from './lib/pdf.js'
import { chunkPages } from './lib/chunk.js'
import { embedModel, EMBED_DIMENSION, INDEX_NAME } from './lib/openrouter.js'
import { libsqlVector } from './mastra/index.js'

const DEFAULT_PDF = 'pdf/GBT 18242-2025 弹性体塑性体改性沥青防水卷材.pdf'

async function main() {
  const pdfPath = process.argv[2] ?? DEFAULT_PDF
  const fileName = basename(pdfPath)
  console.log(`[ingest] 读取 ${pdfPath}`)

  const pages = await extractPages(pdfPath)
  console.log(`[ingest] 抽取 ${pages.length} 页`)

  const records = chunkPages(pages, { fileName, size: 800, overlap: 100 })
  console.log(`[ingest] 切出 ${records.length} 块`)

  console.log('[ingest] 计算向量（OpenRouter / text-embedding-3-small）...')
  const { embeddings } = await embedMany({
    model: embedModel,
    values: records.map((r) => r.text),
  })

  await libsqlVector.createIndex({ indexName: INDEX_NAME, dimension: EMBED_DIMENSION })

  // metadata 带上 text，检索时 Agent 才读得到原文并据此引用来源。
  await libsqlVector.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings,
    metadata: records.map((r) => ({
      text: r.text,
      fileName: r.metadata.fileName,
      page: r.metadata.page,
    })),
  })

  console.log(`[ingest] 完成：${records.length} 块已入库到索引 "${INDEX_NAME}"`)
}

main().catch((err) => {
  console.error('[ingest] 失败：', err)
  process.exit(1)
})
