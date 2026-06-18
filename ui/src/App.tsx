// 路由（ADR-0007）：/login 公开；/chat·/chat/:threadId·/upload 受保护（AppLayout 守卫）。
// ChatPage 不走 Outlet：它常驻在 AppLayout 里（切「入库」时仅 CSS 隐藏、不卸载），
// 这样回答生成中切到入库再切回不会中断 stream。chat 路由 element 留空，Outlet 只渲染入库。
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { LoginPage } from './pages/LoginPage'
import { UploadPage } from './pages/UploadPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/chat" element={null} />
        <Route path="/chat/:threadId" element={null} />
        <Route path="/upload" element={<UploadPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  )
}
