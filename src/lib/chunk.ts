// 按页切块（tracer-bullet 版）。
// 故意做薄：定长字符切块 + 重叠，每块带「文件名 + 页码」元数据。
// 指标行级切块 + LaTeX 归一化是后续切片（见 docs/adr/0004），这里先不做。

export interface ChunkOptions {
  /** 每块最大字符数 */
  size: number
  /** 相邻块重叠字符数，必须 < size */
  overlap: number
}

export interface PageText {
  page: number
  text: string
}

export interface ChunkRecord {
  text: string
  metadata: {
    fileName: string
    page: number
  }
}

/** 把一段文本切成带重叠的定长块；空白返回空数组。 */
export function splitIntoChunks(text: string, { size, overlap }: ChunkOptions): string[] {
  if (overlap >= size) {
    throw new Error(`overlap (${overlap}) 必须小于 size (${size})，否则窗口不前进`)
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  if (trimmed.length <= size) return [trimmed]

  const step = size - overlap
  const chunks: string[] = []
  for (let start = 0; start < trimmed.length; start += step) {
    chunks.push(trimmed.slice(start, start + size))
  }
  return chunks
}

/** 把按页抽取的文本切块，并给每块挂上文件名 + 页码。空白页跳过。 */
export function chunkPages(
  pages: PageText[],
  opts: ChunkOptions & { fileName: string },
): ChunkRecord[] {
  const { fileName, size, overlap } = opts
  const records: ChunkRecord[] = []
  for (const { page, text } of pages) {
    for (const chunk of splitIntoChunks(text, { size, overlap })) {
      records.push({ text: chunk, metadata: { fileName, page } })
    }
  }
  return records
}
