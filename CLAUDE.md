# CLAUDE.md — 防水卷材国标问答知识库

本地运行的问答知识库：导入防水卷材类国标/行标 PDF，检索并对话作答，保留会话历史，必要时联网兜底。技术栈 Mastra(TS) + libSQL。术语见 [CONTEXT.md](CONTEXT.md)，调研全貌见 [docs/调研文档.md](docs/调研文档.md)。

## 硬约束（写代码必须遵守）

1. **指标表格按「指标行」切块**，别整块嵌入 HTML 表。每块前缀 `标准号 + 表名 + 指标名` 作语义锚点。（[ADR-0004](docs/adr/0004-indicator-chunking-hybrid-retrieval.md)）
2. **检索 = 向量 + BM25/全文 混合 + 元数据过滤**（`{标准号, 表名, 指标名, 页码, 状态}`），不是纯向量。
3. **入库与检索用同一个 embedding 模型**（向量空间一致），锁 `text-embedding-3-small`，别纠结升级。
4. **LLM 全收口 OpenRouter**：对话 `openai/gpt-5` + embedding `openai/text-embedding-3-small`，显式建 OpenRouter provider（默认会直连官方 OpenAI）。（[ADR-0001](docs/adr/0001-model-routing-split.md)、调研文档 §11）
5. **OCR 走 PaddleOCR-VL-1.6 托管 API**，直接吃 PDF，不本地渲染、不引 Python。（[ADR-0003](docs/adr/0003-ocr-paddleocr-vl.md)）
6. **废止标准**（如 jc 684-1997）仍入库但带 `废止` 状态，命中时必须显式标注「已作废」。
7. 入库务必保留 `文件名 + 页码` 元数据，答案要能标来源。

## key（.env，全大写）

`OPENROUTER_API_KEY`（LLM）、`PADDLE_API_KEY`（OCR）、`TAVILY_API_KEY`（联网）。embedding 不再单连 OpenAI。

## 文档分工

- `CONTEXT.md`：术语表，**只放领域名词，不放实现细节**。
- `docs/adr/`：架构决策记录。改了选型先看/补 ADR。
- `docs/调研文档.md`：一次性调研，别往里塞会绑定实现的硬决策（放这儿没人会读到）。

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`jacky-xbb/fastrag`), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to its default label string. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
