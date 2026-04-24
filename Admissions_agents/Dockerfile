# ============================================================
# 招生智能体 · 三阶段 Dockerfile
# - 基础镜像用 debian slim（better-sqlite3 原生模块 apt 装依赖比 alpine 稳）
# - 三个 target：server / worker / frontend
# - 都共享同一个 builder 层缓存，首次 build 慢，后续秒级
# ============================================================

# ---------- Builder：装依赖 + 编译前端 ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- Server：仅保留 runtime ----------
FROM node:20-bookworm-slim AS server
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/server ./server

RUN mkdir -p /data /app/server/logs

ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/admissions.db

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD wget -q -O- http://localhost:8787/api/health || exit 1

CMD ["npx", "tsx", "server/src/index.ts"]

# ---------- Worker：同 runtime，启动 worker 入口 ----------
FROM node:20-bookworm-slim AS worker
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/server ./server

# 真正跑 Playwright 时，取消下面两行注释（会让镜像增到约 1.5 GB）
# RUN npx playwright install --with-deps chromium
# ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN mkdir -p /data /app/server/logs

ENV NODE_ENV=production \
    DB_PATH=/data/admissions.db \
    RPA_HEADLESS=true \
    RPA_AUTO_SUBMIT=false

CMD ["npx", "tsx", "server/worker/index.ts"]

# ---------- Frontend：nginx 托管编译后的静态文件 ----------
FROM nginx:1.27-alpine AS frontend
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
