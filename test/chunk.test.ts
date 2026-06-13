import { describe, it, expect } from 'vitest'
import { splitIntoChunks, chunkPages } from '../src/lib/chunk.js'

describe('splitIntoChunks', () => {
  it('短文本不切，原样返回一块', () => {
    expect(splitIntoChunks('拉力 800 N', { size: 100, overlap: 10 })).toEqual([
      '拉力 800 N',
    ])
  })

  it('空白/纯空串返回空数组', () => {
    expect(splitIntoChunks('   \n  ', { size: 100, overlap: 10 })).toEqual([])
    expect(splitIntoChunks('', { size: 100, overlap: 10 })).toEqual([])
  })

  it('长文本按 size 切成多块', () => {
    const text = 'a'.repeat(250)
    const chunks = splitIntoChunks(text, { size: 100, overlap: 0 })
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
    expect(chunks[2]).toHaveLength(50)
  })

  it('相邻块按 overlap 重叠', () => {
    const text = 'abcdefghij' // 10 chars
    const chunks = splitIntoChunks(text, { size: 6, overlap: 2 })
    // step = size - overlap = 4 → starts at 0,4,8
    expect(chunks).toEqual(['abcdef', 'efghij', 'ij'])
  })

  it('overlap >= size 抛错（防止死循环）', () => {
    expect(() => splitIntoChunks('abc', { size: 4, overlap: 4 })).toThrow()
  })
})

describe('chunkPages', () => {
  it('每个 chunk 带文件名与页码元数据', () => {
    const pages = [
      { page: 1, text: '第一页内容' },
      { page: 2, text: '第二页内容' },
    ]
    const records = chunkPages(pages, {
      fileName: 'GBT 18242-2025.pdf',
      size: 100,
      overlap: 10,
    })
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      text: '第一页内容',
      metadata: { fileName: 'GBT 18242-2025.pdf', page: 1 },
    })
    expect(records[1].metadata.page).toBe(2)
  })

  it('跳过空白页', () => {
    const pages = [
      { page: 1, text: '有内容' },
      { page: 2, text: '   ' },
    ]
    const records = chunkPages(pages, { fileName: 'x.pdf', size: 100, overlap: 10 })
    expect(records).toHaveLength(1)
    expect(records[0].metadata.page).toBe(1)
  })

  it('一页切成多块时各块共享页码', () => {
    const pages = [{ page: 5, text: 'a'.repeat(250) }]
    const records = chunkPages(pages, { fileName: 'x.pdf', size: 100, overlap: 0 })
    expect(records).toHaveLength(3)
    expect(records.every((r) => r.metadata.page === 5)).toBe(true)
  })
})
