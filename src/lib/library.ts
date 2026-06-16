// 资料库列表的纯逻辑（#11）：把库内全部块按「标准号」聚合成一行一个标准。
// 块数累计、页码去重计数（已入库页数），产品名从文件名提取（ADR-0004），状态如实带出。
// 纯函数，可单测；读库（loadCorpus）由调用方（web.ts）负责。

import { standardNameFromFileName } from './indicator-chunk.js'
import type { ChunkMeta } from './hybrid.js'

export interface LibraryEntry {
  /** 标准号，如「GB/T 18242-2025」 */
  code: string
  /** 产品名（文件名中文段，ADR-0004） */
  name: string
  fileName: string
  /** 已入库页数（去重后的页码数；噪声页已在切块层剔除，故可能少于 PDF 实际页数） */
  pages: number
  /** 块数 */
  chunks: number
  /** 状态：现行 / 废止（ADR-0005：废止当普通文档，仅如实展示，不做特殊行为） */
  status: string
}

export function aggregateLibrary(chunks: { metadata: ChunkMeta }[]): LibraryEntry[] {
  const by = new Map<string, { fileName: string; pages: Set<number>; chunks: number; status: string }>()
  for (const { metadata: m } of chunks) {
    const code = m.标准号
    let agg = by.get(code)
    if (!agg) {
      agg = { fileName: (m.fileName as string) ?? '', pages: new Set(), chunks: 0, status: m.状态 }
      by.set(code, agg)
    }
    agg.pages.add(m.页码)
    agg.chunks++
  }
  return [...by.entries()]
    .map(([code, agg]) => ({
      code,
      name: standardNameFromFileName(agg.fileName),
      fileName: agg.fileName,
      pages: agg.pages.size,
      chunks: agg.chunks,
      status: agg.status,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
}
