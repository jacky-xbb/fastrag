# fastrag — 防水卷材国标问答知识库

本地运行的问答知识库：导入防水卷材类国标/行标 PDF，检索并对话作答。
约束与术语见 [CLAUDE.md](CLAUDE.md) / [CONTEXT.md](CONTEXT.md)，决策见 [docs/adr/](docs/adr/)。

## 现状

骨架贯通（tracer bullet，Issue #1）：用有文字层的 `GBT 18242-2025` 跑通
`PDF → 切块 → 入库 → 检索 → Agent 问答带来源` 全链路。
对话 `openai/gpt-5` + embedding `openai/text-embedding-3-small` 均走 OpenRouter（[ADR-0001](docs/adr/0001-model-routing-split.md)）。

> 切块目前是定长字符切块（`src/lib/chunk.ts`），**尚未**实现指标行级切块 / 混合检索（[ADR-0004](docs/adr/0004-indicator-chunking-hybrid-retrieval.md)）——留待后续切片。

## 准备

```bash
cp .env.example .env   # 填入 OPENROUTER_API_KEY 等
npm install
```

## 用法

```bash
npm run ingest                      # 入库默认标的 GBT 18242-2025
npm run ingest -- "pdf/xxx.pdf"     # 入库指定 PDF（需有文字层）
npm run ask                         # 默认跑两轮对话（演示多轮记忆）
npm run ask -- "你的问题"
npm run ask -- "第1问" "第2问"      # 多参数 = 同一会话里的多轮提问
```

向量与会话历史落在同一个本地 `vector.db`（libSQL，已 gitignore）：
Agent 接入 Mastra Memory（默认带最近 10 条消息），同一 thread 内多轮可互相引用。

## 反馈回路

```bash
npm test         # vitest：纯逻辑单测（切块）
npm run typecheck # tsc --noEmit
```
