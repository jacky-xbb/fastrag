import { describe, it, expect } from 'vitest'
import { safePdfName } from '../src/lib/ingest-upload.js'

describe('safePdfName', () => {
  it('保留普通 PDF 文件名（含空格/中文/连字符）', () => {
    expect(safePdfName('GBT 18242-2025 弹性体改性沥青防水卷材.pdf')).toBe(
      'GBT 18242-2025 弹性体改性沥青防水卷材.pdf',
    )
  })

  it('只取最后一段，杜绝目录穿越（/ 与 \\ 都兼容）', () => {
    expect(safePdfName('../../etc/passwd.pdf')).toBe('passwd.pdf')
    expect(safePdfName('a/b/c.pdf')).toBe('c.pdf')
    expect(safePdfName('C:\\windows\\x.pdf')).toBe('x.pdf')
  })

  it('去首尾空白', () => {
    expect(safePdfName('  y.pdf  ')).toBe('y.pdf')
  })

  it('扩展名大小写都接受，原名不变', () => {
    expect(safePdfName('X.PDF')).toBe('X.PDF')
  })

  it('非 PDF 报错', () => {
    expect(() => safePdfName('x.txt')).toThrow()
    expect(() => safePdfName('noext')).toThrow()
  })

  it('空名或纯路径报错', () => {
    expect(() => safePdfName('   ')).toThrow()
    expect(() => safePdfName('/')).toThrow()
    expect(() => safePdfName('..')).toThrow()
  })
})
