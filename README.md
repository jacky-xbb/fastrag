# fastrag — 防水卷材国标问答知识库

本地运行的问答知识库：导入防水卷材类国标/行标 PDF，检索并对话作答。
约束与术语见 [CLAUDE.md](CLAUDE.md) / [CONTEXT.md](CONTEXT.md)，决策见 [docs/adr/](docs/adr/)。

## 现状

骨架贯通（tracer bullet，Issue #1）：用有文字层的 `GBT 18242-2025` 跑通
`PDF → 切块 → 入库 → 检索 → Agent 问答带来源` 全链路。
对话 `openai/gpt-5` + embedding `openai/text-embedding-3-small` 均走 OpenRouter（[ADR-0001](docs/adr/0001-model-routing-split.md)）。

指标行切块（Issue #3）：OCR 出的指标表是带 `rowspan/colspan` 的 HTML `<table>`，
`src/lib/indicator-chunk.ts` 先「解析网格 + LaTeX 单位归一化 + `\n` 清洗」，再**按指标行切块**——
每块前缀 = `标准号 + 表名 + 指标名`，裸数字带着列头（如 `P=600; PY=800; R=350`）进向量空间（[ADR-0004](docs/adr/0004-indicator-chunking-hybrid-retrieval.md)）。
每块带元数据 `{标准号, 表名, 指标名, 页码, 状态}`；**废止标准**（文件名含「作废」，如 `jc 684-1997`）入库时 `状态=废止`，命中时 Agent 显式标注「已作废」。

混合检索（Issue #4，[ADR-0004](docs/adr/0004-indicator-chunking-hybrid-retrieval.md) 第 2/3 条）：检索不再是纯向量。
`hybridQueryTool` 把**向量召回 + BM25 关键词召回**用 RRF 融合（`src/lib/{bm25,hybrid,retrieve}.ts`）。
BM25 分词按「字母段/数字段 + 中文二元」切，故 `jc684`、`328.18` 这种标准号也能命中库里空格写法。
实测「撕裂强度 钉杆法」纯向量 top6 只覆盖 2 份标准、漏掉废止的 `JC 684-1997 直角形撕裂强度`，混合检索把它召回了。
元数据过滤 `{标准号,表名,指标名,页码,状态}` 在内存里做（中文 key 在 libSQL filter 会报错），见 `matchesFilter`。
Agent 可填 `standardCode/table/indicator/page/status` 收窄，但 `hybridSearch` 内有两道护栏防误填：
① `sanitizeFilter` 丢弃 `status=现行` 等反向排除（防漏废止标准，硬约束⑥），status 只允许填「废止」作正向收窄；
② 过滤命中为空时自动回退无过滤检索（防把标准号/表名猜错导致空答），靠混合召回保底。标准号归一化匹配（`jc684`↔`JC 684-1997`）。

联网兜底（Issue #6）：Agent 挂 `webSearchTool`（Tavily），**库内优先**；仅当已入库标准里查不到时才联网，
答案区分「来源：国标库」（文件名+页码）与「来源：联网」（网页链接）。需在 `.env` 配 `TAVILY_API_KEY`。

扫描件 OCR（Issue #2）：扫描件 PDF 用 PaddleOCR-VL 托管 API 直接转 markdown（[ADR-0003](docs/adr/0003-ocr-paddleocr-vl.md)），
指标表格保留为带 `rowspan/colspan` 的 HTML 表（合并单元格不丢），逐页带「文件名+页码」锚点。需在 `.env` 配 `PADDLE_API_KEY`。

## 准备

```bash
cp .env.example .env   # 填入 OPENROUTER_API_KEY 等
npm install
```

## 用法

```bash
npm run ingest                      # 入库默认标的 GBT 18242-2025（有文字层）
npm run ingest -- "pdf/xxx.pdf"     # 入库指定 PDF（有文字层）
npm run ingest -- --ocr "pdf/xxx.pdf" # 扫描件：OCR（缓存到 ocr_cache/）后按指标行入库
npm run ingest -- --all             # 全量：pdf/ 下全部，18242 走文字层，其余走 OCR
npm run ingest -- --all --plan      # 只预演：列出哪些走付费 OCR，不入库、不扣费
npm run ocr                         # OCR 默认扫描件 GBT 23457-2017 → ocr_out.md
npm run ocr -- "pdf/xxx.pdf" out.md # 扫描件 PDF → markdown（PaddleOCR-VL）
npm run ask                         # 默认跑两轮对话（演示多轮记忆）
npm run ask -- "你的问题"
npm run ask -- "第1问" "第2问"      # 多参数 = 同一会话里的多轮提问
```

向量与会话历史落在同一个本地 `vector.db`（libSQL，已 gitignore）：
Agent 接入 Mastra Memory（默认带最近 10 条消息），同一 thread 内多轮可互相引用。
全量重建前可先删 `vector.db`（会一并清掉会话历史）；OCR 结果缓存在 `ocr_cache/`，重跑 `--all` 不会重复付费 OCR。

## 反馈回路

```bash
npm test         # vitest：纯逻辑单测（切块）
npm run typecheck # tsc --noEmit
```
