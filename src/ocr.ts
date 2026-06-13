// OCR 脚本（#2 tracer bullet）：扫描件 PDF → PaddleOCR-VL → 逐页 markdown，写出文件。
// 验证「API 跑通 + 指标表格保留为 HTML + 携带文件名+页码元数据」。
//
// 用法：
//   npm run ocr -- "pdf/GBT 23457-2017 预铺防水卷材.pdf"            # 默认写 ocr_out.md
//   npm run ocr -- "pdf/xxx.pdf" out.md                            # 指定输出文件

import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { ocrPdfToPages } from './lib/ocr.js'

const DEFAULT_PDF = 'pdf/GBT 23457-2017 预铺防水卷材.pdf'

async function main() {
  const pdfPath = process.argv[2] ?? DEFAULT_PDF
  const outPath = process.argv[3] ?? 'ocr_out.md'
  const fileName = basename(pdfPath)

  const pages = await ocrPdfToPages(pdfPath)

  // 每页带「文件名 + 页码」锚点写出，便于抽查来源对齐。
  const md = pages
    .map((p) => `<!-- 来源：${fileName}（第 ${p.page} 页） -->\n${p.text}`)
    .join('\n\n---\n\n')
  await writeFile(outPath, md)

  const tableCount = (md.match(/<table/g) ?? []).length
  console.log(
    `[ocr] 写出 ${outPath}：${md.length} 字符，${pages.length} 页，含 ${tableCount} 个 HTML 表格`,
  )
}

main().catch((err) => {
  console.error('[ocr] 失败：', err)
  process.exit(1)
})
