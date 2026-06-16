// 上传入库的纯逻辑：把前端传来的文件名清洗成安全的 basename。
// 上传的 PDF 会落到 pdf/ 目录（与语料源同处，后续 --all 重建也能复用），
// 故必须杜绝目录穿越（../、绝对路径），并只接受 PDF。

/**
 * 清洗上传文件名：只取最后一段路径分量（兼容 / 与 \），去首尾空白，
 * 校验扩展名为 .pdf（大小写不限）。非法/非 PDF 抛错。
 */
export function safePdfName(raw: string): string {
  const base = (raw ?? '').trim().split(/[/\\]/).pop()?.trim() ?? ''
  if (!base || base === '.' || base === '..') {
    throw new Error('非法文件名')
  }
  if (!/\.pdf$/i.test(base)) {
    throw new Error('只接受 PDF 文件')
  }
  return base
}
