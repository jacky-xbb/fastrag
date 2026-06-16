// 示例数据 —— 仅剩首屏建议词与上传管线阶段文案。
// 对话 /api/chat、资料库 /api/library、历史 /api/threads、上传入库 /api/ingest（见 useIngest，#10）均已接真。

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
