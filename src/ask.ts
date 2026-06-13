// 问答脚本：向国标问答 Agent 提问，验证「检索 + 带来源作答」端到端跑通。
// 用法：npm run ask -- "GBT 18242-2025 的可溶物含量要求是多少？"

import 'dotenv/config'
import { mastra } from './mastra/index.js'

async function main() {
  const question =
    process.argv[2] ?? 'GBT 18242-2025 中 I 型卷材的可溶物含量要求是多少？请标注来源。'
  console.log(`[ask] 问题：${question}\n`)

  const agent = mastra.getAgent('standardsAgent')
  const res = await agent.generate(question)

  console.log('[ask] 回答：\n')
  console.log(res.text)
}

main().catch((err) => {
  console.error('[ask] 失败：', err)
  process.exit(1)
})
