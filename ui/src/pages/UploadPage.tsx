// 入库页：上传向量化（/api/ingest，#10）。已入库列表已挪到侧栏（入库模式），这里只留上传。
import { useState } from 'react'
import { useIngest } from '../lib/useIngest'
import { useLibraryContext } from '../lib/libraryContext'
import { INGEST_STAGES } from '../lib/mockData'

// 上传限制（与后端一致）：单文件 ≤100MB（整份进内存）、单批 ≤10 个。
const MAX_MB = 100
const MAX_BATCH = 10

export function UploadPage() {
  const { refresh } = useLibraryContext()
  const { jobs, start, clear } = useIngest(refresh) // 入库完成后刷新侧栏资料库列表
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')

  // 点击选择与拖入共用：收多个、只留 PDF，挡掉超大/超量，逐个排队串行入库。
  const accept = (list?: FileList | null) => {
    if (!list?.length) return
    let pdfs = Array.from(list).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )
    const msgs: string[] = []
    const big = pdfs.filter((f) => f.size > MAX_MB * 1024 * 1024)
    if (big.length) msgs.push(`超过 ${MAX_MB}MB 已跳过：${big.map((f) => f.name).join('、')}`)
    pdfs = pdfs.filter((f) => f.size <= MAX_MB * 1024 * 1024)
    if (pdfs.length > MAX_BATCH) {
      msgs.push(`单批最多 ${MAX_BATCH} 个，仅取前 ${MAX_BATCH} 个`)
      pdfs = pdfs.slice(0, MAX_BATCH)
    }
    setNotice(msgs.join('；'))
    if (pdfs.length) start(pdfs)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <section className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-6">
        <h1 className="text-lg font-semibold text-zinc-100">入库新标准</h1>
        <label
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files) }}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center transition-colors ${
            dragging ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700 bg-zinc-900/60 hover:border-emerald-500/60'
          }`}
        >
          <span className="text-2xl">⬆</span>
          <span className="text-sm text-zinc-300">{dragging ? '松手即可入库' : '拖拽 PDF 到此处，或点击选择（可多选）'}</span>
          <span className="font-mono text-xs text-zinc-600">pdf/*.pdf → OCR → chunk → embed → upsert</span>
          <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { accept(e.target.files); e.target.value = '' }} />
        </label>
        <p className="mt-2 text-xs text-zinc-600">单文件 ≤ {MAX_MB}MB，单批 ≤ {MAX_BATCH} 个</p>
        {notice && <p className="mt-1 text-xs text-amber-400">{notice}</p>}

        {jobs.length > 0 && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>入库队列（{jobs.length}）</span>
              <button onClick={clear} className="hover:text-zinc-300">全部清空</button>
            </div>
            {jobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-zinc-800 bg-zinc-900 font-mono text-sm">
                <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-zinc-300">
                  <span className="truncate">$ ingest "{job.fileName}"</span>
                  {job.queued && <span className="ml-2 flex-none text-xs text-zinc-500">排队中…</span>}
                </div>
                {job.queued ? (
                  <div className="px-4 py-3 text-[11px] text-zinc-500">等待前面的任务完成…</div>
                ) : (
                  <>
                    {!job.done && !job.error && (
                      <div className="border-b border-zinc-800 px-4 py-1.5 text-[11px] text-zinc-500">
                        入库在后台继续，可离开本页或刷新，回来会自动接上进度。
                      </div>
                    )}
                    <div className="space-y-1 p-4">
                      {INGEST_STAGES.map((s, i) => {
                        const state = job.stage > i || job.done ? 'done' : job.stage === i ? 'active' : 'todo'
                        return (
                          <div key={s.key} className="flex items-start gap-2 text-[13px]">
                            <span className={state === 'done' ? 'text-emerald-400' : state === 'active' ? 'text-amber-400' : 'text-zinc-700'}>
                              {state === 'done' ? '✓' : state === 'active' ? '▸' : '·'}
                            </span>
                            <div>
                              <span className={state === 'todo' ? 'text-zinc-700' : 'text-zinc-200'}>{s.label}</span>
                              {state === 'active' && <span className="ml-2 animate-pulse text-amber-400">running…</span>}
                              <div className="text-[11px] text-zinc-600">{s.detail}</div>
                            </div>
                          </div>
                        )
                      })}
                      {job.done && <div className="mt-2 text-emerald-400">✓ done — upserted {job.chunks} chunks / {job.pages} pages</div>}
                      {job.error && <div className="mt-2 text-red-400">✗ 入库失败：{job.error}</div>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
