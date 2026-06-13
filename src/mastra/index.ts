// Mastra 实例：libSQL 向量库 + 国标问答 Agent + 向量检索工具。
// 对话与 embedding 均走 OpenRouter（ADR-0001）。

import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { LibSQLVector, LibSQLStore } from '@mastra/libsql'
import { Memory } from '@mastra/memory'
import { createVectorQueryTool } from '@mastra/rag'
import { z } from 'zod'
import { chatModel, embedModel, VECTOR_DB_URL, INDEX_NAME } from '../lib/openrouter.js'
import { tavilySearch } from '../lib/tavily.js'

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

// 联网兜底工具（#6）：仅在库内检索不到时调用，结果自带「联网来源」标记。
export const webSearchTool = createTool({
  id: 'webSearchTool',
  description:
    '联网搜索兜底。仅当 vectorQueryTool 在已入库国标中找不到答案时才调用；返回结果均为「联网来源」，不可与国标库来源混淆。',
  inputSchema: z.object({
    query: z.string().describe('要联网搜索的查询词'),
  }),
  execute: async ({ query }) => {
    return await tavilySearch(query)
  },
})

export const standardsAgent = new Agent({
  id: 'standardsAgent',
  name: '国标问答',
  instructions: `你是防水卷材国标/行标问答助手。回答必须基于检索到的标准原文。

规则：
- 每次回答前，先用 vectorQueryTool 检索相关标准内容（库内优先）。
- 答案必须标注来源：引用 chunk 元数据里的「文件名 + 页码」（如「来源：GBT 18242-2025（第 3 页）」）。
- 若检索结果里某标准状态为「废止」，必须在答案中显式标注「该标准已作废」。
- 仅当 vectorQueryTool 在已入库标准中找不到答案时，才调用 webSearchTool 联网兜底；库内已能回答就不要联网。
- 区分来源渠道：库内内容标注「来源：国标库」并附文件名+页码；联网内容标注「来源：联网」并附网页链接。两类来源不可混淆。
- 库内与联网都查不到时，如实说明未找到，不要编造数字。
- 用中文回答。`,
  model: chatModel,
  tools: { vectorQueryTool, webSearchTool },
  memory,
})

export const mastra = new Mastra({
  agents: { standardsAgent },
  vectors: { libsql: libsqlVector },
  storage: libsqlStore,
})
