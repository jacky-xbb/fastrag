import { describe, it, expect } from 'vitest'
import { parsePaddleJsonl } from '../src/lib/ocr.js'

describe('parsePaddleJsonl', () => {
  it('按行解析 JSONL，逐页返回 markdown 文本（顺序即页序）', () => {
    const jsonl = [
      JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '# 第一页' } }] } }),
      JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '# 第二页' } }] } }),
    ].join('\n')

    expect(parsePaddleJsonl(jsonl)).toEqual(['# 第一页', '# 第二页'])
  })

  it('一行内多个 layoutParsingResults 会按序展开为多页', () => {
    const jsonl = JSON.stringify({
      result: {
        layoutParsingResults: [{ markdown: { text: 'A' } }, { markdown: { text: 'B' } }],
      },
    })

    expect(parsePaddleJsonl(jsonl)).toEqual(['A', 'B'])
  })

  it('忽略空行与首尾空白', () => {
    const jsonl =
      '\n' +
      JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: 'X' } }] } }) +
      '\n\n'

    expect(parsePaddleJsonl(jsonl)).toEqual(['X'])
  })

  it('保留 HTML 表格标签（合并单元格不丢）', () => {
    const html = '<table><tr><td rowspan="2">拉伸性能</td></tr></table>'
    const jsonl = JSON.stringify({
      result: { layoutParsingResults: [{ markdown: { text: html } }] },
    })

    expect(parsePaddleJsonl(jsonl)[0]).toContain('rowspan="2"')
  })
})
