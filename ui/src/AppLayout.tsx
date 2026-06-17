// 受保护布局：未登录跳 /login；已登录渲染 shadcn Sidebar 外壳（侧栏含检索台/入库主导航 + 子路由）。
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './lib/useAuth'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from './components/AppSidebar'
import { ThreadsProvider } from './lib/threadsContext'
import { LibraryProvider } from './lib/libraryContext'

export function AppLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="grid h-screen place-items-center bg-zinc-950 text-sm text-zinc-500">加载中…</div>
  }
  if (!user) return <Navigate to="/login" replace />

  return (
    <ThreadsProvider>
      <LibraryProvider>
        <SidebarProvider className="h-svh overflow-hidden bg-zinc-950 text-zinc-200">
          <AppSidebar />
          <SidebarInset className="min-h-0 overflow-hidden bg-zinc-950">
            <header className="flex flex-none items-center gap-3 border-b border-zinc-800 px-3 py-2 text-sm">
              <SidebarTrigger className="text-zinc-400 hover:text-zinc-100" />
            </header>
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </LibraryProvider>
    </ThreadsProvider>
  )
}
