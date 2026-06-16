// 上传向量化（#10）：POST /api/ingest（原始 PDF 字节，文件名走 ?name=），
// 读 NDJSON 流逐阶段推真实进度（替掉 useIngestSim 的模拟）。
// 事件：{type:'stage', stage} / {type:'done', pages, chunks} / {type:'error', message}。
import { useCallback, useRef, useState } from 'react'
import { INGEST_STAGES } from './mockData'

export interface IngestJob {
  fileName: string
  /** 当前阶段下标，= INGEST_STAGES.length 表示完成 */
  stage: number
  done: boolean
  pages: number
  chunks: number
  error?: string
}

const stageIndex = (key: string) => INGEST_STAGES.findIndex((s) => s.key === key)

export function useIngest(onDone?: () => void) {
  const [job, setJob] = useState<IngestJob | null>(null)
  const aborted = useRef<AbortController | null>(null)

  const start = useCallback(
    async (file: File) => {
      aborted.current?.abort()
      const ac = new AbortController()
      aborted.current = ac
      setJob({ fileName: file.name, stage: 0, done: false, pages: 0, chunks: 0 })

      try {
        const res = await fetch(`/api/ingest?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
          signal: ac.signal,
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        // 逐块读 → 按行切 NDJSON → 解析事件。
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            const ev = JSON.parse(line) as
              | { type: 'stage'; stage: string }
              | { type: 'done'; pages: number; chunks: number }
              | { type: 'error'; message: string }
            if (ev.type === 'stage') {
              const idx = stageIndex(ev.stage)
              if (idx >= 0) setJob((j) => (j ? { ...j, stage: idx } : j))
            } else if (ev.type === 'done') {
              setJob((j) =>
                j ? { ...j, stage: INGEST_STAGES.length, done: true, pages: ev.pages, chunks: ev.chunks } : j,
              )
              onDone?.()
            } else if (ev.type === 'error') {
              setJob((j) => (j ? { ...j, error: ev.message } : j))
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setJob((j) => (j ? { ...j, error: e instanceof Error ? e.message : String(e) } : j))
      }
    },
    [onDone],
  )

  const clear = useCallback(() => {
    aborted.current?.abort()
    setJob(null)
  }, [])

  return { job, start, clear }
}
