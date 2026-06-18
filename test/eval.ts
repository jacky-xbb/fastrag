// 检索召回 + 来源标注 评测（P0/P2）。集成脚本，读真实库，不走 vitest。
//
// P0 召回率 Recall@K：纯检索层，不经 LLM。判分 = 该命中的「指标行」有没有进 top-K，
//   用元数据精确匹配（matchesFilter，归一化子串），客观、零额外 token。两种口径：
//   · 默认（裸召回）：不带 filter，量检索器自身的召回底线，最保守、能暴露脆弱。
//   · --filtered：用 groundTruth 的「标准号」当过滤（模拟 Agent 提取的 standardCode），
//     量「标准号过滤生效时的召回上界」，贴近产线真实体验。只过滤标准号、不过滤指标名
//     （指标名是要找的答案，拿它当过滤条件＝作弊），把「过滤有效性」与「LLM 提取准不准」隔离开。
// P2 来源正确：仅 --llm，端到端跑 Agent，校验答案引用的来源标准号是否「对」——
//   答案里要出现 groundTruth 标准号（归一化匹配，「GB/T 18242」对上「GB/T 18242-2025」）。
//   不只是「有来源」而是「来源对」；与 P0 合看：P0 保证检索到对的块，P2 保证答案引到对的标准。
//
// 用法：
//   npx tsx test/eval.ts             # 裸召回 P0，快、便宜（仅 query embedding 开销）
//   npx tsx test/eval.ts --filtered  # 带标准号过滤的 P0（产线路径，案例5 这类应转绿）
//   npx tsx test/eval.ts --llm       # 额外端到端跑 Agent，测 P2 来源标注（耗对话 token）
//   npx tsx test/eval.ts --k 10      # 改 Recall@K 的 K（默认 6，与线上 topK 一致）
//   npx tsx test/eval.ts --prose     # 换正文评测集（试验步骤/范围/术语），判分=关键词文本命中
//   npx tsx test/eval.ts --newdocs   # 换「新增文档」评测集（可叠加 --prose），验证新入库标准的召回

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hybridSearch, type HybridHit } from '../src/lib/retrieve.js'
import { matchesFilter, norm, type ChunkFilter } from '../src/lib/hybrid.js'
import { getMastra, GENERATE_MAX_STEPS } from '../src/mastra/index.js'

// 正文题的 groundTruth 多一个 keywords：答案在正文（无指标名可匹配），
// 改判「召回块文本是否含全部关键词」（见 --prose）。
type GroundTruth = ChunkFilter & { keywords?: string[] }

interface EvalCase {
  input: { query: string }
  groundTruth: GroundTruth
  tags?: string[]
  note?: string
}

const here = dirname(fileURLToPath(import.meta.url))
const useLlm = process.argv.includes('--llm')
const filtered = process.argv.includes('--filtered')
// --prose：换正文评测集，判分改「关键词文本命中」而非「指标名元数据匹配」。
const prose = process.argv.includes('--prose')
// --newdocs：换「新增文档」评测集（验证新入库标准的召回），与 --prose 正交。
const newdocs = process.argv.includes('--newdocs')
const datasetBase = newdocs ? 'eval-newdocs' : 'eval'
const datasetFile = prose ? `${datasetBase}-prose-dataset.jsonl` : `${datasetBase}-dataset.jsonl`
const kArg = process.argv.indexOf('--k')
const K = kArg >= 0 ? Number(process.argv[kArg + 1]) : 6

const cases: EvalCase[] = readFileSync(join(here, 'datasets', datasetFile), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as EvalCase)

/** 第一个命中 groundTruth 的块在 top-K 里的 1-based 名次；0 = 未召回。
 *  指标题：元数据匹配（标准号+指标名）。
 *  正文题（gt.keywords）：标准号匹配 + 全部关键词出现在「同一」召回块文本里——
 *  这恰好量「答案有没有被切块切散」，是区分正文切法好坏的关键。 */
