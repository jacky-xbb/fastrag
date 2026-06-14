import { describe, it, expect } from 'vitest'
import { rrfFuse, matchesFilter, sanitizeFilter, formatHits } from '../src/lib/hybrid.js'

describe('rrfFuse', () => {
  it('两路都靠前的 id 融合后排第一', () => {
    const fused = rrfFuse([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
    ])
    expect(fused[0].id).toBe('a')
    expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('只在一路出现的 id 也保留', () => {
    const fused = rrfFuse([['x'], ['y']])
    expect(fused.map((f) => f.id).sort()).toEqual(['x', 'y'])
  })
})

const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  标准号: 'GB/T 23457-2017',
  表名: '表2 产品物理力学性能',
  指标名: '可溶物含量',
  页码: 7,
  状态: '现行' as const,
  ...over,
})

describe('matchesFilter', () => {
  it('空过滤全通过', () => {
    expect(matchesFilter(meta(), {})).toBe(true)
  })

  it('状态精确、字符串子串、页码数值精确', () => {
    expect(matchesFilter(meta(), { 状态: '现行' })).toBe(true)
    expect(matchesFilter(meta(), { 状态: '废止' })).toBe(false)
    expect(matchesFilter(meta(), { 标准号: '23457' })).toBe(true) // 子串
    expect(matchesFilter(meta(), { 页码: 7 })).toBe(true)
    expect(matchesFilter(meta(), { 页码: 8 })).toBe(false)
  })

  it('空串/undefined 字段当作不过滤', () => {
    expect(matchesFilter(meta(), { 标准号: '', 指标名: undefined })).toBe(true)
  })

  it('标准号归一化匹配：紧凑写法对上库里空格写法', () => {
    const m = meta({ 标准号: 'JC 684-1997' })
    expect(matchesFilter(m, { 标准号: 'jc684' })).toBe(true) // 去空格大小写无关
    expect(matchesFilter(m, { 标准号: 'JC684' })).toBe(true)
    expect(matchesFilter(m, { 标准号: 'GB' })).toBe(false) // 不沾边仍排除
  })
})

describe('sanitizeFilter', () => {
  it('丢弃 状态=现行 等反向排除（硬约束⑥：不漏废止）', () => {
    expect(sanitizeFilter({ 状态: '现行' })).toEqual({})
    expect(sanitizeFilter({ 状态: '有效' })).toEqual({})
  })

  it('保留 状态=废止 作正向收窄', () => {
    expect(sanitizeFilter({ 状态: '废止' })).toEqual({ 状态: '废止' })
  })

  it('其余字段原样保留', () => {
    expect(sanitizeFilter({ 标准号: 'GB/T 23457', 页码: 7, 状态: '现行' })).toEqual({
      标准号: 'GB/T 23457',
      页码: 7,
    })
  })
})

describe('formatHits', () => {
  it('每条带标准号+表名+页码，废止块标注「已作废」', () => {
    const out = formatHits([
      { text: '拉力 800', metadata: meta() },
      { text: '旧指标 350', metadata: meta({ 标准号: 'JC 684-1997', 状态: '废止' }) },
    ])
    expect(out).toContain('GB/T 23457-2017')
    expect(out).toContain('第 7 页')
    expect(out).toContain('已作废')
  })

  it('无命中给出明确提示', () => {
    expect(formatHits([])).toContain('未检索到')
  })
})
