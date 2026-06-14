// 指标行切块（ADR-0004 硬约束①）。
// PaddleOCR-VL 的指标表是带 rowspan/colspan 的 HTML <table>，整块嵌入会冲淡向量，
// 必须先「HTML 表解析 + LaTeX 单位归一化 + \n 清洗」，再按指标行切。
// 每块前缀 = 标准号 + 表名 + 指标名，让裸数字带着语义锚点进向量空间。
// 表外正文走定长字符切块（复用 splitIntoChunks），同样挂上元数据。

import { basename } from 'node:path'
import { splitIntoChunks, type PageText, type ChunkOptions } from './chunk.js'

export type Status = '现行' | '废止'

export interface IndicatorChunk {
  text: string
  metadata: {
    fileName: string
    标准号: string
    表名: string
    指标名: string
    页码: number
    状态: Status
  }
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}

/** 归一化一个单元格：剥 HTML 标签 / $…$ / LaTeX 命令，上标转 Unicode，清 \n，合并空白。 */
export function normalizeCell(raw: string): string {
  let s = raw
  s = s.replace(/<[^>]+>/g, ' ') // 残留 HTML 标签
  s = s.replace(/\\n/g, ' ').replace(/[\r\n]+/g, ' ') // 转义/真实换行
  s = s.replace(/\$/g, ' ') // LaTeX inline math 分隔符
  s = s.replace(/[{}]/g, '') // 去掉 LaTeX 花括号（含 ^{{3}} 这类双层）
  s = s
    .replace(/\\geq?/g, '≥')
    .replace(/\\leq?/g, '≤')
    .replace(/\\times/g, '×')
    .replace(/\\pm/g, '±')
  s = s.replace(/\^([0-9]+)/g, (_, d: string) => [...d].map((c) => SUP[c]).join('')) // 数字上标
  s = s.replace(/\s+/g, ' ').trim() // 合并空白
  return s
}

interface Cell {
  attrs: string
  raw: string
}

