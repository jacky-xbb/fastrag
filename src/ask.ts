// 问答脚本：向国标问答 Agent 提问，验证「检索 + 带来源作答 + 多轮记忆」端到端跑通。
//
// 用法：
//   npm run ask                                   # 默认跑一段两轮对话（演示记忆）
//   npm run ask -- "问题1" "问题2" ...            # 多个参数 = 同一会话里的多轮提问
//
// 多轮共用同一个 thread/resource，历史存在与向量库相同的 libSQL 文件里（#5）。

import 'dotenv/config'
import { mastra } from './mastra/index.js'

// 固定会话标识：同一 thread 内多轮可互相引用，跨次运行也能续上历史。
const THREAD_ID = 'cli-demo-thread'
const RESOURCE_ID = 'cli-demo-user'

// 默认两轮：第 2 问用「它」指代第 1 问的标准，验证记忆是否生效。
const DEFAULT_TURNS = [
  'GBT 18242-2025 中 I 型卷材的可溶物含量要求是多少？请标注来源。',
  '它一共分哪几种类型（型号）？',
]

async function main() {
  const turns = process.argv.slice(2)
  const questions = turns.length > 0 ? turns : DEFAULT_TURNS

  const agent = mastra.getAgent('standardsAgent')

  for (const [i, question] of questions.entries()) {
    console.log(`\n[ask] 第 ${i + 1} 轮问题：${question}\n`)
    const res = await agent.generate(question, {
      memory: { thread: THREAD_ID, resource: RESOURCE_ID },
    })
    console.log(`[ask] 第 ${i + 1} 轮回答：\n`)
    console.log(res.text)
  }
}

main().catch((err) => {
  console.error('[ask] 失败：', err)
  process.exit(1)
})