function rankOfFirstMatch(hits: HybridHit[], gt: GroundTruth): number {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    if (gt.keywords?.length) {
      const codeOk = matchesFilter(h.metadata, { 标准号: gt.标准号 })
      const text = norm(h.text)
      if (codeOk && gt.keywords.every((k) => text.includes(norm(k)))) return i + 1
    } else if (matchesFilter(h.metadata, gt)) {
      return i + 1
    }
  }
  return 0
}

async function main() {
  const agent = useLlm ? getMastra().getAgent('standardsAgent') : null
  let recallHit = 0
  // 分组：带标准号 vs 不带标准号（tag「no-code」）——后者贴近普通用户问法，召回通常更低。
  let codeHit = 0,
    codeTotal = 0,
    noCodeHit = 0,
    noCodeTotal = 0
  let srcAnsPass = 0,
    srcAnsTotal = 0

  const mode = filtered ? '带标准号过滤' : '裸召回'
  const kind = prose ? '正文召回' : '指标召回'
  const corpus = newdocs ? '新增文档·' : ''
  console.log(
    `\n=== 检索评测(${corpus}${kind}) · Recall@${K} · ${mode}${useLlm ? ' + 来源标注' : ''} · 共 ${cases.length} 题 ===\n`,
  )

  for (const [i, c] of cases.entries()) {
    // P0：纯检索召回。--filtered 时用 groundTruth 标准号当过滤（模拟 Agent 提取的 standardCode）。
    const hits = await hybridSearch({
      query: c.input.query,
      topK: K,
      filter: filtered ? { 标准号: c.groundTruth.标准号 } : undefined,
    })
    const rank = rankOfFirstMatch(hits, c.groundTruth)
    const recalled = rank > 0
    if (recalled) recallHit++
    const noCode = c.tags?.includes('no-code') ?? false
    if (noCode) {
      noCodeTotal++
      if (recalled) noCodeHit++
    } else {
      codeTotal++
      if (recalled) codeHit++
    }

    // P2：仅 --llm，端到端跑 Agent。校验答案引用的来源标准号是否「对」——
    // 答案里要出现 groundTruth 的标准号（归一化匹配，「GB/T 18242」对上「GB/T 18242-2025」）。
    // 只查「有没有来源」不够，这里查「来源对不对」；来源对 ⇒ 答案确实引到了该标准。
    let ansCol = ''
    if (agent) {
      const res = await agent.generate(c.input.query, { maxSteps: GENERATE_MAX_STEPS })
      srcAnsTotal++
      const wantCode = c.groundTruth.标准号 ?? ''
      // 去掉「/T」「/Z」等推荐性后缀再比：库存「JC 684」、LLM 常写「JC/T 684」，本是同一标准。
      const codeNorm = (s: string) => norm(s.replace(/\/[A-Za-z]+/g, ''))
      const srcCorrect = wantCode !== '' && codeNorm(res.text).includes(codeNorm(wantCode))
      if (srcCorrect) srcAnsPass++
      ansCol = ` | 来源:${srcCorrect ? '✓对' : '✗错/缺'}`
    }

    const status = recalled ? `✓ @${rank}` : '✗ 未召回'
    const groupTag = noCode ? '[无号]' : '[带号]'
    console.log(`${String(i + 1).padStart(2)}. ${status.padEnd(9)} ${groupTag} ${c.input.query}${ansCol}`)
  }

  const pct = (hit: number, total: number) =>
    total ? `${hit}/${total} = ${((hit / total) * 100).toFixed(1)}%` : '—'
  console.log(`\n=== 汇总 ===`)
  console.log(`P0 召回率 Recall@${K} 总体: ${pct(recallHit, cases.length)}`)
  console.log(`  · 带标准号: ${pct(codeHit, codeTotal)}`)
  console.log(`  · 不带标准号: ${pct(noCodeHit, noCodeTotal)}  ← 贴近普通用户问法`)
  if (useLlm) console.log(`P2 来源标准号正确(答案层): ${pct(srcAnsPass, srcAnsTotal)}`)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[eval] 失败：', e)
    process.exit(1)
  })