/** 把一个 <table> 展开成二维网格：rowspan/colspan 占位的格子都填上同一文本（已归一化）。 */
export function parseHtmlTable(tableHtml: string): string[][] {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1])
  const grid: string[][] = []
  const active = new Map<number, { text: string; left: number }>() // 跨行 rowspan 残留

  const drainCarry = (out: string[], col: number): number => {
    while (active.has(col)) {
      const a = active.get(col)!
      out[col] = a.text
      if (--a.left === 0) active.delete(col)
      col++
    }
    return col
  }

  for (const rowHtml of rows) {
    const cells: Cell[] = [...rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((m) => ({
      attrs: m[1],
      raw: m[2],
    }))
    const out: string[] = []
    let col = 0
    for (const cell of cells) {
      col = drainCarry(out, col)
      const colspan = Number(cell.attrs.match(/colspan=["']?(\d+)/i)?.[1] ?? 1)
      const rowspan = Number(cell.attrs.match(/rowspan=["']?(\d+)/i)?.[1] ?? 1)
      const text = normalizeCell(cell.raw)
      for (let k = 0; k < colspan; k++) {
        out[col] = text
        if (rowspan > 1) active.set(col, { text, left: rowspan - 1 })
        col++
      }
    }
    drainCarry(out, col) // 行尾残留的 rowspan
    grid.push(out)
  }
  return grid
}

/** 连续去重后用空格拼接（rowspan 填充会让同一文本重复出现）。 */
function joinDedup(parts: string[]): string {
  const kept: string[] = []
  for (const p of parts) {
    if (p && p !== kept[kept.length - 1]) kept.push(p)
  }
  return kept.join(' ')
}

/** 一张表 → 指标行块。表头行（首个含数字的行之前）用来给列贴标签。 */
function tableToChunks(
  grid: string[][],
  base: Omit<IndicatorChunk['metadata'], '指标名'> & { 表名: string },
): IndicatorChunk[] {
  if (grid.length === 0) return []
  const numCols = Math.max(...grid.map((r) => r.length))

  // 表头 = 首个「含 ASCII 数字」的行之前的所有行；找不到则默认首行为表头。
  let headerCount = grid.findIndex((r) => r.some((c) => /[0-9]/.test(c ?? '')))
  if (headerCount <= 0) headerCount = headerCount === 0 ? 0 : 1
  const headerRows = grid.slice(0, headerCount)

  // 每列的合并表头（连续去重）+ 叶子表头（最后一行表头，指标列用它当列名更干净）。
  const colHeader: string[] = []
  const leafHeader: string[] = []
  for (let c = 0; c < numCols; c++) {
    colHeader[c] = joinDedup(headerRows.map((r) => r[c] ?? ''))
    leafHeader[c] = [...headerRows].reverse().find((r) => r[c])?.[c] ?? ''
  }

  // 列角色：序号列 / 指标值列（表头含「指标」）/ 项目（指标名）列。
  const isSeq = (c: number) => /序\s*号/.test(colHeader[c])
  const isValue = (c: number) => /指\s*标/.test(colHeader[c])
  const labelCols: number[] = []
  const valueCols: number[] = []
  for (let c = 0; c < numCols; c++) {
    if (isValue(c)) valueCols.push(c)
    else if (!isSeq(c)) labelCols.push(c)
  }
  // 没有「指标」表头的表：除序号外最后一列当值列，其余当指标名列。
  if (valueCols.length === 0 && numCols > 0) {
    const last = numCols - 1
    valueCols.push(last)
    const i = labelCols.indexOf(last)
    if (i >= 0) labelCols.splice(i, 1)
  }

  const chunks: IndicatorChunk[] = []
  const prefix = `${base.标准号} ${base.表名}`.trim()

  for (const row of grid.slice(headerCount)) {
    const 指标名 = joinDedup(labelCols.map((c) => row[c] ?? ''))
    if (!指标名) continue // 纯数字/空行，跳过

    const pairs: string[] = []
    for (const c of valueCols) {
      const v = row[c]
      if (!v || v === '—') continue
      const label = leafHeader[c] || colHeader[c]
      pairs.push(label ? `${label}=${v}` : v)
    }
    const body = pairs.length > 0 ? pairs.join('; ') : joinDedup(row.filter(Boolean))
    chunks.push({
      text: `${prefix} / ${指标名}\n${body}`,
      metadata: { ...base, 指标名 },
    })
  }
  return chunks
}

/** 在 <table> 之前的文本里就近找「表N …」当表名。 */
function captionBefore(textBeforeTable: string): string {
  const lines = textBeforeTable
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
    const m = lines[i].match(/表\s*[0-9A-Za-z.]+[^。:：]*/)
    if (m) return normalizeCell(m[0])
  }
  return ''
}

/** 从文件名解析标准号，已知前缀补「/T」斜杠（如 GBT→GB/T）。 */
export function standardCodeFromFileName(fileName: string): string {
  const stem = basename(fileName).replace(/\.[a-z]+$/i, '')
  const latin = stem.split(/[一-鿿]/)[0] // 中文名之前的拉丁部分
  const num = latin.match(/([0-9][0-9.]*-[0-9]{4})/)?.[1]
  if (!num) return stem.trim()
  const prefix = latin.slice(0, latin.indexOf(num)).replace(/[^A-Za-z]/g, '').toUpperCase()
  const slash: Record<string, string> = {
    GBT: 'GB/T', JCT: 'JC/T', JTT: 'JT/T', TBT: 'TB/T', JTST: 'JTS/T',
  }
  return `${slash[prefix] ?? prefix} ${num}`
}

/** 文件名含「作废」→ 废止，否则现行（CONTEXT.md：废止标准仍入库但带状态）。 */
export function statusFromFileName(fileName: string): Status {
  return /作废|废止/.test(fileName) ? '废止' : '现行'
}

/**
 * 把 OCR 出的逐页 markdown 切块：表格按指标行切，表外正文按定长字符切。
 * 标准号/状态由调用方（或文件名）给定，每块都带全套元数据。
 */
export function chunkOcrPages(
  pages: PageText[],
  opts: {
    fileName: string
    标准号?: string
    状态?: Status
  } & ChunkOptions,
): IndicatorChunk[] {
  const { fileName, size, overlap } = opts
  const 标准号 = opts.标准号 ?? standardCodeFromFileName(fileName)
  const 状态 = opts.状态 ?? statusFromFileName(fileName)
  const records: IndicatorChunk[] = []

  for (const { page, text } of pages) {
    const tableRe = /<table[\s\S]*?<\/table>/gi
    let last = 0
    let m: RegExpExecArray | null
    const proseParts: string[] = []

    while ((m = tableRe.exec(text))) {
      const before = text.slice(last, m.index)
      proseParts.push(before)
      const 表名 = captionBefore(before)
      const grid = parseHtmlTable(m[0])
      records.push(
        ...tableToChunks(grid, { fileName, 标准号, 表名, 页码: page, 状态 }),
      )
      last = m.index + m[0].length
    }
    proseParts.push(text.slice(last))

    // 表外正文：去掉 HTML 标签后定长切块，表名/指标名留空。
    const prose = proseParts.join('\n').replace(/<[^>]+>/g, ' ')
    for (const chunk of splitIntoChunks(prose, { size, overlap })) {
      records.push({
        text: chunk,
        metadata: { fileName, 标准号, 表名: '', 指标名: '', 页码: page, 状态 },
      })
    }
  }
  return records
}
