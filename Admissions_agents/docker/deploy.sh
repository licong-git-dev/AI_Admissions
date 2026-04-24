#!/usr/bin/env bash
# ============================================================
# 招生智能体 · 一键部署脚本
# 用法：在服务器上 git clone 后，进入 Admissions_agents 目录执行
#   ./docker/deploy.sh init      # 首次部署（生成 .env + 注入 seed）
#   ./docker/deploy.sh up        # 正常启动
#   ./docker/deploy.sh upgrade   # 拉代码 + 重建镜像 + 重启
#   ./docker/deploy.sh down      # 停止全部容器
#   ./docker/deploy.sh logs      # 查看日志
#   ./docker/deploy.sh status    # 容器状态
#   ./docker/deploy.sh backup    # 立即备份数据库
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

ACTION="${1:-}"

ensure_dirs() {
  mkdir -p docker/data docker/logs docker/certs
}

ensure_env() {
  if [ ! -f .env ]; then
    if [ ! -f .env.docker.example ]; then
      echo "❌ 缺少 .env.docker.example，请检查仓库完整性"
      exit 1
    fi
    cp .env.docker.example .env
    # 自动生成两把随机密钥
    JWT=$(openssl rand -hex 16)
    RPA=$(openssl rand -hex 16)
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
    sed -i "s|^RPA_COOKIES_SECRET=.*|RPA_COOKIES_SECRET=${RPA}|" .env
    echo "✅ 已生成 .env（JWT_SECRET、RPA_COOKIES_SECRET 已随机填充）"
    echo "⚠️  还需要编辑 .env 填入 GEMINI_API_KEY（必填）"
    echo "   vi .env"
    exit 0
  fi
}

check_env_ready() {
  local key="$1"
  if ! grep -q "^${key}=[^[:space:]]" .env; then
    echo "❌ .env 中 ${key} 未填写，请先执行 vi .env 填入"
    exit 1
  fi
  # 检查是否为占位符
  val=$(grep "^${key}=" .env | cut -d= -f2-)
  if [ -z "$val" ] || [ "$val" = "your_gemini_api_key" ] || [[ "$val" == *"至少16位"* ]]; then
    echo "❌ .env 中 ${key} 仍是占位符，请填入真实值"
    exit 1
  fi
}

case "$ACTION" in
  init)
    ensure_dirs
    ensure_env
    check_env_ready GEMINI_API_KEY
    check_env_ready JWT_SECRET
    check_env_ready RPA_COOKIES_SECRET

    echo "🔨 构建镜像（首次约 3-5 分钟）…"
    docker compose build

    echo "🌱 首次启动：注入 seed 数据…"
    ENABLE_DB_SEED=true docker compose up -d server
    echo "   等待 server 启动（15 秒）…"
    sleep 15

    if ! curl -sf http://localhost:8787/api/health > /dev/null 2>&1; then
      echo "⚠️  server 健康检查未通过，查看日志："
      docker compose logs server --tail 30
      exit 1
    fi

    docker compose down
    sed -i "s|^ENABLE_DB_SEED=.*|ENABLE_DB_SEED=false|" .env

    echo "🚀 正式启动所有服务…"
    docker compose up -d
    sleep 5
    docker compose ps

    echo ""
    echo "✅ 部署完成！"
    echo ""
    echo "默认账号（首次 seed 注入，**生产请立即改密码**）："
    echo "   管理员：admin / admin123456"
    echo "   乙方老板：tenant_admin / tenant123456"
    echo "   招生专员：zhangsan / lisi / wangwu · 密码 specialist123"
    echo ""
    echo "访问地址："
    echo "   管理后台：http://$(hostname -I | awk '{print $1}'):${HTTP_PORT:-80}/"
    echo "   测评 H5：http://$(hostname -I | awk '{print $1}'):${HTTP_PORT:-80}/assessment"
    echo "   学员端：http://$(hostname -I | awk '{print $1}'):${HTTP_PORT:-80}/portal"
    echo "   Prometheus 指标：http://$(hostname -I | awk '{print $1}'):${HTTP_PORT:-80}/api/metrics"
    echo ""
    echo "⚠️  立即改密码："
    echo "   TOKEN=\$(curl -s -X POST http://localhost/api/auth/login \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"username\":\"admin\",\"password\":\"admin123456\"}' | jq -r '.data.token')"
    echo "   curl -X POST http://localhost/api/auth/change-password \\"
    echo "     -H \"Authorization: Bearer \$TOKEN\" \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"oldPassword\":\"admin123456\",\"newPassword\":\"<新密码>\"}'"
    ;;

  up)
    ensure_dirs
    ensure_env
    docker compose up -d
    docker compose ps
    ;;

  upgrade)
    ensure_dirs
    echo "🔄 拉取最新代码…"
    git fetch origin
    git pull --ff-only origin main
    echo "🔨 重建镜像…"
    docker compose build
    echo "🚀 重启服务…"
    docker compose up -d
    docker compose ps
    echo "✅ 升级完成"
    ;;

  down)
    docker compose down
    ;;

  logs)
    shift || true
    docker compose logs -f --tail 100 "$@"
    ;;

  status)
    docker compose ps
    echo ""
    echo "📊 磁盘占用："
    du -sh docker/data docker/logs 2>/dev/null || true
    echo ""
    echo "📊 健康检查："
    curl -s http://localhost:8787/api/health | head -5 || echo "server 不可达"
    ;;

  backup)
    ensure_dirs
    TS=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="docker/data/backup-${TS}.db"
    if ! docker exec admissions-server test -f /data/admissions.db; then
      echo "❌ 数据库文件不存在"
      exit 1
    fi
    docker exec admissions-server sqlite3 /data/admissions.db ".backup /data/backup-${TS}.db"
    mv "docker/data/backup-${TS}.db" "docker/data/backup-${TS}.db"
    echo "✅ 备份完成：docker/data/backup-${TS}.db"
    find docker/data -name "backup-*.db" -mtime +30 -delete 2>/dev/null || true
    echo "🧹 已清理 30 天前的旧备份"
    ;;

  *)
    cat <<EOF
招生智能体部署脚本用法：

  ./docker/deploy.sh init        首次部署（生成 .env、构建镜像、注入 seed、启动）
  ./docker/deploy.sh up          日常启动
  ./docker/deploy.sh upgrade     拉代码 + 重建镜像 + 重启
  ./docker/deploy.sh down        停止全部容器
  ./docker/deploy.sh logs [service]   查看日志（可指定 server / worker / frontend）
  ./docker/deploy.sh status      容器状态 + 磁盘 + 健康
  ./docker/deploy.sh backup      手动备份数据库

前置条件：
  - 服务器 ≥ 2G 内存、20G 磁盘
  - 已安装 docker、docker compose、openssl、curl、git

首次部署流程：
  1. git clone <repo>
  2. cd Admissions_agents
  3. ./docker/deploy.sh init          # 会提示填 GEMINI_API_KEY
  4. vi .env                          # 填入 GEMINI_API_KEY
  5. ./docker/deploy.sh init          # 再次执行开始构建
EOF
    ;;
esac
