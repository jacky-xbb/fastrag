// 把 useLibrary 抬到外壳层共享：AppSidebar（入库模式渲染已入库列表）+ UploadPage（入库完成后刷新）
// 共用同一个实例，否则两处各自持有 state，刷新互不可见（同 threadsContext 思路）。
import { createContext, useContext, type ReactNode } from 'react'
import { useLibrary } from './useLibrary'

type LibraryValue = ReturnType<typeof useLibrary>
const LibraryContext = createContext<LibraryValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const value = useLibrary()
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibraryContext(): LibraryValue {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibraryContext 必须在 LibraryProvider 内使用')
  return ctx
}
