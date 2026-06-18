# fly.io 运行镜像：常驻 Node 进程跑 src/server.ts（tsx 直跑 TS，与本地 CLI 一致）。
# 用 bookworm-slim（glibc）——alpine 的 musl 装不上 @libsql/client 的原生绑定。
# 多阶段：builder 装全量依赖 + vite 构建前端；runner 只装生产依赖 + 烤入瘦库种子。

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run ui:build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data VECTOR_DB_URL=file:/data/vector.db PORT=8080
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tsconfig.json ./
COPY src ./src
COPY --from=builder /app/ui/dist ./ui/dist
# 瘦库种子（可选）：本地有 vector.db 就烤进 /app/seed，首启由 entrypoint 拷到 /data
# （volume 持久，重部署不覆盖）。CI 检出无 vector.db 时只拷 .gitkeep、跳过种子，纯代码
# 部署（生产卷已有数据）。glob + 保证存在的 .gitkeep 让缺库时 COPY 不报错。
COPY seed/.gitkeep vector.db* ./seed/
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["pnpm", "start"]
