// 资料库列表（#11）：拉 GET /api/library，渲染真实已入库标准。
// 后端按标准号聚合（一行一标准，含页数/块数/状态，见 src/lib/library.ts）。
import { useCallback, useEffect, useState } from 'react'

export interface LibraryEntry {
  code: string
  name: string
  fileName: string
  pages: number
  chunks: number
  status: string // 现行 / 废止
}

export function useLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/api/library')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEntries((await res.json()) as LibraryEntry[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { entries, error, refresh }
}
