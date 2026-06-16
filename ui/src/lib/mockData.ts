// 示例数据 —— 历史会话列表后端尚未暴露 HTTP 接口，先用示例数据撑布局。
// 对话是真的（走 /api/chat）；资料库列表已接真（GET /api/library，见 useLibrary）。
// TODO(接后端)：MOCK_SESSIONS → GET /api/threads + /api/messages（#12）。

export interface Session {
  id: string
  title: string
  snippet: string
  when: string
}

export const MOCK_SESSIONS: Session[] = [
  { id: 's1', title: 'I 型卷材可溶物含量', snippet: 'GBT 18242-2025 中 I 型卷材的可溶物含量要求是多少？', when: '今天 14:22' },
  { id: 's2', title: '预铺卷材搭接强度', snippet: 'GB/T 23457 的搭接缝剥离强度指标？', when: '今天 10:05' },
  { id: 's3', title: '低温柔性对比', snippet: '弹性体和塑性体改性沥青卷材低温柔性差别？', when: '昨天' },
  { id: 's4', title: '拉伸性能试验方法', snippet: 'GB/T 328 里拉力和延伸率怎么测？', when: '6 月 11 日' },
]

export const SUGGESTIONS = [
  'GBT 18242-2025 中 I 型卷材的可溶物含量要求是多少？',
  'GB/T 23457 预铺防水卷材的搭接缝剥离强度指标？',
  '弹性体改性沥青卷材的低温柔性要求是多少？',
  '防水卷材的拉伸性能怎么测？引用试验方法。',
]

// 上传向量化的真实管线阶段（对应 ingest.ts：OCR → 指标行切块 → embed → upsert）。
export const INGEST_STAGES = [
  { key: 'upload', label: '上传 PDF', detail: '读取文件字节' },
  { key: 'ocr', label: 'PaddleOCR-VL 识别', detail: '直接吃 PDF，拿干净 markdown 表格（ADR-0003）' },
  { key: 'chunk', label: '指标行切块', detail: '按指标行切，前缀「标准号+产品名+表名+指标名」锚点（ADR-0004）' },
  { key: 'embed', label: 'embedding 向量化', detail: 'text-embedding-3-small，批量 embedMany' },
  { key: 'upsert', label: 'upsert 到 libSQL', detail: '带 {标准号,表名,指标名,页码} 元数据落库' },
] as const
