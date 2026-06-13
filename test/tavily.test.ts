import { describe, it, expect } from 'vitest'
import { formatTavilyResults } from '../src/lib/tavily.js'

describe('formatTavilyResults', () => {
  it('有结果时带「联网来源」标记，逐条列出标题与 URL', () => {
    const out = formatTavilyResults({
      answer: '防水卷材需符合 GB 标准。',
      results: [
        { title: '某防水卷材简介', url: 'https://a.com/x', content: '弹性体改性沥青卷材...' },
        { title: '行业资讯', url: 'https://b.com/y', content: '2024 年市场...' },
      ],
    })
    expect(out).toContain('联网来源')
    expect(out).toContain('防水卷材需符合 GB 标准。')
    expect(out).toContain('某防水卷材简介')
    expect(out).toContain('https://a.com/x')
    expect(out).toContain('https://b.com/y')
  })

  it('无结果时明确说明未找到，仍标注是联网渠道', () => {
    const out = formatTavilyResults({ answer: null, results: [] })
    expect(out).toContain('联网')
    expect(out).toContain('未找到')
  })

  it('没有 answer 字段时不报错，只列结果', () => {
    const out = formatTavilyResults({
      results: [{ title: 'T', url: 'https://t.com', content: 'c' }],
    })
    expect(out).toContain('T')
    expect(out).toContain('https://t.com')
  })
})
