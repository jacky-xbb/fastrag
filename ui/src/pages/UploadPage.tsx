// 入库页：上传向量化（/api/ingest，#10）。已入库列表已挪到侧栏（入库模式），这里只留上传。
import { useIngest } from '../lib/useIngest'
import { useLibraryContext } from '../lib/libraryContext'
import { INGEST_STAGES } from '../lib/mockData'

export function UploadPage() {
  const { refresh } = useLibraryContext()
  const { job, start, clear } = useIngest(refresh) // 入库完成后刷新侧栏资料库列表

  return (
    <div className="flex flex-1 overflow-hidden">
      <section className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-zinc-100">入库新标准</h2>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 py-10 text-center hover:border-emerald-500/60">
          <span className="text-2xl">⬆</span>
          <span className="text-sm text-zinc-300">拖拽 PDF 或点击选择</span>
          <span className="font-mono text-xs text-zinc-600">pdf/*.pdf → OCR → chunk → embed → upsert</span>
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = '' }} />
        </label>

        {job && (
          <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 font-mono text-sm">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-zinc-300">
              <span className="truncate">$ ingest "{job.fileName}"</span>
              <button onClick={clear} className="text-xs text-zinc-500 hover:text-zinc-300">clear</button>
            </div>
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
          </div>
        )}
      </section>
    </div>
  )
}
