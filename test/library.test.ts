import { describe, it, expect } from 'vitest'
import { aggregateLibrary } from '../src/lib/library.js'

// 构造一条块的元数据（只取聚合用得到的字段）。
function meta(over: Partial<Record<string, unknown>> = {}) {
  return {
    fileName: 'GBT 18242-2025 弹性体塑性体改性沥青防水卷材.pdf',
    标准号: 'GB/T 18242-2025',
    表名: '表1',
    指标名: '可溶物含量',
    页码: 3,
    状态: '现行',
    ...over,
  } as any
}

describe('aggregateLibrary', () => {
  it('按标准号聚合：一个标准一行，块数累计、页码去重计数', () => {
    const lib = aggregateLibrary([
      { metadata: meta({ 页码: 3 }) },
      { metadata: meta({ 页码: 3 }) }, // 同页 → 页数不重复计
      { metadata: meta({ 页码: 5 }) },
    ])
    expect(lib).toHaveLength(1)
    expect(lib[0]).toEqual({
      code: 'GB/T 18242-2025',
      name: '弹性体塑性体改性沥青防水卷材',
      fileName: 'GBT 18242-2025 弹性体塑性体改性沥青防水卷材.pdf',
      pages: 2,
      chunks: 3,
      status: '现行',
    })
  })

  it('多个标准各成一行，废止状态如实带出', () => {
    const lib = aggregateLibrary([
      { metadata: meta() },
      { metadata: meta({ fileName: 'jc 684-1997 氯化聚乙烯防水卷材-作废.pdf', 标准号: 'JC 684-1997', 状态: '废止', 页码: 1 }) },
    ])
    const jc = lib.find((e) => e.code === 'JC 684-1997')!
    expect(jc.status).toBe('废止')
    expect(jc.name).toBe('氯化聚乙烯防水卷材')
    expect(lib).toHaveLength(2)
  })

  it('按标准号升序排序，输出稳定', () => {
    const lib = aggregateLibrary([
      { metadata: meta({ 标准号: 'GB/T 35467-2017' }) },
      { metadata: meta({ 标准号: 'GB/T 18242-2025' }) },
    ])
    expect(lib.map((e) => e.code)).toEqual(['GB/T 18242-2025', 'GB/T 35467-2017'])
  })

  it('空库返回空数组', () => {
    expect(aggregateLibrary([])).toEqual([])
  })
})
