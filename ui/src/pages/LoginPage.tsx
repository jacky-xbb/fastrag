// 登录页（公开）。已登录则跳 /chat。
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { Logo } from '../components/Logo'

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [u, setU] = useState('admin')
  const [p, setP] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return null
  if (user) return <Navigate to="/chat" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const error = await login(u, p)
    setBusy(false)
    if (error) setErr(error)
    else navigate('/chat', { replace: true })
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-zinc-950 text-zinc-200 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-900/40 to-zinc-900 p-10 md:flex">
        <div className="flex items-center gap-2 font-semibold">
          <Logo className="text-emerald-400" size={26} />
          <span className="font-mono tracking-tight">fastrag</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-snug text-zinc-50">防水卷材国标<br />检索工作台</h1>
          <p className="mt-3 max-w-sm text-sm text-zinc-400">混合检索（向量 + BM25 + 元数据过滤），指标行级命中，逐条标注标准号与页码。</p>
        </div>
      </div>
      <div className="grid place-items-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h2 className="text-xl font-semibold text-zinc-100">登录</h2>
          <div>
            <label htmlFor="login-user" className="text-xs text-zinc-500">账号</label>
            <input
              id="login-user"
              value={u}
              onChange={(e) => setU(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs text-zinc-500">密码</label>
            <input
              id="login-password"
              type="password"
              value={p}
              onChange={(e) => setP(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          {err && <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-400">{err}</div>}
          <button
            disabled={busy}
            className="w-full rounded-md bg-emerald-500 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? '登录中…' : '进入工作台'}
          </button>
        </form>
      </div>
    </div>
  )
}
