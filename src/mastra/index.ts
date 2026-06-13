// Mastra 实例：libSQL 向量库 + 国标问答 Agent + 向量检索工具。
// 对话与 embedding 均走 OpenRouter（ADR-0001）。

import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { LibSQLVector, LibSQLStore } from '@mastra/libsql'
import { Memory } from '@mastra/memory'
import { createVectorQueryTool } from '@mastra/rag'
import { chatModel, embedModel, VECTOR_DB_URL, INDEX_NAME } from '../lib/openrouter.js'

export const libsqlVector = new LibSQLVector({ id: 'libsql', url: VECTOR_DB_URL })

// 会话历史与向量库共用同一个 libSQL 文件（#5）：两者表名不冲突，可共存。
export const libsqlStore = new LibSQLStore({ id: 'libsql-store', url: VECTOR_DB_URL })

// 多轮会话历史：默认带最近 10 条消息（semanticRecall 关闭，无需额外向量库）。
export const memory = new Memory({ storage: libsqlStore })

// 检索侧必须用与入库相同的 embedding 模型，向量空间才一致。
export const vectorQueryTool = createVectorQueryTool({
  vectorStoreName: 'libsql',
  indexName: INDEX_NAME,
  model: embedModel,
})

export const standardsAgent = new Agent({
  id: 'standardsAgent',
  name: '国标问答',
  instructions: `你是防水卷材国标/行标问答助手。回答必须基于检索到的标准原文。

规则：
- 每次回答前，先用 vectorQueryTool 检索相关标准内容。
- 答案必须标注来源：引用 chunk 元数据里的「文件名 + 页码」（如「来源：GBT 18242-2025（第 3 页）」）。
- 若检索结果里某标准状态为「废止」，必须在答案中显式标注「该标准已作废」。
- 检索不到依据时，如实说明「未在已入库标准中找到」，不要编造数字。
- 用中文回答。`,
  model: chatModel,
  tools: { vectorQueryTool },
  memory,
})

export const mastra = new Mastra({
  agents: { standardsAgent },
  vectors: { libsql: libsqlVector },
  storage: libsqlStore,
})
