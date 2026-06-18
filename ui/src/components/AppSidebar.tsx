// 历史会话侧栏（shadcn Sidebar）：品牌 + 新会话 + 历史列表（hover 改名/删除）。
// 会话状态由 URL 决定（/chat/:threadId）；新会话 = navigate('/chat')，ChatPage 据无 param 清空对话。
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { FileUp, LogOut, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, User } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { useAuth } from '../lib/useAuth'
import { useThreadsContext } from '../lib/threadsContext'
import { useLibraryContext } from '../lib/libraryContext'

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function AppSidebar() {
  const { threadId: param } = useParams()
  const navigate = useNavigate()
  const { threads, rename, remove } = useThreadsContext()
  const { entries, error: libError } = useLibraryContext()
  const { user, logout } = useAuth()
  const location = useLocation()
  const mode = location.pathname.startsWith('/upload') ? 'upload' : 'chat'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const activeId = param ?? null
  // 记住最近的检索台会话：切到「入库」时不更新（保留），点「检索台」可回到该会话而非开新会话。
  // chat 模式下新会话空白态（无 param）记 null，保证「新会话」后切走再回来不被带回旧会话。
  const lastChatId = useRef<string | null>(null)
  useEffect(() => {
    if (mode === 'chat') lastChatId.current = param ?? null
  }, [mode, param])

  async function commitEdit(id: string) {
    const title = editValue.trim()
    setEditingId(null)
    if (!title) return
    try {
      await rename(id, title)
    } catch {
      /* 改名失败：列表保持原样，刷新时回到库内标题 */
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function deleteThread(id: string) {
    setPendingDelete(null)
    try {
      await remove(id)
      if (id === activeId) navigate('/chat') // 删的是当前会话 → 回到新会话空白态
    } catch {
      /* 删除失败：忽略，列表不变 */
    }
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 py-1 font-semibold">
          <Logo className="text-emerald-400" size={22} />
          <span className="font-mono tracking-tight">FastRAG</span>
        </div>
        {/* 主导航：检索台 / 入库 分段切换（取代原顶栏 tab，入库不再被误当内容切换）。 */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/50 p-1">
          <button
            onClick={() => navigate(lastChatId.current ? '/chat/' + lastChatId.current : '/chat')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm transition-colors ${
              mode === 'chat'
                ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
          >
            <MessageSquare className="size-4" />
            检索台
          </button>
          <button
            onClick={() => navigate('/upload')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm transition-colors ${
              mode === 'upload'
                ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
          >
            <FileUp className="size-4" />
            入库
          </button>
        </div>
        {mode === 'chat' && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => navigate('/chat')}
                className="border border-sidebar-border"
              >
                <Plus />
                <span>新会话</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>

      <SidebarContent>
        {mode === 'upload' ? (
          <SidebarGroup>
            <SidebarGroupLabel>
              已入库{entries && <span className="ml-1 text-sidebar-foreground/40">（{entries.length}）</span>}
            </SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              {libError && (
                <div className="rounded-md border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-400">
                  加载失败：{libError}
                </div>
              )}
              {!entries && !libError && <div className="px-1 text-xs text-sidebar-foreground/50">加载中…</div>}
              {entries && entries.length === 0 && (
                <div className="rounded-md border border-dashed border-sidebar-border p-3 text-xs text-sidebar-foreground/50">
                  库内暂无标准，右侧上传 PDF 入库。
                </div>
              )}
              {entries?.map((d) => (
                <div key={d.code} className="mb-1 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-2.5 text-sm">
                  <div className="truncate font-medium text-sidebar-foreground">{d.code}</div>
                  <div className="truncate text-xs text-sidebar-foreground/60">{d.name}</div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-sidebar-foreground/50">
                    <span>{d.pages}p</span>
                    <span>·</span>
                    <span>{d.chunks} chunks</span>
                    {/* 只给例外项打标：20/21 都是「现行」，绿标纯噪音；仅「废止」灰标，让唯一作废的一眼可见。 */}
                    {d.status === '废止' && (
                      <span className="ml-auto rounded bg-sidebar-accent px-1.5 text-sidebar-foreground/50">已废止</span>
                    )}
                  </div>
                </div>
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
        <SidebarGroup>
          <SidebarGroupLabel>历史</SidebarGroupLabel>
          <SidebarGroupContent>
            {!threads && <div className="px-2 text-xs text-sidebar-foreground/50">加载中…</div>}
            {threads && threads.length === 0 && (
              <div className="px-2 text-xs text-sidebar-foreground/50">暂无历史会话。</div>
            )}
            <SidebarMenu>
              {threads?.map((s) => (
                <SidebarMenuItem key={s.id}>
                  {editingId === s.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(s.id)
                        else if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="h-8 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <>
                      <SidebarMenuButton
                        size="lg"
                        isActive={s.id === activeId}
                        onClick={() => navigate('/chat/' + s.id)}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{s.title}</span>
                          <span className="truncate text-xs text-sidebar-foreground/50">
                            {fmtWhen(s.updatedAt)}
                          </span>
                        </div>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        className="right-7 top-2.5"
                        aria-label="编辑标题"
                        onClick={() => {
                          setEditingId(s.id)
                          setEditValue(s.title)
                        }}
                      >
                        <Pencil />
                      </SidebarMenuAction>
                      <SidebarMenuAction
                        showOnHover
                        className="top-2.5 hover:text-red-400"
                        aria-label="删除会话"
                        onClick={() => setPendingDelete(s.id)}
                      >
                        <Trash2 />
                      </SidebarMenuAction>
                    </>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                    <User className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user}</span>
                  </div>
                  <MoreHorizontal className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={4}
                className="w-(--radix-popper-anchor-width) min-w-56"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <span className="truncate text-sm font-medium">{user}</span>
                    <span className="truncate text-xs text-muted-foreground">已登录</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut />
                  退出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }))}
              onClick={() => pendingDelete && deleteThread(pendingDelete)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}
