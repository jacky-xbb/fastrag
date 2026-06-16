# Web UI 采用 AI SDK UI-message 流 + ai-elements 组件库

Web 前端（[ui/](../../ui/)，专业暗色三栏工作台）的对话列改用 **Vercel ai-elements** 组件库（shadcn registry），后端 `/api/chat` 从手搓 SSE 切到 **AI SDK UI-message 流协议**，前端用 `@ai-sdk/react` 的 `useChat` 驱动。多方案原型挑选后选定暗色三栏方案（见 git 历史的原型阶段），本 ADR 记录把它接真后端时的一组绑定决策。

## 决策

1. **协议：AI SDK UI-message 流**。`/api/chat` 用 Mastra `agent.stream(...).toUIMessageStreamResponse()` 原生吐 AI SDK 协议，替换原 `{status}/{delta}/{done}` 自定义 SSE。这样 ai-elements 组件（消费 `UIMessage.parts`）零适配即可驱动。
2. **引入方式：官方 shadcn**。在 `ui/` 跑 `shadcn init` + `npx ai-elements@latest`，引入 components.json、CSS 变量主题、`cn` 工具、`lucide-react` 及 Radix/cva 等。
3. **设计不变：保留暗色三栏**。shadcn 语义 token 映射成本项目暗色调（zinc 底 + emerald 主色）。ai-elements **只接管中间对话列内部**（Conversation/Message/Response/PromptInput/Sources/Tool）；三栏外壳、左会话栏、右证据面板仍是自定义布局。
4. **证据来自原生 tool parts**。`hybridQueryTool`/`webSearchTool` 的调用自动成为流里的 tool-invocation parts，证据面板据此渲染真实检索/联网轨迹，不再从模型答案文本正则抠。
5. **来源解析放前端、不动 tool 返回值**。`hybridQueryTool` 仍返回 `formatHits` 字符串（模型看到的输入不变）；前端解析 tool-output 里**我们自己格式化的**确定串 `标准号｜表名｜第X页` 生成来源 chips。
6. **记忆在服务端**。沿用 Mastra memory 按 `threadId` 落 libSQL（[硬约束 #5](../../CLAUDE.md)）。`useChat` 配 transport 只发 `{最新消息 + threadId}`，后端靠 memory 续上下文，不依赖客户端发整段历史。

## 理由 / 被否方案

- **为何换掉能跑的自定义 SSE**：要用 ai-elements 就得喂它 AI SDK 的 parts 模型；Mastra 正好原生支持 `toUIMessageStreamResponse`，换协议反而消掉了「手搓 hook 解析 SSE」这层，并白拿 `useChat` 的重发/停止/状态机。保留自定义 SSE 再手动喂组件 = 既丢生态又留维护负担，否掉。
- **为何前端解析 tool-output 而非改 tool 返回结构化对象**：召回已用 `test/eval.ts` 种子集精调到位（带号/不带号/过滤三口径），**改 tool 返回形状会动模型看到的输入，有回归风险**。解析 tool-output 的确定分隔串（`｜`，我们自己格式化）比解析模型自由措辞稳得多，且模型零改动、零回归。
- **为何服务端记忆**：硬约束 #5 要求历史落 libSQL，未来「历史会话列表」也读它。客户端记忆（useChat 默认发整段 messages）会让历史不落库、刷新即丢、列表无来源，否掉。

## 范围

本轮只动**对话列 + 协议**。登录、PDF 上传向量化、历史列表、资料库仍是示例数据（`ui/src/lib/mockData.ts`），待后续补 `POST /api/ingest`、`GET /api/threads|messages|library` 时再接真（见 [ui/README.md](../../ui/README.md)）。

## 新增依赖

`@ai-sdk/react`、shadcn 全家桶（Radix / class-variance-authority / tailwind-merge / clsx / lucide-react）。`ai` v6 已在用。
