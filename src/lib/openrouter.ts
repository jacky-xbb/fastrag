// 模型全收口 OpenRouter（ADR-0001）。
// 关键：直接写 'openai/...' 会被 AI SDK 当成官方 OpenAI 直连——
// 必须显式建 OpenRouter provider 再传模型实例。对话与 embedding 共用一个 key。

import { createOpenRouter } from '@openrouter/ai-sdk-provider'

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('缺少 OPENROUTER_API_KEY（见 .env.example）')
}

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

/** 对话模型 */
export const chatModel = openrouter.chat('openai/gpt-5')

/** embedding 模型（1536 维）。入库与检索必须用同一个，否则向量空间对不上。 */
export const embedModel = openrouter.textEmbeddingModel('openai/text-embedding-3-small')

/** 入库与检索共用：libSQL 向量库文件 + 索引名 + 维度。 */
export const VECTOR_DB_URL = 'file:./vector.db'
export const INDEX_NAME = 'standards'
export const EMBED_DIMENSION = 1536
