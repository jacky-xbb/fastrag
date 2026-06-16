// 入库脚本：PDF → 指标行切块（ADR-0004） → embedMany(OpenRouter) → upsert 到 libSQL。
// 全部 PDF 走 PaddleOCR-VL（带本地缓存）拿干净的 markdown 表格再过 chunkOcrPages，
// 每块带元数据 {标准号, 表名, 指标名, 页码, 状态}；废止标准（文件名含「作废」）状态=废止。
// （18242 虽有文字层，但错码严重、切不出指标行，故同样走 OCR，见 ADR-0003。）
//
// 用法：
//   npm run ingest                          # 默认入库 GBT 18242-2025
//   npm run ingest -- "pdf/xxx.pdf"         # 入库指定 PDF
//   npm run ingest -- --all                 # 全量：pdf/ 下全部，均走 OCR（缓存命中则免费）
//   npm run ingest -- --all --plan          # 只预演：列出哪些走付费 OCR，不入库、不扣费
//
// 全量重建前建议先删 vector.db（会一并清掉会话历史，见 #5）。

import 'dotenv/config'
import { readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { planIngest, summarizePlan } from './lib/ingest-plan.js'
import { INDEX_NAME } from './lib/openrouter.js'
import {
  OCR_CACHE_DIR,
  ensureIndex,
  chunkPdf,
  upsertRecords,
} from './lib/ingest-pipeline.js'

const DEFAULT_PDF = 'pdf/GBT 18242-2025 弹性体塑性体改性沥青防水卷材.pdf'
const PDF_DIR = 'pdf'

async function main() {
  const args = process.argv.slice(2)
  await ensureIndex()

  if (args.includes('--all')) {
    const files = (await readdir(PDF_DIR)).filter((f) => /\.pdf$/i.test(f)).sort()

    // 预演计划：先按 缓存/付费OCR 分类，让真扣费的 paid-ocr 在动手前一目了然。
    await mkdir(OCR_CACHE_DIR, { recursive: true })
    const cachedFiles = new Set(
      (existsSync(OCR_CACHE_DIR) ? await readdir(OCR_CACHE_DIR) : [])
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length)),
    )
    const plan = planIngest(files, { cachedFiles })
    const counts = summarizePlan(plan)
    console.log(
      `[ingest] 计划：共 ${counts.total} 份｜缓存 ${counts.cached}｜付费 OCR ${counts['paid-ocr']}`,
    )
    const MODE_LABEL = { cached: '缓存  ', 'paid-ocr': '付费OCR' } as const
    for (const { file, mode } of plan) console.log(`  [${MODE_LABEL[mode]}] ${file}`)
    if (args.includes('--plan')) {
      console.log(`[ingest] --plan 仅预演，未入库、未触发 OCR。去掉 --plan 即执行。`)
      return
    }

    console.log(`[ingest] 全量入库 ${files.length} 份标准`)
    const failed: string[] = []
    let okCount = 0
    let totalChunks = 0
    // 逐份 OCR→切块→入库：单份失败（如 PaddleOCR 限流「队列已满」）只跳过该份并续跑，
    // 已入库的份不回滚；补跑 --all 时 OCR 缓存命中 + id 幂等覆盖，不重复付费/不重复入库。
    for (const f of files) {
      try {
        const records = await chunkPdf(join(PDF_DIR, f))
        await upsertRecords(records)
        okCount++
        totalChunks += records.length
      } catch (err) {
        console.error(`[ingest] ✗ 跳过 ${f}：${(err as Error).message}`)
        failed.push(f)
      }
    }
    console.log(`[ingest] 全量完成：成功 ${okCount}/${files.length} 份，共 ${totalChunks} 块`)
    if (failed.length) {
      console.log(`[ingest] 失败 ${failed.length} 份（重跑 npm run ingest -- --all 增量续跑）：`)
      for (const f of failed) console.log(`  - ${f}`)
    }
    return
  }

  const pdfPath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_PDF
  const records = await chunkPdf(pdfPath)
  await upsertRecords(records)
  console.log(`[ingest] 完成：${records.length} 块已入库到索引 "${INDEX_NAME}"`)
}

main().catch((err) => {
  console.error('[ingest] 失败：', err)
  process.exit(1)
})
