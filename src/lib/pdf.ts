// 抽 PDF 文字层（仅限有文字层的标准，如 GBT 18242-2025）。
// 扫描件走 PaddleOCR-VL（ADR-0003），不在此处。
// 用 unpdf（纯 TS，无外部二进制），按页返回文本以保留页码元数据。

import { readFile } from 'node:fs/promises'
import { extractText, getDocumentProxy } from 'unpdf'
import type { PageText } from './chunk.js'

/** 抽取 PDF 每页文本，页码从 1 开始。 */
export async function extractPages(pdfPath: string): Promise<PageText[]> {
  const buf = await readFile(pdfPath)
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: false })
  return text.map((pageText, i) => ({ page: i + 1, text: pageText }))
}
