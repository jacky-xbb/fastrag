// 受保护布局：未登录跳 /login；已登录渲染 shadcn Sidebar 外壳（侧栏含检索台/入库主导航 + 子路由）。
// ChatPage 常驻渲染（不走 Outlet），切「入库」时仅 CSS 隐藏，回答生成中切走再切回不中断 stream。
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './lib/useAuth'
import { ChatPage } from './pages/ChatPage'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from './components/AppSidebar'
import { ThreadsProvider } from './lib/threadsContext'
import { LibraryProvider } from './lib/libraryContext'

export function AppLayout() {
  const { user, loading } = useAuth()
  const isUpload = useLocation().pathname.startsWith('/upload')

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
            {/* ChatPage 常驻：入库时隐藏但不卸载，stream 不断。display:contents 保持原 flex 布局。 */}
            <div className={isUpload ? 'hidden' : 'contents'}>
              <ChatPage />
            </div>
            <div className={isUpload ? 'contents' : 'hidden'}>
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </LibraryProvider>
    </ThreadsProvider>
  )
}
